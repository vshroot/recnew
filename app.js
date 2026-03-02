/* Reconciler build: 5.0.1+ui.v5 (2026-02-27 16:20:42Z) */
const APP_VERSION = "5.0.1+ui.v5";
/* global Papa */

(() => {
  const $ = (sel) => document.querySelector(sel);
  const filesEl = $("#files");
  const resultsEl = $("#results");
  const progressEl = $("#progress");
  const progressBarEl = $("#progressBar");
  const bannerHost = $("#bannerHost");
  const detailsPanelEl = $("#detailsPanel");
  const detailsBodyEl = $("#detailsBody");
  const detailsCloseBtn = $("#detailsCloseBtn");
  const detailsCopyTxidBtn = $("#detailsCopyTxidBtn");
  const globalTxidSearchEl = $("#globalTxidSearch");
  const globalTxidClearEl = $("#globalTxidClear");
  const viewsBtn = $("#viewsBtn");
  const colsBtn = $("#colsBtn");
  const perfBarEl = $("#perfBar");
  const modalBackdropEl = $("#modalBackdrop");
  const modalEl = $("#modal");
  const modalTitleEl = $("#modalTitle");
  const modalBodyEl = $("#modalBody");
  const modalFootEl = $("#modalFoot");
  const modalCloseEl = $("#modalClose");



  const state = {
    files: [],
    primaryId: null,
    running: false,
    blobUrls: [],
    lastDiagnostics: null,
  };

  // Per-pair reports store and pagination/filter state (keyed by pairKey string).
  const diffReports = new Map(); // pairKey → { reports, keepCols, amountScale }
  const diffState   = new Map(); // pairKey → { filter, page, pageSize }

  // === UI v4: persist UI settings ===
const COLS_KEY = "reconciler.columnPrefs.v5";

function loadColPrefs() {
  try { return JSON.parse(localStorage.getItem(COLS_KEY) || "{}"); } catch { return {}; }
}
function saveColPrefs(obj) {
  try { localStorage.setItem(COLS_KEY, JSON.stringify(obj)); } catch {}
}

const VIEWS_KEY = "reconciler.savedViews.v5";

function loadViews() {
  try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || "[]"); } catch { return []; }
}
function saveViews(list) {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(list)); } catch {}
}

const UI_STATE_KEY = "reconciler.uiState.v4";

function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveUiState(obj) {
  try { localStorage.setItem(UI_STATE_KEY, JSON.stringify(obj)); } catch {}
}

function snapshotUiState() {
  const out = {};
  for (const [pairKey, st] of diffState.entries()) {
    out[pairKey] = {
      filter: st.filter, page: st.page, pageSize: st.pageSize,
      search: st.search, mismatchType: st.mismatchType, statusFilter: st.statusFilter,
      amtMin: st.amtMin, amtMax: st.amtMax
    };
  }
  return out;
}

function restoreUiState(snapshot) {
  if (!snapshot) return;
  for (const [pairKey, vals] of Object.entries(snapshot)) {
    const st = diffState.get(pairKey);
    if (!st) continue;
    Object.assign(st, vals);
    diffState.set(pairKey, st);
  }
}

// === UI v2: Delegated interactions (pair KPI, per-pair search, row details) ===
resultsEl.addEventListener("click", (ev) => {
  const kpiBtn = ev.target.closest("[data-kpi-filter]");
  if (kpiBtn) {
    const pairBlock = ev.target.closest("[data-pair-key]");
    if (!pairBlock) return;
    const pairKey = pairBlock.getAttribute("data-pair-key");
    const filter = kpiBtn.getAttribute("data-kpi-filter");
    const st = diffState.get(pairKey);
    if (st) { st.filter = filter; st.page = 1; diffState.set(pairKey, st); reRenderPairTable(pairKey); }
    return;
  }

  const tr = ev.target.closest("tr[data-txid][data-row-type]");
  if (tr) {
    const pairBlock = ev.target.closest("[data-pair-key]");
    if (!pairBlock) return;
    const pairKey = pairBlock.getAttribute("data-pair-key");
    const txid = tr.getAttribute("data-txid");
    const rowType = tr.getAttribute("data-row-type");
    const reportData = diffReports.get(pairKey);
    if (!reportData) return;
    const { reports, keepCols, amountScale } = reportData;

    const src = (rowType === "mismatch") ? reports.mismatches.rows
      : (rowType === "missing_in_base") ? reports.missing_in_base.rows
      : (rowType === "missing_in_other") ? reports.missing_in_other.rows
      : [];
    const row = src.find(r => String(r.txid) === String(txid));
    if (!row) return;
    showDetailsPanel({ pairKey, rowType, row, keepCols, amountScale });
    return;
  }
});

resultsEl.addEventListener("input", (ev) => {
  const search = ev.target.closest("input[data-pair-search]");
  if (search) {
    const pairBlock = ev.target.closest("[data-pair-key]");
    if (!pairBlock) return;
    const pairKey = pairBlock.getAttribute("data-pair-key");
    const st = diffState.get(pairKey);
    if (st) { st.search = search.value || ""; st.page = 1; diffState.set(pairKey, st); reRenderPairTable(pairKey); }
  }
});

