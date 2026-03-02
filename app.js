/* CSV Reconciler — worker-first UI (build 5.0.4) */
/* global Papa */
(() => {
  const $ = (sel) => document.querySelector(sel);

  const els = {
    files: $("#files"),
    results: $("#results"),
    progress: $("#progress"),
    progressBar: $("#progressBar"),
    progressText: $("#progressText"),
    bannerHost: $("#bannerHost"),
    tolerance: $("#tolerance"),
    defaultDelimiter: $("#defaultDelimiter"),
    keepColsGlobal: $("#keepColsGlobal"),
    globalTxidSearch: $("#globalTxidSearch"),
    globalTxidClear: $("#globalTxidClear"),
    runBtn: $("#runBtn"),
    filePicker: $("#filePicker"),
  
  detailsPanel: $("#detailsPanel"),
  detailsBody: $("#detailsBody"),
  detailsCloseBtn: $("#detailsCloseBtn"),
  detailsCopyTxidBtn: $("#detailsCopyTxidBtn"),
  modalBackdrop: $("#modalBackdrop"),
  modal: $("#modal"),
  modalTitle: $("#modalTitle"),
  modalBody: $("#modalBody"),
  modalFoot: $("#modalFoot"),
  modalClose: $("#modalClose"),
};


  const state = {
    files: [], // {id,name,file,delimiter,encoding,decimalComma,cols,txidCol,amountCol,statusCol,keepColsOverride,primary}
    primaryId: null,
    running: false,
    ui: { expanded: new Map() },

    resultsByPair: new Map(), // pairKey -> reports payload from worker
    uiFilterByPair: new Map(), // pairKey -> {filter,search}
  };

  const uid = () => Math.random().toString(36).slice(2, 10);

  function showBanner(kind, title, text, ttl=6000) {
    const host = els.bannerHost;
    if (!host) return;
    const el = document.createElement("div");
    el.className = `banner ${kind||"info"}`;
    el.innerHTML = `<div class="bTitle">${escapeHtml(title||"")}</div><div class="bText">${escapeHtml(text||"")}</div>`;
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add("hide");
      setTimeout(() => el.remove(), 250);
    }, ttl);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }

  function setProgress(text, pct) {
    if (!els.progress) return;
    els.progress.hidden = false;
    if (els.progressText) els.progressText.textContent = text || "Working…";
    if (els.progressBar) els.progressBar.style.width = `${Math.max(0, Math.min(100, pct||0))}%`;
  }

  function clearProgress() {
    if (!els.progress) return;
    els.progress.hidden = true;
    if (els.progressText) els.progressText.textContent = "Working…";
    if (els.progressBar) els.progressBar.style.width = "0%";
  }

  function normalizeDelimiter(v) {
    if (v === "\\t") return "\t";
    return v || "";
  }

  function fileDefaultDelimiter() {
    return normalizeDelimiter(els.defaultDelimiter?.value || "");
  }

  async function parseHeader(fileObj) {
    // Use PapaParse in main thread to preview header and populate selects.
    const delim = fileObj.delimiter ? normalizeDelimiter(fileObj.delimiter) : "";
    return new Promise((resolve) => {
      Papa.parse(fileObj.file, {
        header: true,
        skipEmptyLines: true,
        preview: 1,
        delimiter: delim || undefined,
        complete: (res) => {
          fileObj.cols = (res.meta && res.meta.fields) ? res.meta.fields : [];
          resolve(fileObj.cols);
        },
        error: () => {
          fileObj.cols = [];
          resolve([]);
        }
      });
    });
  }

  function addFileFromPicker(file) {
    const id = uid();
    const name = (file.name || "").replace(/\.[^.]+$/, "");
    const obj = {
      id, name,
      file,
      delimiter: fileDefaultDelimiter(), // per-file (can change in UI)
      encoding: "utf-8",
      decimalComma: false,
      cols: [],
      txidCol: "",
      amountCol: "",
      statusCol: "",
      keepColsOverride: "",
      primary: false,
    };
    state.files.push(obj);
    if (!state.primaryId) {
      state.primaryId = id;
      obj.primary = true;
    }
    // parse header async then render
    parseHeader(obj).then(() => {
      // default guess: first col for txid, amount/status try common names
      guessDefaultCols(obj);
      renderFiles();
    });
    renderFiles();
  }

  function guessDefaultCols(f) {
    const cols = f.cols || [];
    const pick = (cands) => cands.find(c => cols.includes(c)) || "";
    if (!f.txidCol) f.txidCol = pick(["transaction_id","txid","id","ID","Transaction ID"]) || cols[0] || "";
    if (!f.amountCol) f.amountCol = pick(["amount","Amount","payment_amount","paid_amount","sum","value"]) || "";
    if (!f.statusCol) f.statusCol = pick(["status","Status","callback_status","state"]) || "";
  }

  function removeFile(id) {
    const idx = state.files.findIndex(f => f.id === id);
    if (idx < 0) return;
    const wasPrimary = state.files[idx].primary;
    state.files.splice(idx, 1);
    if (wasPrimary) {
      state.primaryId = state.files[0]?.id || null;
      state.files.forEach((f,i) => f.primary = (f.id === state.primaryId));
    }
    renderFiles();
  }

  function setPrimary(id) {
    state.primaryId = id;
    state.files.forEach(f => f.primary = (f.id === id));
    renderFiles();
  }

  function renderFiles() {
    if (!els.files) return;
    if (!state.files.length) {
      els.files.innerHTML = `<div class="muted small">No files yet</div>`;
      return;
    }

    const delimiterOptions = `
      <option value="">Auto-detect</option>
      <option value=",">Comma (,)</option>
      <option value=";">Semicolon (;)</option>
      <option value="\\t">Tab (\\t)</option>
      <option value="|">Pipe (|)</option>`;

    els.files.innerHTML = state.files.map((f, idx) => {
      const cols = (f.cols && f.cols.length) ? f.cols : [];
      const opt = (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;
      const sel = (cur, v) => (String(cur)===String(v) ? "selected" : "");
      const colsOpts = cols.map(c => `<option value="${escapeHtml(c)}" ${sel(f.txidCol,c)}>${escapeHtml(c)}</option>`).join("");
      const amtOpts  = cols.map(c => `<option value="${escapeHtml(c)}" ${sel(f.amountCol,c)}>${escapeHtml(c)}</option>`).join("");
      const stOpts   = cols.map(c => `<option value="${escapeHtml(c)}" ${sel(f.statusCol,c)}>${escapeHtml(c)}</option>`).join("");
      const headerLine = cols.length ? cols.join(" | ") : "—";

      return `
      <div class="fileCard">
        <div class="fileCardTop">
          <label class="radio">
            <input type="radio" name="primary" ${f.primary ? "checked" : ""} data-primary="${f.id}">
            <span>PRIMARY</span>
          </label>
          <div class="fileTitle mono">${escapeHtml(f.name || ("File "+(idx+1)))}</div>
          <button class="ghost small" data-remove="${f.id}">Remove</button>
        </div>

        <div class="fileGrid">
          <div class="fg">
            <div class="muted small">Delimiter</div>
            <select class="mono" data-delim="${f.id}">
              ${delimiterOptions.replace(`value="${escapeHtml(f.delimiter||"")}"`, `value="${escapeHtml(f.delimiter||"")}" selected`)}
            </select>
          </div>

          <div class="fg">
            <div class="muted small">Encoding</div>
            <select class="mono" data-enc="${f.id}">
              <option value="utf-8" ${sel(f.encoding,"utf-8")}>utf-8</option>
              <option value="windows-1251" ${sel(f.encoding,"windows-1251")}>windows-1251</option>
            </select>
          </div>

          <div class="fg">
            <div class="muted small">Decimal comma</div>
            <select class="mono" data-dec="${f.id}">
              <option value="0" ${f.decimalComma ? "" : "selected"}>No (12.34)</option>
              <option value="1" ${f.decimalComma ? "selected" : ""}>Yes (12,34)</option>
            </select>
          </div>
        </div>

        <div class="fileGrid cols3">
          <div class="fg">
            <div class="muted small">TXID column</div>
            <select class="mono" data-txid="${f.id}">${colsOpts}</select>
          </div>
          <div class="fg">
            <div class="muted small">AMOUNT column</div>
            <select class="mono" data-amt="${f.id}">${amtOpts}</select>
          </div>
          <div class="fg">
            <div class="muted small">STATUS column</div>
            <select class="mono" data-st="${f.id}">${stOpts}</select>
          </div>
        </div>

        <div class="fg" style="margin-top:10px">
          <div class="muted small">Keep columns (override, comma-separated)</div>
          <input class="mono" data-keep="${f.id}" placeholder="e.g. created_at, merchant" value="${escapeHtml(f.keepColsOverride||"")}"/>
        </div>

        <div class="muted small" style="margin-top:8px">Header loaded: <span class="mono">${escapeHtml(headerLine)}</span></div>
      </div>
      `;
    }).join("");

    // bind events
    els.files.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => removeFile(btn.getAttribute("data-remove")));
    });
    els.files.querySelectorAll("input[data-primary]").forEach(r => {
      r.addEventListener("change", () => setPrimary(r.getAttribute("data-primary")));
    });
    els.files.querySelectorAll("select[data-delim]").forEach(selEl => {
      selEl.addEventListener("change", async () => {
        const id = selEl.getAttribute("data-delim");
        const f = state.files.find(x => x.id === id);
        if (!f) return;
        f.delimiter = normalizeDelimiter(selEl.value);
        await parseHeader(f);
        guessDefaultCols(f);
        renderFiles();
      });
    });
    els.files.querySelectorAll("select[data-enc]").forEach(selEl => {
      selEl.addEventListener("change", async () => {
        const id = selEl.getAttribute("data-enc");
        const f = state.files.find(x => x.id === id);
        if (!f) return;
        f.encoding = selEl.value;
        await parseHeader(f);
        guessDefaultCols(f);
        renderFiles();
      });
    });
    els.files.querySelectorAll("select[data-dec]").forEach(selEl => {
      selEl.addEventListener("change", () => {
        const id = selEl.getAttribute("data-dec");
        const f = state.files.find(x => x.id === id);
        if (!f) return;
        f.decimalComma = selEl.value === "1";
      });
    });
    els.files.querySelectorAll("select[data-txid]").forEach(selEl => {
      selEl.addEventListener("change", () => {
        const f = state.files.find(x => x.id === selEl.getAttribute("data-txid"));
        if (f) f.txidCol = selEl.value;
      });
    });
    els.files.querySelectorAll("select[data-amt]").forEach(selEl => {
      selEl.addEventListener("change", () => {
        const f = state.files.find(x => x.id === selEl.getAttribute("data-amt"));
        if (f) f.amountCol = selEl.value;
      });
    });
    els.files.querySelectorAll("select[data-st]").forEach(selEl => {
      selEl.addEventListener("change", () => {
        const f = state.files.find(x => x.id === selEl.getAttribute("data-st"));
        if (f) f.statusCol = selEl.value;
      });
    });
    els.files.querySelectorAll("input[data-keep]").forEach(inp => {
      inp.addEventListener("input", () => {
        const f = state.files.find(x => x.id === inp.getAttribute("data-keep"));
        if (f) f.keepColsOverride = inp.value;
      });
    });
  }

  
