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
  };

  const state = {
    files: [], // {id,name,file,delimiter,encoding,decimalComma,cols,txidCol,amountCol,statusCol,keepColsOverride,primary}
    primaryId: null,
    running: false,
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

  function renderResults() {
    if (!els.results) return;
    const pairs = Array.from(state.resultsByPair.entries());
    if (!pairs.length) {
      els.results.innerHTML = `<div class="muted small">No results</div>`;
      return;
    }
    // Simple: show per-pair KPIs and first rows table
    els.results.innerHTML = pairs.map(([pairKey, payload]) => {
      const rep = payload.reports;
      const mismatchN = rep.mismatches?.rows?.length || 0;
      const missBaseN = rep.missing_in_base?.rows?.length || 0;
      const missOtherN = rep.missing_in_other?.rows?.length || 0;
      return `
      <div class="pairBlock" data-pair-key="${escapeHtml(pairKey)}">
        <div class="pairHead">
          <div class="pairTitle mono">${escapeHtml(pairKey)}</div>
          <div class="pairKpis">
            <span class="kpi">mismatches: <b>${mismatchN}</b></span>
            <span class="kpi">missing_in_base: <b>${missBaseN}</b></span>
            <span class="kpi">missing_in_other: <b>${missOtherN}</b></span>
          </div>
        </div>
      </div>`;
    }).join("");
  }

  function buildCfgForFile(f, globalKeepCols) {
    const cols = f.cols || [];
    const idxOf = (name) => name ? cols.indexOf(name) : -1;
    const keepCols = (f.keepColsOverride || "").trim()
      ? f.keepColsOverride.split(",").map(s=>s.trim()).filter(Boolean)
      : globalKeepCols;

    const keepIdxs = keepCols.map(c => cols.indexOf(c)).filter(i => i >= 0);

    return {
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
    worker = new Worker("./worker.js?v=5.0.4");
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
        // msg.pairs is array of {pairKey,reports,keepCols,amountScale}
        state.resultsByPair.clear();
        (msg.pairs || []).forEach(p => {
          state.resultsByPair.set(p.pairKey, p);
        });
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