resultsEl.addEventListener("change", (ev) => {
  const sel = ev.target.closest("select[data-pair-page-size]");
  if (sel) {
    const pairBlock = ev.target.closest("[data-pair-key]");
    if (!pairBlock) return;
    const pairKey = pairBlock.getAttribute("data-pair-key");
    const st = diffState.get(pairKey);
    if (st) { st.pageSize = parseInt(sel.value || "50", 10); st.page = 1; diffState.set(pairKey, st); reRenderPairTable(pairKey); }
    return;
  }

  const mismatchType = ev.target.closest("select[data-pair-mismatch-type]");
  if (mismatchType) {
    const pairBlock = ev.target.closest("[data-pair-key]");
    if (!pairBlock) return;
    const pairKey = pairBlock.getAttribute("data-pair-key");
    const st = diffState.get(pairKey);
    if (st) { st.mismatchType = mismatchType.value || "all"; st.page = 1; diffState.set(pairKey, st); reRenderPairTable(pairKey); }
    return;
  }

  const statusFilter = ev.target.closest("select[data-pair-status-filter]");
  if (statusFilter) {
    const pairBlock = ev.target.closest("[data-pair-key]");
    if (!pairBlock) return;
    const pairKey = pairBlock.getAttribute("data-pair-key");
    const st = diffState.get(pairKey);
    if (st) { st.statusFilter = statusFilter.value || "all"; st.page = 1; diffState.set(pairKey, st); reRenderPairTable(pairKey); }
    return;
  }
});

resultsEl.addEventListener("click", (ev) => {
  const p = ev.target.closest("button[data-pair-page]");
  if (!p) return;
  const pairBlock = ev.target.closest("[data-pair-key]");
  if (!pairBlock) return;
  const pairKey = pairBlock.getAttribute("data-pair-key");
  const st = diffState.get(pairKey);
  if (!st) return;
  const dir = p.getAttribute("data-pair-page");
  if (dir === "prev") st.page = Math.max(1, (st.page || 1) - 1);
  if (dir === "next") st.page = (st.page || 1) + 1;
  diffState.set(pairKey, st);
  reRenderPairTable(pairKey);
});

// === UI v4: Global txid search ===
globalTxidSearchEl.addEventListener("input", () => {
  const q = (globalTxidSearchEl.value || "").trim();
  setGlobalTxidSearch(q);
});
globalTxidClearEl.addEventListener("click", () => {
  globalTxidSearchEl.value = "";
  setGlobalTxidSearch("");
});

function setGlobalTxidSearch(q) {
  for (const [pairKey, st] of diffState.entries()) {
    st.search = q;
    st.page = 1;
    diffState.set(pairKey, st);
    reRenderPairTable(pairKey);
  }
}

// === UI v4: Details panel ===
detailsCloseBtn.addEventListener("click", () => hideDetailsPanel());
detailsCopyTxidBtn.addEventListener("click", async () => {
  const txid = detailsCopyTxidBtn.getAttribute("data-txid") || "";
  if (!txid) return;
  try {
    await navigator.clipboard.writeText(txid);
    toast(`Copied txid: ${txid}`);
  } catch {
    toast("Failed to copy txid");
  }
});

function showDetailsPanel({ pairKey, rowType, row, keepCols, amountScale }) {
  detailsPanelEl.hidden = false;
  detailsCopyTxidBtn.setAttribute("data-txid", String(row.txid || ""));

  const amt = (v) => (typeof v === "number" ? (v / amountScale).toFixed(8).replace(/0+$/, "").replace(/\.$/, "") : String(v));
  const h = (x) => escapeHtml(String(x ?? ""));

  const fields = [];
  fields.push(`<div class="muted">Pair: <b>${h(pairKey)}</b> · Type: <b>${h(rowType)}</b></div>`);
  fields.push(`<div class="kpiRow"><div class="kpi"><div class="kpiLabel">txid</div><div class="kpiVal">${h(row.txid)}</div></div></div>`);

  if (rowType === "mismatch") {
    fields.push(`<div class="grid2">`);
    fields.push(`<div><div class="muted">BASE</div><div><b>${amt(row.base_amount)}</b></div><div class="muted">${h(row.base_status || "")}</div></div>`);
    fields.push(`<div><div class="muted">OTHER</div><div><b>${amt(row.other_amount)}</b></div><div class="muted">${h(row.other_status || "")}</div></div>`);
    fields.push(`</div>`);
    fields.push(`<div class="muted">Δ amount: <b>${amt(row.delta_amount)}</b> · Status match: <b>${h(row.status_match)}</b></div>`);
  } else if (rowType === "missing_in_base") {
    fields.push(`<div class="muted">Missing in BASE. OTHER amount: <b>${amt(row.other_amount)}</b> · status: <b>${h(row.other_status || "")}</b></div>`);
  } else if (rowType === "missing_in_other") {
    fields.push(`<div class="muted">Missing in OTHER. BASE amount: <b>${amt(row.base_amount)}</b> · status: <b>${h(row.base_status || "")}</b></div>`);
  }

  if (keepCols && keepCols.length) {
    fields.push(`<hr/>`);
    fields.push(`<div class="muted">Kept columns</div>`);
    fields.push(`<div class="mono small">`);
    for (const c of keepCols) {
      const baseK = `base_${c}`;
      const otherK = `other_${c}`;
      const b = row[baseK];
      const o = row[otherK];
      fields.push(`<div><b>${h(c)}</b> · base: ${h(b)} · other: ${h(o)}</div>`);
    }
    fields.push(`</div>`);
  }

  detailsBodyEl.innerHTML = fields.join("\n");
}