function getFileLabel(id) {
  const f = state.files.find(x => x.id === id);
  return f ? (f.name || id) : id;
}

function getPairLabel(pairKey) {
  const [a, b] = String(pairKey).split("::");
  const la = getFileLabel(a);
  const lb = getFileLabel(b);
  return { la, lb, a, b, text: `${la} ↔ ${lb}` };
}

function toggleExpanded(pairKey, kind) {
  if (!state.ui.expanded.has(pairKey)) state.ui.expanded.set(pairKey, new Set());
  const set = state.ui.expanded.get(pairKey);
  if (set.has(kind)) set.delete(kind);
  else set.add(kind);
}

function isExpanded(pairKey, kind) {
  const set = state.ui.expanded.get(pairKey);
  return !!(set && set.has(kind));
}

function renderRowsTable(pairKey, kind, rows) {
  if (!rows || !rows.length) return `<div class="muted small">No rows</div>`;
  const head = `
    <div class="rowsHead">
      <div class="muted small mono">Showing ${rows.length} rows (UI cap)</div>
    </div>`;
  const body = rows.slice(0, 200).map((r) => {
    const txid = r.txid ?? "";
    const bAmt = r.base_amount_scaled ?? "";
    const oAmt = r.other_amount_scaled ?? "";
    const bSt = r.base_status ?? "";
    const oSt = r.other_status ?? "";
    return `
      <div class="resultRow clickable"
           data-action="openDetails"
           data-pair-key="${escapeHtml(pairKey)}"
           data-kind="${escapeHtml(kind)}"
           data-txid="${escapeHtml(String(txid))}">
        <div class="mono">${escapeHtml(String(txid))}</div>
        <div class="mono">${escapeHtml(String(bAmt))}</div>
        <div class="mono">${escapeHtml(String(oAmt))}</div>
        <div class="mono muted">${escapeHtml(String(bSt))}</div>
        <div class="mono muted">${escapeHtml(String(oSt))}</div>
      </div>`;
  }).join("");
  const more = rows.length > 200 ? `<div class="muted small">+ ${rows.length - 200} more rows (export for full)</div>` : "";
  return `
    ${head}
    <div class="rowsTable">
      <div class="resultRow header">
        <div class="muted small">txid</div>
        <div class="muted small">base_amount_scaled</div>
        <div class="muted small">other_amount_scaled</div>
        <div class="muted small">base_status</div>
        <div class="muted small">other_status</div>
      </div>
      ${body}
    </div>
    ${more}
  `;
}

