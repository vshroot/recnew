/* CSV Reconciler — app.js (worker-first, stable) */
"use strict";

/* global Papa */

const APP_VERSION = "5.0.3+worker-first.delimiter";

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2, 10);

  // DOM
  const filesEl = $("#files");
  const resultsEl = $("#results");
  const progressSectionEl = $("#progress");
  const progressBarEl = $("#progressBar");
  const progressTextEl = $("#progressText");
  const bannerHost = $("#bannerHost");

  const toleranceEl = $("#tolerance");
  const keepColsGlobalEl = $("#keepColsGlobal");
  const csvDelimiterEl = $("#csvDelimiter");

  const globalTxidEl = $("#globalTxidSearch");
  const globalTxidClearEl = $("#globalTxidClear");

  const runBtn = $("#runBtn");

  // Add file: label + hidden input
  const filePicker = $("#filePicker");

  // Hidden settings required by worker
  const amountScaleEl = $("#amountScale");
  const amountToleranceEl = $("#amountTolerance");
  const reportLimitEl = $("#reportLimit");
  const statusMappingsEl = $("#statusMappings");

  // State
  const state = {
    files: [],
    primaryId: null,
    running: false,
    worker: null,
    blobUrls: [],
    globalTxid: "",
  };

  function showBanner(kind, title, text, actions = [], ttl = 6000) {
    if (!bannerHost) return;
    const el = document.createElement("div");
    el.className = `banner ${kind || "info"}`;
    el.innerHTML = `
      <div class="bannerTitle">${escapeHtml(title || "")}</div>
      <div class="bannerText">${escapeHtml(text || "")}</div>
      ${actions && actions.length ? `<div class="bannerActions">${actions.map((a, i) => `<button class="ghost small" data-ix="${i}">${escapeHtml(a.label || "Action")}</button>`).join("")}</div>` : ""}
    `;
    bannerHost.appendChild(el);

    if (actions && actions.length) {
      $$(".bannerActions button", el).forEach((b) => {
        b.addEventListener("click", () => {
          const ix = Number(b.getAttribute("data-ix") || 0);
          try { actions[ix]?.onClick?.(); } catch (_) {}
        });
      });
    }

    setTimeout(() => {
      el.classList.add("hide");
      setTimeout(() => el.remove(), 300);
    }, ttl);
  }

  function setProgress(text, pct) {
    if (progressSectionEl) progressSectionEl.hidden = false;
    if (progressTextEl) progressTextEl.textContent = text || "";
    const p = Math.max(0, Math.min(100, Number(pct || 0)));
    if (progressBarEl) progressBarEl.style.width = `${p}%`;
  }

  function hideProgress() {
    if (progressSectionEl) progressSectionEl.hidden = true;
    if (progressBarEl) progressBarEl.style.width = "0%";
    if (progressTextEl) progressTextEl.textContent = "";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function csvCell(v) {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  function toCsv(rows, headers) {
    const head = headers.map(csvCell).join(",");
    const body = rows.map((r) => headers.map((h) => csvCell(r[h])).join(",")).join("\n");
    return head + "\n" + body + "\n";
  }

  function downloadCsv(filename, csvText) {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 0);
  }

  async function decodeHeader(file, encoding, delimiter) {
    // Read small slice; PapaParse can handle UTF-8 well; encoding support is limited in browsers.
    const slice = file.slice(0, Math.min(512 * 1024, file.size));
    const text = await slice.text();
    return await new Promise((resolve, reject) => {
      Papa.parse(text, {
        delimiter: delimiter || "",
        preview: 1,
        skipEmptyLines: true,
        complete: (res) => resolve(((res.data && res.data[0]) || []).map((x) => String(x ?? "").trim())),
        error: (err) => reject(err),
      });
    });
  }

  function guessCol(header, rxList) {
    const h = header.map((x) => String(x || "").toLowerCase());
    for (const rx of rxList) {
      const ix = h.findIndex((c) => rx.test(c));
      if (ix >= 0) return ix;
    }
    return -1;
  }

  function addFile(fileObj) {
    const f = {
      id: uid(),
      file: fileObj,
      name: (fileObj?.name || `file${state.files.length + 1}`).replace(/\.[^.]+$/, ""),
      encoding: "utf-8",
      delimiter: ",",
      decimalComma: false,
      header: [],
      idCol: -1,
      amountCol: -1,
      statusCol: -1,
      keepColsText: "",
    };
    state.files.push(f);
    if (!state.primaryId) state.primaryId = f.id;
    renderFiles();
    refreshHeaderForFile(f.id).catch((e) => showBanner("warn", "Header read failed", e?.message || String(e)));
  }

  async function refreshHeaderForFile(fileId) {
    const f = state.files.find((x) => x.id === fileId);
    if (!f || !f.file) return;
    setProgress(`Reading header: ${f.name}…`, 0);
    const header = await decodeHeader(f.file, f.encoding, f.delimiter);
    f.header = header;

    if (f.idCol < 0) f.idCol = guessCol(header, [/txid/i, /transaction.?id/i, /\bid\b/i, /reference/i, /rrn/i]);
    if (f.amountCol < 0) f.amountCol = guessCol(header, [/amount/i, /amt/i, /sum/i, /value/i, /total/i]);
    if (f.statusCol < 0) f.statusCol = guessCol(header, [/status/i, /state/i, /result/i, /code/i]);

    renderFiles();
    hideProgress();
  }

  function renderFiles() {
    if (!filesEl) return;
    if (!state.files.length) {
      filesEl.innerHTML = `<div class="muted small">No files added yet</div>`;
      return;
    }

    filesEl.innerHTML = state.files.map((f) => {
      const opts = f.header.length
        ? f.header.map((c, i) => `<option value="${i}" ${i === f.idCol ? "selected" : ""}>${escapeHtml(c || `col${i}`)}</option>`).join("")
        : `<option value="-1" selected>(header not loaded)</option>`;

      const optsAmt = f.header.length
        ? f.header.map((c, i) => `<option value="${i}" ${i === f.amountCol ? "selected" : ""}>${escapeHtml(c || `col${i}`)}</option>`).join("")
        : `<option value="-1" selected>(header not loaded)</option>`;

      const optsSt = f.header.length
        ? [`<option value="-1" ${f.statusCol < 0 ? "selected" : ""}>(none)</option>`].concat(
          f.header.map((c, i) => `<option value="${i}" ${i === f.statusCol ? "selected" : ""}>${escapeHtml(c || `col${i}`)}</option>`)
        ).join("")
        : `<option value="-1" selected>(header not loaded)</option>`;

      return `
        <div class="fileCard">
          <div class="fileCardTop">
            <label class="radio">
              <input type="radio" name="primary" value="${f.id}" ${f.id === state.primaryId ? "checked" : ""}>
              <span>PRIMARY</span>
            </label>
            <div class="fileName mono">${escapeHtml(f.name)}</div>
            <button class="ghost small" data-act="remove" data-id="${f.id}">Remove</button>
          </div>

          <div class="fileGrid">
            <div class="fileField">
              <div class="muted small">TXID column</div>
              <select class="mono" data-act="idCol" data-id="${f.id}">${opts}</select>
            </div>
            <div class="fileField">
              <div class="muted small">AMOUNT column</div>
              <select class="mono" data-act="amountCol" data-id="${f.id}">${optsAmt}</select>
            </div>
            <div class="fileField">
              <div class="muted small">STATUS column</div>
              <select class="mono" data-act="statusCol" data-id="${f.id}">${optsSt}</select>
            </div>

            <div class="fileField">
              <div class="muted small">Keep columns (override)</div>
              <input class="mono" data-act="keepColsText" data-id="${f.id}" placeholder="colA, colB" value="${escapeHtml(f.keepColsText || "")}">
            </div>
          </div>

          <div class="fileCols mono small">${escapeHtml(f.header.join(", "))}</div>
        </div>
      `;
    }).join("");

    // bindings
    $$('input[name="primary"]', filesEl).forEach((r) => {
      r.addEventListener("change", () => {
        state.primaryId = r.value;
      });
    });

    $$("[data-act]", filesEl).forEach((el) => {
      const act = el.getAttribute("data-act");
      const id = el.getAttribute("data-id");
      el.addEventListener("change", () => {
        const f = state.files.find((x) => x.id === id);
        if (!f) return;
        if (act === "idCol") f.idCol = Number(el.value);
        if (act === "amountCol") f.amountCol = Number(el.value);
        if (act === "statusCol") f.statusCol = Number(el.value);
        if (act === "keepColsText") f.keepColsText = String(el.value || "");
      });
      el.addEventListener("click", () => {
        if (act !== "remove") return;
        const ix = state.files.findIndex((x) => x.id === id);
        if (ix >= 0) state.files.splice(ix, 1);
        if (state.primaryId === id) state.primaryId = state.files[0]?.id || null;
        renderFiles();
      });
    });
  }

  function getGlobalSettings() {
    const amountScale = Number(amountScaleEl?.value || 2);
    const tolUi = Number(toleranceEl?.value || 0.01);
    const amountTolerance = Math.max(0, Math.round(tolUi * Math.pow(10, amountScale)));
    if (amountToleranceEl) amountToleranceEl.value = String(amountTolerance);

    const reportLimit = Number(reportLimitEl?.value || 0);
    const statusMappings = String(statusMappingsEl?.value || "");

    const rawDelim = String(csvDelimiterEl?.value || "auto");
    const csvDelimiter = (rawDelim === "auto") ? "" : (rawDelim === "\\t" ? "\t" : rawDelim);

    return { amountScale, amountTolerance, reportLimit, statusMappings, csvDelimiter };
  }

  function validate() {
    const errs = [];
    if (state.files.length < 2) errs.push("Add at least two files.");
    const primary = state.files.find((f) => f.id === state.primaryId);
    if (!primary) errs.push("Select a PRIMARY file.");
    for (const f of state.files) {
      if (!f.file) errs.push(`File missing: ${f.name}`);
      if (!Array.isArray(f.header) || !f.header.length) errs.push(`Header not loaded yet: ${f.name}`);
      if (f.idCol < 0) errs.push(`TXID column not set: ${f.name}`);
      if (f.amountCol < 0) errs.push(`AMOUNT column not set: ${f.name}`);
    }
    return errs;
  }

  function buildCfg(f, keepColsFallback) {
    const keepCols = (f.keepColsText || "").split(",").map((x) => x.trim()).filter(Boolean);
    const keepColsGlobal = keepCols.length ? keepCols : keepColsFallback;
    const keepIdxs = [];
    const missing = [];
    for (const c of keepColsGlobal) {
      const ix = f.header.findIndex((h) => String(h).trim() === c);
      if (ix >= 0) keepIdxs.push(ix);
      else missing.push(c);
    }
    return {
      id: f.id,
      label: f.name,
      file: f.file,
      encoding: f.encoding || "utf-8",
      decimalComma: Boolean(f.decimalComma),
      hasHeader: true,
      txidIdx: Number(f.idCol),
      amountIdx: Number(f.amountCol),
      statusIdx: Number(f.statusCol),
      keepCols: keepColsGlobal,
      keepIdxs,
      _missingKeep: missing,
    };
  }

  function renderResults(pairReports) {
    const txFilter = state.globalTxid;
    const blocks = [];

    blocks.push(`<div class="result-block">
      <div class="result-title">
        <strong>Summary</strong>
        <span class="muted mono">${escapeHtml(new Date().toLocaleString())}</span>
      </div>
      <div class="result-grid">
        <div class="result-kv"><div class="muted small">Pairs</div><div class="mono">${pairReports.length}</div></div>
      </div>
    </div>`);

    for (const pr of pairReports) {
      const reports = pr.reports || {};
      const section = (title, repKey) => {
        const rep = reports[repKey] || { total: 0, rows: [] };
        const rows = Array.isArray(rep.rows) ? rep.rows : [];
        const filtered = txFilter ? rows.filter((r) => String(r.txid || "").includes(txFilter)) : rows;
        const show = filtered.slice(0, 200);
        const headers = show.length ? Object.keys(show[0]) : [];
        const table = headers.length
          ? `<table class="tbl">
              <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
              <tbody>
                ${show.map((r) => `<tr>${headers.map((h) => `<td class="mono">${escapeHtml(r[h])}</td>`).join("")}</tr>`).join("")}
              </tbody>
            </table>`
          : `<div class="muted small">No rows</div>`;

        const btn = rows.length ? `<button class="ghost small" data-dl="${pr.pairKey}::${repKey}">Download (capped)</button>` : "";
        return `<div class="result-sub">
          <div class="result-subhead">
            <div><strong>${escapeHtml(title)}</strong> <span class="muted small">total: ${escapeHtml(rep.total)}</span></div>
            <div>${btn}</div>
          </div>
          ${table}
        </div>`;
      };

      blocks.push(`<div class="result-block">
        <div class="result-title"><strong>${escapeHtml(pr.pairKey)}</strong></div>
        ${section("Mismatches", "mismatches")}
        ${section("Missing in base", "missing_in_base")}
        ${section("Missing in other", "missing_in_other")}
      </div>`);
    }

    resultsEl.innerHTML = blocks.join("");

    // download handlers
    $$("[data-dl]", resultsEl).forEach((b) => {
      b.addEventListener("click", () => {
        const v = b.getAttribute("data-dl") || "";
        const [pairKey, repKey] = v.split("::");
        const pr = pairReports.find((x) => x.pairKey === pairKey);
        const rep = pr?.reports?.[repKey];
        const rows = Array.isArray(rep?.rows) ? rep.rows : [];
        if (!rows.length) return;
        const headers = Object.keys(rows[0] || {});
        downloadCsv(`${repKey}__${pairKey}.csv`, toCsv(rows, headers));
      });
    });
  }

  async function run() {
    if (state.running) return;
    const errs = validate();
    if (errs.length) {
      resultsEl.innerHTML = `<div class="mono" style="color: var(--danger)">${escapeHtml(errs.join("\n"))}</div>`;
      return;
    }

    // cleanup old worker + URLs
    if (state.worker) {
      try { state.worker.terminate(); } catch (_) {}
      state.worker = null;
    }
    for (const u of state.blobUrls) {
      try { URL.revokeObjectURL(u); } catch (_) {}
    }
    state.blobUrls = [];

    state.running = true;
    setProgress("Starting…", 0);

    const gs = getGlobalSettings();

    const primary = state.files.find((f) => f.id === state.primaryId) || state.files[0];
    const others = state.files.filter((f) => f.id !== primary.id);

    const keepColsGlobal = (keepColsGlobalEl?.value || "").split(",").map((x) => x.trim()).filter(Boolean);

    const primaryCfg = buildCfg(primary, keepColsGlobal);
    const otherCfgs = others.map((f) => buildCfg(f, keepColsGlobal));

    const missingKeep = new Set([...(primaryCfg._missingKeep || [])]);
    for (const o of otherCfgs) for (const c of (o._missingKeep || [])) missingKeep.add(c);
    if (missingKeep.size) {
      showBanner("warn", "Keep columns", `Not found in header (skipped): ${Array.from(missingKeep).join(", ")}`, []);
    }

    // strip helper field
    delete primaryCfg._missingKeep;
    for (const o of otherCfgs) delete o._missingKeep;

    const w = new Worker(`./worker.js?v=${encodeURIComponent(APP_VERSION)}`);
    state.worker = w;

    const fail = (msg) => {
      showBanner("danger", "Worker error", msg, []);
      resultsEl.innerHTML = `<div class="mono" style="color: var(--danger)">${escapeHtml(msg)}</div>`;
      state.running = false;
      try { w.terminate(); } catch (_) {}
      hideProgress();
    };

    w.onerror = (ev) => fail(ev?.message || "Worker crashed.");

    w.onmessage = (ev) => {
      const m = ev.data || {};
      const type = m.type;

      if (type === "STAGE" || type === "PROGRESS") {
        setProgress(m.text || "Working…", Number(m.pct || 0));
        return;
      }
      if (type === "ERROR") {
        fail(m.error || m.message || m.text || "Unknown error");
        return;
      }
      if (type === "DONE") {
        const pairReports = Array.isArray(m.pairReports) ? m.pairReports : [];
        renderResults(pairReports);
        setProgress("Done.", 100);
        setTimeout(() => hideProgress(), 400);
        state.running = false;
        try { w.terminate(); } catch (_) {}
        state.worker = null;
      }
    };

    w.postMessage({
      type: "RUN",
      globalSettings: {
        amountScale: gs.amountScale,
        amountTolerance: gs.amountTolerance,
        reportLimit: gs.reportLimit,
        statusMappings: gs.statusMappings,
      },
      primary: primaryCfg,
      others: otherCfgs,
    });
  }

  // Bindings
  function bind() {
    if (!window.Papa) {
      showBanner("danger", "PapaParse not loaded", "CDN blocked or offline.", []);
      return;
    }

    // Picker change handler (label opens it natively)
    if (filePicker) {
      filePicker.addEventListener("change", () => {
        const file = filePicker.files && filePicker.files[0];
        if (!file) return;
        // allow selecting same file again later
        filePicker.value = "";
        addFile(file);
      });
    }

    // Run
    runBtn?.addEventListener("click", () => run());

    // Global txid filter
    globalTxidEl?.addEventListener("input", () => {
      state.globalTxid = (globalTxidEl.value || "").trim();
      // rerender with filter only if we already have results
      // (renderResults called again on next DONE anyway)
    });
    globalTxidClearEl?.addEventListener("click", () => {
      state.globalTxid = "";
      if (globalTxidEl) globalTxidEl.value = "";
    });

    // Tolerance → scaled tolerance
    toleranceEl?.addEventListener("change", () => {
      try {
        const gs = getGlobalSettings();
        if (amountToleranceEl) amountToleranceEl.value = String(gs.amountTolerance);
      } catch (_) {}
    });

    renderFiles();
  }

  document.addEventListener("DOMContentLoaded", bind);
})();