function hideDetailsPanel() {
  detailsPanelEl.hidden = true;
  detailsCopyTxidBtn.removeAttribute("data-txid");
  detailsBodyEl.innerHTML = "";
}

// === Modal helpers ===
modalCloseEl.addEventListener("click", () => closeModal());
modalBackdropEl.addEventListener("click", (ev) => {
  if (ev.target === modalBackdropEl) closeModal();
});

function openModal({ title, bodyHtml, footHtml }) {
  modalTitleEl.textContent = title || "";
  modalBodyEl.innerHTML = bodyHtml || "";
  modalFootEl.innerHTML = footHtml || "";
  modalBackdropEl.hidden = false;
  modalEl.hidden = false;
}
function closeModal() {
  modalBackdropEl.hidden = true;
  modalEl.hidden = true;
  modalTitleEl.textContent = "";
  modalBodyEl.innerHTML = "";
  modalFootEl.innerHTML = "";
}

// === Toast / banner ===
function toast(msg, kind = "info") {
  const el = document.createElement("div");
  el.className = `banner ${kind}`;
  el.textContent = msg;
  bannerHost.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 250);
  }, 2000);
}

// === Utilities ===
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function revokeAllBlobs() {
  for (const u of state.blobUrls) {
    try { URL.revokeObjectURL(u); } catch {}
  }
  state.blobUrls = [];
}

function toCsvBlobUrl(text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  state.blobUrls.push(url);
  return url;
}

function parseFloatLoose(s) {
  if (s == null) return NaN;
  const t = String(s).trim();
  if (!t) return NaN;
  const norm = t.replaceAll(" ", "").replace(",", ".");
  const v = Number(norm);
  return Number.isFinite(v) ? v : NaN;
}

function parseMoneyScaled(s, amountScale, decimalComma = false) {
  if (s == null) return null;
  let t = String(s).trim();
  if (!t) return null;

  // Remove currency symbols and spaces; keep digits, comma, dot, minus
  t = t.replace(/[^\d.,-]/g, "");
  if (!t) return null;

  // decimalComma: 1.234,56 -> 1234.56
  if (decimalComma) {
    // remove thousand dots
    t = t.replace(/\./g, "");
    // decimal comma -> dot
    t = t.replace(/,/g, ".");
  } else {
    // remove thousand commas
    // keep last dot as decimal if present; drop commas
    t = t.replace(/,/g, "");
  }

  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * amountScale);
}