function renderResults() {
  if (!els.results) return;
  const pairs = Array.from(state.resultsByPair.entries());
  if (!pairs.length) {
    els.results.innerHTML = `<div class="muted small">No results</div>`;
    return;
  }

  els.results.innerHTML = pairs.map(([pairKey, payload]) => {
    const rep = payload.reports || {};
    const mismatchTotal = rep.mismatches?.total ?? (rep.mismatches?.rows?.length || 0);
    const missBaseTotal = rep.missing_in_base?.total ?? (rep.missing_in_base?.rows?.length || 0);
    const missOtherTotal = rep.missing_in_other?.total ?? (rep.missing_in_other?.rows?.length || 0);

    const label = getPairLabel(pairKey);

    const sec = (kind, title, total) => {
      const exp = isExpanded(pairKey, kind);
      const rows = rep[kind]?.rows || [];
      return `
        <div class="pairSection">
          <button class="ghost small"
                  data-action="toggleRows"
                  data-pair-key="${escapeHtml(pairKey)}"
                  data-kind="${escapeHtml(kind)}">
            ${escapeHtml(title)}: <b>${total}</b> ${exp ? "▾" : "▸"}
          </button>
          ${exp ? `<div class="pairRows">${renderRowsTable(pairKey, kind, rows)}</div>` : ``}
        </div>
      `;
    };

    return `
      <div class="pairBlock" data-pair-key="${escapeHtml(pairKey)}">
        <div class="pairHead">
          <div>
            <div class="pairTitle mono">${escapeHtml(label.text)}</div>
            <div class="muted small mono">${escapeHtml(label.a)} :: ${escapeHtml(label.b)}</div>
          </div>
        </div>
        ${sec("mismatches", "mismatches", mismatchTotal)}
        ${sec("missing_in_base", "missing_in_base", missBaseTotal)}
        ${sec("missing_in_other", "missing_in_other", missOtherTotal)}
      </div>
    `;
  }).join("");
}


  

function openModal(title, bodyHtml, footHtml = "") {
  if (!els.modalBackdrop || !els.modal) return;
  if (els.modalTitle) els.modalTitle.textContent = title || "";
  if (els.modalBody) els.modalBody.innerHTML = bodyHtml || "";
  if (els.modalFoot) els.modalFoot.innerHTML = footHtml || "";
  els.modalBackdrop.hidden = false;
  els.modal.hidden = false;
}

function closeModal() {
  if (!els.modalBackdrop || !els.modal) return;
  els.modalBackdrop.hidden = true;
  els.modal.hidden = true;
  if (els.modalTitle) els.modalTitle.textContent = "";
  if (els.modalBody) els.modalBody.innerHTML = "";
  if (els.modalFoot) els.modalFoot.innerHTML = "";
}

function closeDetails() {
  if (!els.detailsPanel) return;
  els.detailsPanel.hidden = true;
  if (els.detailsBody) els.detailsBody.innerHTML = "";
  els.detailsPanel.dataset.txid = "";
}

async function requestDetailsBatch(fileSide, fileId, txids) {
  const w = ensureWorker();
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const msg = ev.data || {};
      if (msg.type !== "DETAILS_BATCH_DONE") return;
      const p = msg.payload || {};
      if (p.fileId !== fileId || p.fileSide !== fileSide) return;
      w.removeEventListener("message", handler);
      resolve(p.rows || {});
    };
    w.addEventListener("message", handler);
    w.postMessage({ type: "DETAILS_BATCH", fileSide, fileId, txids });
    // simple timeout
    setTimeout(() => {
      try { w.removeEventListener("message", handler); } catch {}
      reject(new Error("DETAILS_BATCH timeout"));
    }, 20000);
  });
}