function formatMoneyScaled(v, amountScale) {
  if (typeof v !== "number") return "";
  const x = v / amountScale;
  // Show up to 8 decimals but trim
  return x.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

// === Core CSV / UI logic ===
function renderFiles() {
  filesEl.innerHTML = "";

  if (state.files.length === 0) {
    filesEl.innerHTML = `<div class="muted">Upload at least 2 CSV files to compare.</div>`;
    return;
  }

  for (const f of state.files) {
    const wrap = document.createElement("div");
    wrap.className = "fileCard";
    wrap.setAttribute("data-file-id", f.id);

    const primaryBadge = (state.primaryId === f.id)
      ? `<span class="pill primary">PRIMARY</span>`
      : `<button class="ghost small" data-action="makePrimary">Make primary</button>`;

    const headerHint = (f.header && f.header.length)
      ? `<div class="muted small">Header: ${escapeHtml(f.header.join(" | "))}</div>`
      : `<div class="muted small">Header not loaded yet.</div>`;

    wrap.innerHTML = `
      <div class="fileTop">
        <div class="fileTitle">
          <input class="fileName" value="${escapeHtml(f.name)}" data-action="rename" />
          ${primaryBadge}
        </div>
        <div class="fileActions">
          <button class="ghost" data-action="refreshHeader">${f._refreshing ? "Loading…" : "Load header"}</button>
          <button class="ghost danger" data-action="remove">Remove</button>
        </div>
      </div>

      <div class="fileGrid">
        <div class="field">
          <label>CSV file</label>
          <input type="file" accept=".csv,text/csv" data-action="filePick" />
          <div class="muted small">${escapeHtml(f.file ? f.file.name : "No file chosen")}</div>
        </div>

        <div class="field">
          <label>Delimiter</label>
          <input class="mono" value="${escapeHtml(f.delimiter)}" data-action="delimiter" />
          <div class="muted small">Usually “,” or “;”</div>
        </div>

        <div class="field">
          <label>Encoding</label>
          <select data-action="encoding">
            ${["utf-8","windows-1251","latin1"].map((e) => `<option value="${e}" ${f.encoding===e?"selected":""}>${e}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label>Decimal comma</label>
          <select data-action="decimalComma">
            <option value="false" ${!f.decimalComma?"selected":""}>No (1,234.56)</option>
            <option value="true" ${f.decimalComma?"selected":""}>Yes (1.234,56)</option>
          </select>
        </div>

        <div class="field">
          <label>txid column</label>
          <select data-action="idCol"></select>
        </div>

        <div class="field">
          <label>amount column</label>
          <select data-action="amountCol"></select>
        </div>

        <div class="field">
          <label>status column (optional)</label>
          <select data-action="statusCol"></select>
          <div class="muted small">Set to “(none)” if not applicable</div>
        </div>

        <div class="field colSpan2">
          <label>Keep columns (optional)</label>
          <input class="mono" value="${escapeHtml(f.keepColsText || "")}" placeholder="colA, colB, colC" data-action="keepCols" />
          <div class="muted small">Extra columns copied into reports for manual review</div>
        </div>
      </div>

      ${headerHint}
    `;

    // Populate selects based on header
    const idSel = wrap.querySelector('select[data-action="idCol"]');
    const amtSel = wrap.querySelector('select[data-action="amountCol"]');
    const stSel  = wrap.querySelector('select[data-action="statusCol"]');

    const header = (f.header && f.header.length) ? f.header : [];
    const mkOpt = (i, label) => `<option value="${i}">${escapeHtml(label)}</option>`;

    const opts = [];
    opts.push(mkOpt(-1, "(select)"));
    header.forEach((h, i) => opts.push(mkOpt(i, `${i+1}. ${h}`)));

    idSel.innerHTML = opts.join("");
    amtSel.innerHTML = opts.join("");

    const stOpts = [];
    stOpts.push(mkOpt(-1, "(none)"));
    header.forEach((h, i) => stOpts.push(mkOpt(i, `${i+1}. ${h}`)));
    stSel.innerHTML = stOpts.join("");

    if (typeof f.idCol === "number") idSel.value = String(f.idCol);
    if (typeof f.amountCol === "number") amtSel.value = String(f.amountCol);
    if (typeof f.statusCol === "number") stSel.value = String(f.statusCol);

    filesEl.appendChild(wrap);
  }
}

function addFile(initial = {}) {
  const f = {
    id: uid(),
    name: initial.name || `file${state.files.length + 1}`,
    file: initial.file || null,
    delimiter: initial.delimiter ?? ",",
    encoding: initial.encoding || "utf-8",
    decimalComma: Boolean(initial.decimalComma),
    header: initial.header || [],
    idCol: initial.idCol ?? -1,
    amountCol: initial.amountCol ?? -1,
    statusCol: initial.statusCol ?? -1,
    keepColsText: initial.keepColsText || "",
    _refreshing: false,
  };
  state.files.push(f);
  if (!state.primaryId) state.primaryId = f.id;
  renderFiles();
}

  // UX improvement: "Add file" button opens a native file picker immediately,
  // then creates a file card pre-filled with the selected CSV.
  function addFileWithPicker() {
    // Must be triggered by a user gesture (button click), otherwise browsers may block it.
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);

    input.addEventListener("change", async () => {
      try {
        const file = (input.files && input.files[0]) ? input.files[0] : null;
        if (!file) return;

        // Create a new file card already bound to the selected file.
        addFile({ file, name: (file.name || "").replace(/\.[^.]+$/, "") });

        // The newly added file is the last in the list.
        const last = state.files[state.files.length - 1];
        if (last && !state.primaryId) state.primaryId = last.id;

        // Try to auto-refresh header to make the next step smoother.
        if (last) {
          await refreshHeaderForFile(last.id);
          renderFiles();
        }
      } finally {
        document.body.removeChild(input);
      }
    }, { once: true });

    input.click();
  }


  function removeFile(fileId) {
    const idx = state.files.findIndex((x) => x.id === fileId);
    if (idx >= 0) state.files.splice(idx, 1);
    if (state.primaryId === fileId) state.primaryId = state.files[0]?.id || null;
    renderFiles();
  }

  function makePrimary(fileId) {
    state.primaryId = fileId;
    renderFiles();
  }

  function getFileById(fileId) {
    return state.files.find((x) => x.id === fileId) || null;
  }

  async function refreshHeaderForFile(fileId) {
    const f = getFileById(fileId);
    if (!f) return;
    if (!f.file) {
      toast("Pick a CSV file first", "warn");
      return;
    }
    if (f._refreshing) return;
    f._refreshing = true;
    renderFiles();

    try {
      const text = await readFileAsText(f.file, f.encoding);
      const { data } = Papa.parse(text, { delimiter: f.delimiter, preview: 2, skipEmptyLines: true });
      const firstRow = data && data.length ? data[0] : [];
      f.header = firstRow.map((x, i) => (x == null || String(x).trim() === "") ? `col${i+1}` : String(x));
      // If we likely parsed header row, keep as header. Users can still point to actual columns in the selects.

      // Try to auto-suggest columns if unset
      autoSuggestColumns(f);

    } catch (e) {
      f.header = [];
      toast(`Failed to parse header for ${f.name}: ${String(e)}`, "warn");
    } finally {
      f._refreshing = false;
      renderFiles();
    }
  }

  function autoSuggestColumns(f) {
    if (!f.header || !f.header.length) return;
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const hdr = f.header.map(norm);

    const pick = (cands) => {
      for (const c of cands) {
        const i = hdr.indexOf(c);
        if (i >= 0) return i;
      }
      return -1;
    };

    if (f.idCol === -1) {
      const i = pick(["txid","transactionid","trxid","id","paymentid","orderid"]);
      if (i >= 0) f.idCol = i;
    }
    if (f.amountCol === -1) {
      const i = pick(["amount","value","sum","total","trxamount","transactionamount"]);
      if (i >= 0) f.amountCol = i;
    }
    if (f.statusCol === -1) {
      const i = pick(["status","state","paymentstatus","trxstatus","transactionstatus"]);
      if (i >= 0) f.statusCol = i;
    }
  }

  function readFileAsText(file, encoding) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result || ""));
      // Some browsers ignore encoding for UTF-8; fine.
      try { reader.readAsText(file, encoding || "utf-8"); } catch { reader.readAsText(file); }
    });
  }

  function validateReady() {
    if (state.files.length < 2) return { ok: false, msg: "Upload at least 2 files." };
    if (!state.primaryId) return { ok: false, msg: "Pick a primary file." };
    for (const f of state.files) {
      if (!f.file) return { ok: false, msg: `Choose CSV for ${f.name}` };
      if (f.idCol < 0) return { ok: false, msg: `Select txid column for ${f.name}` };
      if (f.amountCol < 0) return { ok: false, msg: `Select amount column for ${f.name}` };
      // statusCol optional
    }
    return { ok: true, msg: "" };
  }

  function setRunning(on, msg = "") {
    state.running = on;
    progressEl.hidden = !on;
    if (on) {
      progressBarEl.style.width = "10%";
      progressEl.querySelector(".muted").textContent = msg || "Working…";
    } else {
      progressBarEl.style.width = "0%";
      progressEl.querySelector(".muted").textContent = "";
    }
  }

  function showPerf(diag) {
    if (!perfBarEl) return;
    if (!diag) { perfBarEl.hidden = true; return; }
    perfBarEl.hidden = false;
    const ms = diag.total_ms || 0;
    const rows = diag.total_rows || 0;
    perfBarEl.textContent = `Perf: ${ms} ms · ${rows} rows`;
  }

  // ===== Reconcile engine (worker) =====
  let worker = null;

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker("worker.js");
    return worker;
  }

  function runWorker(payload) {
    return new Promise((resolve, reject) => {
      const w = ensureWorker();
      const id = uid();
      const onMsg = (ev) => {
        const m = ev.data;
        if (!m || m.id !== id) return;
        w.removeEventListener("message", onMsg);
        w.removeEventListener("error", onErr);
        if (m.type === "result") resolve(m);
        else if (m.type === "error") reject(new Error(m.error || "Worker error"));
      };
      const onErr = (e) => {
        w.removeEventListener("message", onMsg);
        w.removeEventListener("error", onErr);
        reject(e);
      };
      w.addEventListener("message", onMsg);
      w.addEventListener("error", onErr);
      w.postMessage({ id, ...payload });
    });
  }

  function pairKey(primaryName, otherName) {
    return `${primaryName} → ${otherName}`;
  }

  function reRenderPairTable(pk) {
    const block = resultsEl.querySelector(`[data-pair-key="${CSS.escape(pk)}"]`);
    if (!block) return;

    const reportData = diffReports.get(pk);
    const st = diffState.get(pk);
    if (!reportData || !st) return;

    const { reports, keepCols, amountScale } = reportData;
    const html = renderPairInner({ pairKey: pk, reports, keepCols, amountScale, st });
    const inner = block.querySelector(".pairInner");
    if (inner) inner.innerHTML = html;

    // Persist UI snapshot
    saveUiState(snapshotUiState());
  }

  function renderPairInner({ pairKey, reports, keepCols, amountScale, st }) {
    const k = reports.kpis;
    const kpiHtml = `
      <div class="kpiRow">
        ${renderKpi("OK", k.ok, "ok")}
        ${renderKpi("Mismatches", k.mismatches, "mismatch")}
        ${renderKpi("Missing in BASE", k.missing_in_base, "missing_in_base")}
        ${renderKpi("Missing in OTHER", k.missing_in_other, "missing_in_other")}
      </div>
    `;

    const filtersHtml = `
      <div class="pairFilters">
        <input class="mono" placeholder="Search txid…" value="${escapeHtml(st.search || "")}" data-pair-search="1"/>
        <select data-pair-mismatch-type="1">
          ${[
            ["all","All mismatches"],
            ["amount","Amount mismatches"],
            ["status","Status mismatches"],
            ["both","Amount + Status mismatches"],
          ].map(([v,l]) => `<option value="${v}" ${st.mismatchType===v?"selected":""}>${l}</option>`).join("")}
        </select>
        <select data-pair-status-filter="1">
          ${[
            ["all","All statuses"],
            ["SUCCESS","SUCCESS"],
            ["PENDING","PENDING"],
            ["FAILED","FAILED"],
            ["CANCELLED","CANCELLED"],
            ["UNKNOWN","UNKNOWN"],
          ].map(([v,l]) => `<option value="${v}" ${st.statusFilter===v?"selected":""}>${l}</option>`).join("")}
        </select>
        <select data-pair-page-size="1">
          ${[25,50,100,250].map((n) => `<option value="${n}" ${st.pageSize===n?"selected":""}>${n}/page</option>`).join("")}
        </select>
        <div class="pairPager">
          <button class="ghost small" data-pair-page="prev">Prev</button>
          <span class="muted small">Page ${st.page}</span>
          <button class="ghost small" data-pair-page="next">Next</button>
        </div>
      </div>
    `;

    const tableHtml = renderPairTable({ pairKey, reports, keepCols, amountScale, st });

    return `
      ${kpiHtml}
      ${filtersHtml}
      ${tableHtml}
    `;
  }

  function renderKpi(label, val, filterKey) {
    return `
      <button class="kpi" data-kpi-filter="${filterKey}">
        <div class="kpiLabel">${escapeHtml(label)}</div>
        <div class="kpiVal">${escapeHtml(String(val))}</div>
      </button>
    `;
  }

  function renderPairTable({ pairKey, reports, keepCols, amountScale, st }) {
    const rows = getFilteredRows({ reports, st });
    const total = rows.length;
    const pageSize = st.pageSize || 50;
    const page = clamp(st.page || 1, 1, Math.max(1, Math.ceil(total / pageSize)));
    st.page = page;

    const start = (page - 1) * pageSize;
    const slice = rows.slice(start, start + pageSize);

    const cols = ["txid", "base_amount", "other_amount", "delta_amount", "base_status", "other_status", "status_match"];
    const extra = (keepCols || []).map((c) => `base_${c}`).concat((keepCols || []).map((c) => `other_${c}`));
    const allCols = cols.concat(extra);

    const th = allCols.map((c) => `<th>${escapeHtml(c)}</th>`).join("");

    const td = (v) => `<td>${escapeHtml(v)}</td>`;
    const fmtAmt = (v) => (typeof v === "number" ? formatMoneyScaled(v, amountScale) : String(v));

    const body = slice.map((r) => {
      const rowType = r._rowType;
      const txid = String(r.txid ?? "");
      const cells = [];
      for (const c of allCols) {
        const v = r[c];
        if (c.endsWith("_amount") || c === "delta_amount") cells.push(td(fmtAmt(v)));
        else cells.push(td(v ?? ""));
      }
      return `<tr data-row-type="${escapeHtml(rowType)}" data-txid="${escapeHtml(txid)}">${cells.join("")}</tr>`;
    }).join("");

    const meta = `<div class="muted small">Showing ${start + 1}-${Math.min(start + pageSize, total)} of ${total}</div>`;

    return `
      ${meta}
      <div class="tableWrap">
        <table>
          <thead><tr>${th}</tr></thead>
          <tbody>${body || `<tr><td colspan="${allCols.length}" class="muted">No rows</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }

  function getFilteredRows({ reports, st }) {
    const filter = st.filter || "mismatch";
    const search = (st.search || "").trim().toLowerCase();
    const mismatchType = st.mismatchType || "all";
    const statusFilter = st.statusFilter || "all";

    let baseRows = [];
    if (filter === "ok") baseRows = reports.ok.rows || [];
    else if (filter === "mismatch") baseRows = reports.mismatches.rows || [];
    else if (filter === "missing_in_base") baseRows = reports.missing_in_base.rows || [];
    else if (filter === "missing_in_other") baseRows = reports.missing_in_other.rows || [];
    else baseRows = reports.mismatches.rows || [];

    const out = [];
    for (const r of baseRows) {
      const txid = String(r.txid ?? "");
      if (search && !txid.toLowerCase().includes(search)) continue;

      if (filter === "mismatch") {
        const amtMismatch = Boolean(r.amount_mismatch);
        const stMismatch = Boolean(r.status_mismatch);

        if (mismatchType === "amount" && !amtMismatch) continue;
        if (mismatchType === "status" && !stMismatch) continue;
        if (mismatchType === "both" && !(amtMismatch && stMismatch)) continue;
      }

      if (statusFilter !== "all") {
        const bs = String(r.base_status_norm ?? r.base_status ?? "").toUpperCase();
        const os = String(r.other_status_norm ?? r.other_status ?? "").toUpperCase();
        // If any side matches the filter, keep the row
        if (bs !== statusFilter && os !== statusFilter) continue;
      }

      out.push(r);
    }
    return out;
  }

  function renderResults(pairs) {
    resultsEl.innerHTML = "";

    if (!pairs || pairs.length === 0) {
      resultsEl.innerHTML = `<div class="muted">No comparisons yet.</div>`;
      return;
    }

    const uiSnap = loadUiState();

    for (const p of pairs) {
      const pk = p.pairKey;
      diffReports.set(pk, { reports: p.reports, keepCols: p.keepCols, amountScale: p.amountScale });

      if (!diffState.has(pk)) {
        diffState.set(pk, {
          filter: "mismatch",
          page: 1,
          pageSize: 50,
          search: "",
          mismatchType: "all",
          statusFilter: "all",
          amtMin: null,
          amtMax: null
        });
      }

      // restore persisted state if any
      restoreUiState(uiSnap);

      const block = document.createElement("div");
      block.className = "pairBlock";
      block.setAttribute("data-pair-key", pk);

      block.innerHTML = `
        <div class="pairHeader">
          <div class="pairTitle">${escapeHtml(pk)}</div>
          <div class="pairMeta muted small">${escapeHtml(APP_VERSION)}</div>
        </div>
        <div class="pairInner">${renderPairInner({
          pairKey: pk,
          reports: p.reports,
          keepCols: p.keepCols,
          amountScale: p.amountScale,
          st: diffState.get(pk)
        })}</div>
      `;

      resultsEl.appendChild(block);
    }

    // persist after render
    saveUiState(snapshotUiState());
  }

  async function run() {
    const v = validateReady();
    if (!v.ok) {
      toast(v.msg, "warn");
      return;
    }

    revokeAllBlobs();
    diffReports.clear();
    diffState.clear();
    resultsEl.innerHTML = "";
    state.lastDiagnostics = null;
    showPerf(null);

    setRunning(true, "Parsing CSV…");

    const primary = getFileById(state.primaryId);
    const others = state.files.filter((x) => x.id !== state.primaryId);

    const amountScale = 100000000; // internal integer scaling
    const tolerance = parseFloatLoose($("#tolerance").value || "0");
    const tolScaled = Math.round((Number.isFinite(tolerance) ? tolerance : 0) * amountScale);

    const keepCols = ($("#keepColsGlobal").value || "").split(",").map((s) => s.trim()).filter(Boolean);

    const payload = {
      type: "run",
      primary: await serializeFile(primary, amountScale),
      others: await Promise.all(others.map((o) => serializeFile(o, amountScale))),
      amountScale,
      toleranceScaled: tolScaled,
      keepCols,
    };

    const t0 = performance.now();

    try {
      progressBarEl.style.width = "30%";
      const res = await runWorker(payload);
      progressBarEl.style.width = "90%";

      const diag = res.diagnostics || null;
      state.lastDiagnostics = diag;
      showPerf(diag);

      const pairs = (res.pairs || []).map((x) => ({
        pairKey: pairKey(primary.name, x.otherName),
        reports: x.reports,
        keepCols,
        amountScale,
      }));

      renderResults(pairs);

      progressBarEl.style.width = "100%";
      setTimeout(() => setRunning(false), 250);

      toast(`Done in ${(performance.now()-t0).toFixed(0)} ms`, "ok");

    } catch (e) {
      setRunning(false);
      toast(`Run failed: ${String(e)}`, "warn");
      console.error(e);
    }
  }

  async function serializeFile(f, amountScale) {
    const text = await readFileAsText(f.file, f.encoding);
    return {
      name: f.name,
      csvText: text,
      delimiter: f.delimiter,
      decimalComma: Boolean(f.decimalComma),
      header: f.header || [],
      idCol: f.idCol,
      amountCol: f.amountCol,
      statusCol: f.statusCol,
      keepColsText: f.keepColsText || "",
    };
  }

  // Views / Columns management (UI v4)
  viewsBtn.addEventListener("click", () => openViewsModal());
  colsBtn.addEventListener("click", () => openColsModal());

  function openViewsModal() {
    const views = loadViews();

    const rows = views.map((v, idx) => `
      <div class="viewRow">
        <div><b>${escapeHtml(v.name)}</b><div class="muted small">${escapeHtml(v.note || "")}</div></div>
        <div class="viewRowBtns">
          <button class="ghost small" data-view-action="apply" data-idx="${idx}">Apply</button>
          <button class="ghost small danger" data-view-action="delete" data-idx="${idx}">Delete</button>
        </div>
      </div>
    `).join("") || `<div class="muted">No saved views.</div>`;

    openModal({
      title: "Saved views",
      bodyHtml: `
        <div class="stack">
          ${rows}
          <hr/>
          <div class="stack">
            <input id="newViewName" placeholder="View name" />
            <input id="newViewNote" placeholder="Note (optional)" />
            <button id="saveViewBtn" class="primary">Save current filters</button>
          </div>
        </div>
      `,
      footHtml: `<button class="ghost" id="closeViews">Close</button>`
    });

    $("#closeViews").addEventListener("click", () => closeModal());
    $("#saveViewBtn").addEventListener("click", () => {
      const name = ($("#newViewName").value || "").trim();
      const note = ($("#newViewNote").value || "").trim();
      if (!name) { toast("Enter view name", "warn"); return; }
      const snapshot = snapshotUiState();
      const list = loadViews();
      list.push({ name, note, snapshot, createdAt: new Date().toISOString() });
      saveViews(list);
      closeModal();
      toast("View saved", "ok");
    });

    modalBodyEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-view-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-view-action");
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      const list = loadViews();
      const v = list[idx];
      if (!v) return;

      if (action === "apply") {
        restoreUiState(v.snapshot);
        for (const pk of diffReports.keys()) reRenderPairTable(pk);
        closeModal();
        toast(`Applied view: ${v.name}`, "ok");
      } else if (action === "delete") {
        list.splice(idx, 1);
        saveViews(list);
        closeModal();
        toast("View deleted", "ok");
      }
    }, { once: true });
  }

  function openColsModal() {
    const prefs = loadColPrefs();
    const keys = [
      "txid","base_amount","other_amount","delta_amount",
      "base_status","other_status","status_match"
    ];

    openModal({
      title: "Column preferences",
      bodyHtml: `
        <div class="stack">
          <div class="muted">Select which columns to show (affects rendering).</div>
          <div class="gridCols">
            ${keys.map((k) => `
              <label class="chk">
                <input type="checkbox" data-col-pref="${k}" ${prefs[k]===false?"":"checked"}/>
                <span>${escapeHtml(k)}</span>
              </label>
            `).join("")}
          </div>
          <div class="muted small">Kept columns always show if present.</div>
        </div>
      `,
      footHtml: `
        <button class="ghost" id="colsCancel">Cancel</button>
        <button class="primary" id="colsSave">Save</button>
      `
    });

    $("#colsCancel").addEventListener("click", () => closeModal());
    $("#colsSave").addEventListener("click", () => {
      const obj = loadColPrefs();
      modalBodyEl.querySelectorAll("input[data-col-pref]").forEach((c) => {
        const k = c.getAttribute("data-col-pref");
        obj[k] = Boolean(c.checked);
      });
      saveColPrefs(obj);
      closeModal();
      // Re-render all pair tables
      for (const pk of diffReports.keys()) reRenderPairTable(pk);
      toast("Saved", "ok");
    });
  }

  // Events
  $("#addFileBtn").addEventListener("click", () => addFileWithPicker());
  $("#runBtn").addEventListener("click", () => run());

  filesEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;
    const root = btn.closest("[data-file-id]");
    if (!root) return;
    const fileId = root.getAttribute("data-file-id");
    const action = btn.getAttribute("data-action");

    if (action === "remove") removeFile(fileId);
    else if (action === "makePrimary") makePrimary(fileId);
    else if (action === "refreshHeader") refreshHeaderForFile(fileId);
  });

  filesEl.addEventListener("change", (ev) => {
    const root = ev.target.closest("[data-file-id]");
    if (!root) return;
    const fileId = root.getAttribute("data-file-id");
    const f = getFileById(fileId);
    if (!f) return;

    const el = ev.target;

    if (el.matches('input[type="file"][data-action="filePick"]')) {
      f.file = el.files && el.files[0] ? el.files[0] : null;
      f.header = [];
      f.idCol = -1;
      f.amountCol = -1;
      f.statusCol = -1;
      renderFiles();
      return;
    }

    if (el.matches('select[data-action="encoding"]')) {
      f.encoding = el.value;
      return;
    }
    if (el.matches('select[data-action="decimalComma"]')) {
      f.decimalComma = el.value === "true";
      return;
    }
    if (el.matches('select[data-action="idCol"]')) {
      f.idCol = parseInt(el.value, 10);
      return;
    }
    if (el.matches('select[data-action="amountCol"]')) {
      f.amountCol = parseInt(el.value, 10);
      return;
    }
    if (el.matches('select[data-action="statusCol"]')) {
      f.statusCol = parseInt(el.value, 10);
      return;
    }
  });

  filesEl.addEventListener("input", (ev) => {
    const root = ev.target.closest("[data-file-id]");
    if (!root) return;
    const fileId = root.getAttribute("data-file-id");
    const f = getFileById(fileId);
    if (!f) return;

    const el = ev.target;
    if (el.matches('input[data-action="rename"]')) {
      f.name = el.value;
      return;
    }
    if (el.matches('input[data-action="delimiter"]')) {
      f.delimiter = el.value;
      return;
    }
    if (el.matches('input[data-action="keepCols"]')) {
      f.keepColsText = el.value;
      return;
    }
  });

  // Init with 2 empty file slots
  addFile({ name: "base" });
  addFile({ name: "other" });
})();