async function openDetails(pairKey, kind, txid) {
  if (!els.detailsPanel || !els.detailsBody) return;
  const payload = state.resultsByPair.get(pairKey);
  if (!payload) return;

  const label = getPairLabel(pairKey);
  els.detailsPanel.hidden = false;
  els.detailsPanel.dataset.txid = txid;

  els.detailsBody.innerHTML = `
    <div class="muted small">Loading details for <span class="mono">${escapeHtml(txid)}</span>…</div>
  `;

  try {
    const baseId = payload.baseId || label.a;
    const otherId = payload.otherId || label.b;

    // request full rows from worker (both sides)
    const [baseRows, otherRows] = await Promise.all([
      requestDetailsBatch("base", baseId, [txid]).catch(() => ({})),
      requestDetailsBatch("other", otherId, [txid]).catch(() => ({})),
    ]);

    const b = baseRows[txid] || null;
    const o = otherRows[txid] || null;

    const rep = payload.reports || {};
    const row = (rep[kind]?.rows || []).find(r => String(r.txid) === String(txid)) || null;

    const fmtObj = (obj) => obj ? `<pre class="mono small">${escapeHtml(JSON.stringify(obj, null, 2))}</pre>` : `<div class="muted small">No row found</div>`;

    els.detailsBody.innerHTML = `
      <div class="detailsMeta">
        <div class="mono"><b>${escapeHtml(label.text)}</b></div>
        <div class="muted small">kind: <span class="mono">${escapeHtml(kind)}</span></div>
      </div>
      ${row ? `<div class="card"><div class="muted small">Report row (summary)</div>${fmtObj(row)}</div>` : ""}
      <div class="grid2">
        <div class="card">
          <div class="muted small">Base row (${escapeHtml(getFileLabel(baseId))})</div>
          ${fmtObj(b)}
        </div>
        <div class="card">
          <div class="muted small">Other row (${escapeHtml(getFileLabel(otherId))})</div>
          ${fmtObj(o)}
        </div>
      </div>
    `;
  } catch (e) {
    els.detailsBody.innerHTML = `<div class="muted small">Failed to load details: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

  function buildCfgForFile(f, globalKeepCols) {
    const cols = f.cols || [];
    const idxOf = (name) => name ? cols.indexOf(name) : -1;
    const keepCols = (f.keepColsOverride || "").trim()
      ? f.keepColsOverride.split(",").map(s=>s.trim()).filter(Boolean)
      : globalKeepCols;

    const keepIdxs = keepCols.map(c => cols.indexOf(c)).filter(i => i >= 0);

    return {
      // IMPORTANT: worker expects stable ids to build pairKey and to serve DETAILS_BATCH.
      id: f.id,
      file: f.file,
      name: f.name,
      encoding: f.encoding || "utf-8",
      delimiter: f.delimiter ? normalizeDelimiter(f.delimiter) : "",
      decimalComma: !!f.decimalComma,
      txidIdx: idxOf(f.txidCol),
      amtIdx: idxOf(f.amountCol),
      statusIdx: idxOf(f.statusCol),
      keepIdxs,
      keepCols
    };
  }

  let worker = null;
  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker("./worker.js?v=5.0.5");
    worker.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === "STAGE") {
        setProgress(msg.text || "Working…", msg.pct || 0);
        return;
      }
      if (msg.type === "DONE") {
        clearProgress();
        state.running = false;
        els.runBtn.disabled = false;
        // Worker returns { pairReports: [...] } (older builds might use {pairs:[...]}).
        state.resultsByPair.clear();
        const list = msg.pairReports || msg.pairs || [];
        list.forEach(p => state.resultsByPair.set(p.pairKey, p));
        renderResults();
        showBanner("ok","Done","Reconciliation complete.",3000);
        return;
      }
      if (msg.type === "ERROR") {
        clearProgress();
        state.running = false;
        els.runBtn.disabled = false;
        showBanner("warn","Worker error", msg.message || "Unknown error");
        return;
      }
      if (msg.type === "CANCELLED") {
        clearProgress();
        state.running = false;
        els.runBtn.disabled = false;
        showBanner("info","Cancelled","Run cancelled.");
      }
    };
    worker.onerror = (e) => {
      clearProgress();
      state.running = false;
      els.runBtn.disabled = false;
      showBanner("warn","Worker crashed", e.message || "Worker error");
    };
    return worker;
  }

  function run() {
    if (state.running) return;
    if (state.files.length < 2) {
      showBanner("warn","Need files","Upload at least 2 CSV files.");
      return;
    }
    const primary = state.files.find(f => f.primary) || state.files.find(f => f.id === state.primaryId);
    if (!primary) {
      showBanner("warn","Primary missing","Pick PRIMARY file.");
      return;
    }

    // Validate column selection
    for (const f of state.files) {
      if (!f.txidCol || !f.amountCol) {
        showBanner("warn","Missing mapping", `Select TXID and AMOUNT columns for "${f.name}".`);
        return;
      }
    }

    const tolerance = parseFloat(els.tolerance?.value || "0.01") || 0.01;
    const globalKeepCols = (els.keepColsGlobal?.value || "").split(",").map(s=>s.trim()).filter(Boolean);

    const gs = {
      amountScale: 100,                 // cents
      amountTolerance: Math.round(tolerance * 100), // scaled tolerance
      statusMappings: "",               // keep default
    };

    const primaryCfg = buildCfgForFile(primary, globalKeepCols);
    const othersCfg = state.files.filter(f => f.id !== primary.id).map(f => buildCfgForFile(f, globalKeepCols));

    state.running = true;
    els.runBtn.disabled = true;
    setProgress("Starting…", 1);

    const w = ensureWorker();
    w.postMessage({
      type: "RUN",
      globalSettings: gs,
      primary: primaryCfg,
      others: othersCfg,
    });
  }

  function bind() {
    // picker change
    els.filePicker?.addEventListener("change", () => {
      const file = els.filePicker.files && els.filePicker.files[0];
      if (!file) return;
      els.filePicker.value = "";
      addFileFromPicker(file);
    });
    els.runBtn?.addEventListener("click", run);
    els.globalTxidClear?.addEventListener("click", () => {
      if (els.globalTxidSearch) els.globalTxidSearch.value = "";
    });
    // keyboard access for label
    const addBtn = $("#addFileBtn");
    if (addBtn) {
      addBtn.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          addBtn.click();
        }
      });
    }
    window.addEventListener("error", (e) => {
      showBanner("warn","JS error", e.message || "Unknown error");
    });
    window.addEventListener("unhandledrejection", (e) => {
      showBanner("warn","Promise rejection", (e.reason && e.reason.message) ? e.reason.message : String(e.reason));
    });
  }

  bind();
  renderFiles();
  renderResults();
})();
