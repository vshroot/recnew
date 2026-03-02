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
      : (rowType === "dup_base") ? reports.duplicates_base.rows
      : (rowType === "dup_other") ? reports.duplicates_other.rows
      : null;

    if (!src) return;
    const raw = src.find((r) => String(r.txid) === String(txid));
    if (!raw) return;
    const diffRow = buildDiffRowFrom(raw, rowType, keepCols, amountScale);
    openDetails(pairKey, rowType, txid, diffRow);
    return;
  }

  
      const exportViewBtn = ev.target.closest("[data-export-view]");
      if (exportViewBtn) {
        const pairKey = exportViewBtn.getAttribute("data-export-view");
        const st = diffState.get(pairKey);
        if (!st || !st.lastPageRows || !st.lastHeaders) {
          showBanner("warn", "Nothing to export", "Render a table first, then export the current view.");
          return;
        }
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `view-${pairKey}-${ts}.csv`;
        const csv = toCsv(st.lastPageRows, st.lastHeaders);
        downloadCsv(filename, csv);
        return;
      }


const exportKindBtn = ev.target.closest("[data-export-kind]");
if (exportKindBtn) {
  const spec = exportKindBtn.getAttribute("data-export-kind");
  const [pairKey, kind] = spec.split(":");
  const st = diffState.get(pairKey);
  const reportData = diffReports.get(pairKey);
  if (!st || !reportData) return;
  // Render ensures st.lastPageRows is available; for full-kind export we rebuild from current filter quickly with same caps.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${kind}-${pairKey}-${ts}.csv`;
  // Build rows from currently active filter across sources, but cap to 200k for safety in UI export.
  const built = collectRowsForExport(pairKey, kind, st, reportData, 200000);
  const csv = toCsv(built.rows, built.headers);
  downloadCsv(filename, csv);
  return;
}

const pairSearchClear = ev.target.closest("[data-pair-search-clear]");
  if (pairSearchClear) {
    const pairKey = pairSearchClear.getAttribute("data-pair-search-clear");
    const input = resultsEl.querySelector(`[data-pair-search="${CSS.escape(pairKey)}"]`);
    if (input) input.value = "";
    const st = diffState.get(pairKey);
    if (st) { st.search = null; st.page = 1; diffState.set(pairKey, st); reRenderPairTable(pairKey); }
    return;
  }
});

resultsEl.addEventListener("keydown", (ev) => {
  const tr = ev.target.closest("tr[data-txid][data-row-type]");
  if (tr && (ev.key === "Enter" || ev.key === " ")) {
    tr.click();
    ev.preventDefault();
  }
});

resultsEl.addEventListener("change", (ev) => {
const minInp = ev.target.closest("[data-amt-min]");
if (minInp) {
  const pairKey = minInp.getAttribute("data-amt-min");
  const st = diffState.get(pairKey);
  if (!st) return;
  st.amtMin = (minInp.value || "").trim();
  st.page = 1;
  diffState.set(pairKey, st);
  saveUiState(snapshotUiState());
  reRenderPairTable(pairKey);
  return;
}
const maxInp = ev.target.closest("[data-amt-max]");
if (maxInp) {
  const pairKey = maxInp.getAttribute("data-amt-max");
  const st = diffState.get(pairKey);
  if (!st) return;
  st.amtMax = (maxInp.value || "").trim();
  st.page = 1;
  diffState.set(pairKey, st);
  saveUiState(snapshotUiState());
  reRenderPairTable(pairKey);
  return;
}

  const mmSel = ev.target.closest("[data-mismatch-type]");
  if (mmSel) {
    const pairKey = mmSel.getAttribute("data-mismatch-type");
    const st = diffState.get(pairKey);
    if (!st) return;
    st.mismatchType = mmSel.value || "";
    st.page = 1;
    diffState.set(pairKey, st);
    reRenderPairTable(pairKey);
    return;
  }
  const stSel = ev.target.closest("[data-status-filter]");
  if (stSel) {
    const pairKey = stSel.getAttribute("data-status-filter");
    const st = diffState.get(pairKey);
    if (!st) return;
    st.statusFilter = stSel.value || "";
    st.page = 1;
    diffState.set(pairKey, st);
    reRenderPairTable(pairKey);
    return;
  }
});

resultsEl.addEventListener("input", (ev) => {
  const inp = ev.target.closest("[data-pair-search]");
  if (!inp) return;
  const pairKey = inp.getAttribute("data-pair-search");
  const q = (inp.value || "").trim();
  const st = diffState.get(pairKey);
  if (!st) return;
  // Debounced-ish: only search for >= 2 chars; store query and re-render. Heavy scan is done once per query in reRenderPairTable.
  st.search = q.length >= 2 ? q : null;
  st.page = 1;
  diffState.set(pairKey, st);
  reRenderPairTable(pairKey);
      const rd = diffReports.get(pairKey);
      updateTxidSuggestions(pairKey, st, rd);
});

if (globalTxidSearchEl) {
  globalTxidSearchEl.addEventListener("input", () => {
    const q = (globalTxidSearchEl.value || "").trim();
    // Apply to the first pair currently shown (simple UX); per-pair search exists inside each pair.
    const firstPair = resultsEl.querySelector("[data-pair-key]");
    if (!firstPair) return;
    const pairKey = firstPair.getAttribute("data-pair-key");
    const st = diffState.get(pairKey);
    if (!st) return;
    st.search = q.length >= 2 ? q : null;
    st.page = 1;
    diffState.set(pairKey, st);
    reRenderPairTable(pairKey);
        const rd = diffReports.get(pairKey);
        updateTxidSuggestions(pairKey, st, rd);
  });
}
if (viewsBtn) viewsBtn.addEventListener("click", openViewsModal);
if (colsBtn) colsBtn.addEventListener("click", openColsModal);

if (globalTxidClearEl) {
  globalTxidClearEl.addEventListener("click", () => {
    if (globalTxidSearchEl) globalTxidSearchEl.value = "";
    const firstPair = resultsEl.querySelector("[data-pair-key]");
    if (!firstPair) return;
    const pairKey = firstPair.getAttribute("data-pair-key");
    const st = diffState.get(pairKey);
    if (st) { st.search = null; st.page = 1; diffState.set(pairKey, st); reRenderPairTable(pairKey); }
  });
}

const encodings = ["utf-8", "windows-1251", "iso-8859-1"];

  function uid() {
    return crypto.randomUUID();
  }

  // === UI v5: modal helpers ===
function openModal(title, bodyHtml, footHtml = "") {
  if (!modalEl || !modalBackdropEl) return;
  if (!bodyHtml || !String(bodyHtml).trim()) return;
  modalTitleEl.textContent = title;
  modalBodyEl.innerHTML = bodyHtml;
  modalFootEl.innerHTML = footHtml;
  modalBackdropEl.hidden = false;
  modalEl.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeModal() {
  if (!modalEl || !modalBackdropEl) return;
  modalEl.hidden = true;
  modalBackdropEl.hidden = true;
  modalBodyEl.innerHTML = "";
  modalFootEl.innerHTML = "";
  document.body.style.overflow = "";
}
if (modalBackdropEl) modalBackdropEl.addEventListener("click", closeModal);
if (modalCloseEl) modalCloseEl.addEventListener("click", closeModal);
closeModal();

function openColsModal() {
  const firstPair = resultsEl.querySelector("[data-pair-key]");
  if (!firstPair) { showBanner("info", "No results yet", "Run reconciliation first to configure columns."); return; }
  if (!firstPair) {
    showBanner("warn", "No data", "Run reconciliation first to configure columns.");
    return;
  }
  const pairKey = firstPair.getAttribute("data-pair-key");
  const reportData = diffReports.get(pairKey);
  if (!reportData) return;
  let keepCols = reportData.keepCols || [];
    const _colPrefsAll = loadColPrefs();
    const _p = _colPrefsAll[pairKey];
    if (_p) {
      const order = (_p.order || []).filter((c)=>keepCols.includes(c)).concat(keepCols.filter((c)=>!(_p.order||[]).includes(c)));
      const hidden = new Set(_p.hidden || []);
      keepCols = order.filter((c)=>!hidden.has(c));
    }
  const prefsAll = loadColPrefs();
  const prefs = prefsAll[pairKey] || { order: keepCols.slice(), hidden: [] };
  // Ensure order includes all cols
  const order = prefs.order.filter((c) => keepCols.includes(c)).concat(keepCols.filter((c) => !prefs.order.includes(c)));
  const hidden = new Set((prefs.hidden || []).filter((c) => keepCols.includes(c)));

  const rows = order.map((c) => `
    <div class="cols-item" draggable="true" data-col="${escapeHtml(c)}">
      <div class="left">
        <input type="checkbox" ${hidden.has(c) ? "" : "checked"} data-col-toggle="${escapeHtml(c)}" />
        <span class="name">${escapeHtml(c)}</span>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" type="button" data-col-up="${escapeHtml(c)}">Up</button>
        <button class="btn btn-ghost btn-sm" type="button" data-col-down="${escapeHtml(c)}">Down</button>
      </div>
    </div>`).join("");

  const body = `
    <div class="muted" style="margin-bottom:.5rem">Configure keep-columns for pair <span class="mono">${escapeHtml(pairKey)}</span>. Hidden columns won’t render in the table (exports remain unchanged).</div>
    <div class="cols-list" id="colsList">${rows}</div>
  `;
  openModal("Columns", body, `
    <button class="btn btn-ghost btn-sm" type="button" id="colsReset">Reset</button>
    <button class="btn btn-primary btn-sm" type="button" id="colsApply">Apply</button>
  `);

  const apply = (orderNow, hiddenNow) => {
    prefsAll[pairKey] = { order: orderNow, hidden: Array.from(hiddenNow) };
    saveColPrefs(prefsAll);
    // Re-render to apply
    reRenderPairTable(pairKey);
  };

  $("#colsReset").addEventListener("click", () => {
    apply(keepCols.slice(), new Set());
    closeModal();
  });

  $("#colsApply").addEventListener("click", () => {
    const listEl = $("#colsList");
    const orderNow = Array.from(listEl.querySelectorAll("[data-col]")).map((el) => el.getAttribute("data-col"));
    const hiddenNow = new Set();
    for (const el of listEl.querySelectorAll("[data-col-toggle]")) {
      const col = el.getAttribute("data-col-toggle");
      if (!el.checked) hiddenNow.add(col);
    }
    apply(orderNow, hiddenNow);
    closeModal();
  });

  modalBodyEl.addEventListener("click", (ev) => {
    const up = ev.target.closest("[data-col-up]");
    const down = ev.target.closest("[data-col-down]");
    if (up || down) {
      const col = (up || down).getAttribute(up ? "data-col-up" : "data-col-down");
      const listEl = $("#colsList");
      const els = Array.from(listEl.querySelectorAll("[data-col]"));
      const i = els.findIndex((e) => e.getAttribute("data-col") === col);
      if (i === -1) return;
      const j = up ? Math.max(0, i-1) : Math.min(els.length-1, i+1);
      if (i === j) return;
      if (up) listEl.insertBefore(els[i], els[j]);
      else listEl.insertBefore(els[j], els[i]);
    }
  });
}

function openViewsModal() {
  if (!state.pairs || !state.pairs.length) { showBanner("info", "No results yet", "Run reconciliation first to use Saved Views."); return; }
  const views = loadViews();
  const current = snapshotUiState();
  const items = views.length ? views.map((v, i) => `
    <div class="cols-item">
      <div class="left"><span class="name">${escapeHtml(v.name)}</span><span class="chip">${escapeHtml(v.created || "")}</span></div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" type="button" data-view-apply="${i}">Apply</button>
        <button class="btn btn-ghost btn-sm" type="button" data-view-del="${i}">Delete</button>
      </div>
    </div>`).join("") : `<div class="muted">No saved views yet.</div>`;

  const body = `
    <div style="display:grid;gap:.75rem">
      <div>
        <div class="muted" style="margin-bottom:.35rem">Save current UI filters/search as a named view.</div>
        <div class="search">
          <input id="viewName" class="input input-sm" placeholder="View name (e.g. 'Mismatches > 1000')" />
          <button id="viewSave" class="btn btn-primary btn-sm" type="button">Save</button>
        </div>
      </div>
      <div class="cols-list">${items}</div>
    </div>
  `;
  openModal("Saved views", body, `<button class="btn btn-ghost btn-sm" type="button" id="viewClose">Close</button>`);
  $("#viewClose").addEventListener("click", closeModal);

  $("#viewSave").addEventListener("click", () => {
    const name = ($("#viewName").value || "").trim();
    if (!name) return;
    const list = loadViews();
    list.unshift({ name, created: new Date().toISOString().slice(0,19).replace("T"," "), ui: current });
    saveViews(list.slice(0, 30));
    closeModal();
    openViewsModal();
  });

  modalBodyEl.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-view-apply]");
    const d = ev.target.closest("[data-view-del]");
    if (a) {
      const idx = parseInt(a.getAttribute("data-view-apply"), 10);
      const v = loadViews()[idx];
      if (v?.ui) {
        restoreUiState(v.ui);
        saveUiState(snapshotUiState());
        // Re-render all pairs
        for (const pair of state.pairs) reRenderPairTable(pair.key);
      }
      closeModal();
      return;
    }
    if (d) {
      const idx = parseInt(d.getAttribute("data-view-del"), 10);
      const list = loadViews();
      list.splice(idx,1);
      saveViews(list);
      closeModal();
      openViewsModal();
      return;
    }
  }, { once: true });
}

function clearBanners() {
  if (!bannerHost) return;
  bannerHost.innerHTML = "";
}

function showBanner(kind, title, text, actions = []) {
  if (!bannerHost) return;
  const cls = kind === "error" ? "banner banner--err" : (kind === "warn" ? "banner banner--warn" : "banner");
  const icon = kind === "error" ? "!" : (kind === "warn" ? "⚠" : "i");
  const actionsHtml = actions.length
    ? `<div class="banner__actions">${actions.map((a) => `<button class="btn btn-ghost btn-sm" type="button" data-banner-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`).join("")}</div>`
    : "";
  const html = `
    <div class="${cls}">
      <div class="banner__icon">${escapeHtml(icon)}</div>
      <div class="banner__body">
        <div class="banner__title">${escapeHtml(title)}</div>
        <div class="banner__text">${escapeHtml(text)}</div>
      </div>
      ${actionsHtml}
    </div>`;
  bannerHost.insertAdjacentHTML("beforeend", html);
  // Wire actions
  for (const a of actions) {
    const btn = bannerHost.querySelector(`[data-banner-action="${CSS.escape(a.id)}"]`);
    if (btn) btn.addEventListener("click", () => a.onClick && a.onClick());
  }
}

function setProgress(text, pct) {
    progressEl.textContent = text;
    const p = Math.max(0, Math.min(100, pct || 0));
    progressBarEl.style.width = `${p}%`;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
let lastDetailsTxid = null;
    let lastOpenedDiffRow = null;
    let compareA = null;
    let compareB = null;

function openDetails(pairKey, rowType, txid, diffRow) {
  if (!detailsPanelEl || !detailsBodyEl) return;
  lastDetailsTxid = txid;
      lastOpenedDiffRow = diffRow;
  const baseKeep = diffRow.base_keep || {};
  const otherKeep = diffRow.other_keep || {};
  const keepKeys = Object.keys(baseKeep).length ? Object.keys(baseKeep) : Object.keys(otherKeep);

  const keepSection = keepKeys.length ? `
    <div class="details-card">
      <h4>Keep columns</h4>
      <div class="details-kv">
        ${keepKeys.map((k) => `
          <div class="k">${escapeHtml(k)}</div>
          <div class="v">${escapeHtml(String(baseKeep[k] ?? ""))}  |  ${escapeHtml(String(otherKeep[k] ?? ""))}</div>
        `).join("")}
      </div>
    </div>` : "";

  const html = `
    <div class="details-grid">
      <div class="details-card">
        <h4>Core</h4>
        <div class="details-kv">
          <div class="k">txid</div><div class="v">${escapeHtml(txid)}</div>
          <div class="k">type</div><div class="v">${escapeHtml(String(rowType))}</div>
          <div class="k">mismatch</div><div class="v">${escapeHtml(String(diffRow.mismatch_type ?? ""))}</div>
          <div class="k">amount</div><div class="v">${escapeHtml(String(diffRow.base_amount ?? ""))}  |  ${escapeHtml(String(diffRow.other_amount ?? ""))}</div>
          <div class="k">status</div><div class="v">${escapeHtml(String(diffRow.base_status ?? ""))}  |  ${escapeHtml(String(diffRow.other_status ?? ""))}</div>
          <div class="k">diff</div><div class="v">${escapeHtml(String(diffRow.amount_diff ?? ""))}</div>
        </div>
      </div>
      ${keepSection}
    </div>
  `;
  detailsBodyEl.innerHTML = html;
  detailsPanelEl.hidden = false;
  detailsPanelEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderCompare() {
  const box = [];
  if (compareA) {
    box.push(`<div class="compare-row"><div class="compare-head"><div class="compare-title">Pinned A</div><button class="btn btn-ghost btn-sm" type="button" data-unpin="A">Unpin</button></div><div class="details-kv"><div class="k">txid</div><div class="v">${escapeHtml(compareA.txid)}</div><div class="k">amount</div><div class="v">${escapeHtml(String(compareA.base_amount))} | ${escapeHtml(String(compareA.other_amount))}</div><div class="k">status</div><div class="v">${escapeHtml(String(compareA.base_status))} | ${escapeHtml(String(compareA.other_status))}</div></div></div>`);
  }
  if (compareB) {
    box.push(`<div class="compare-row"><div class="compare-head"><div class="compare-title">Pinned B</div><button class="btn btn-ghost btn-sm" type="button" data-unpin="B">Unpin</button></div><div class="details-kv"><div class="k">txid</div><div class="v">${escapeHtml(compareB.txid)}</div><div class="k">amount</div><div class="v">${escapeHtml(String(compareB.base_amount))} | ${escapeHtml(String(compareB.other_amount))}</div><div class="k">status</div><div class="v">${escapeHtml(String(compareB.base_status))} | ${escapeHtml(String(compareB.other_status))}</div></div></div>`);
  }
  if (!box.length) return "";
  return `<div class="details-card"><h4>Compare</h4><div class="details-body">${box.join("")}</div></div>`;
}

function closeDetails() {
  if (!detailsPanelEl || !detailsBodyEl) return;
  detailsPanelEl.hidden = true;
  detailsBodyEl.innerHTML = "";
  lastDetailsTxid = null;
}

if (detailsCloseBtn) detailsCloseBtn.addEventListener("click", closeDetails);
if (detailsCopyTxidBtn) detailsCopyTxidBtn.addEventListener("click", async () => {
  if (!lastDetailsTxid) return;
  try {
    await navigator.clipboard.writeText(lastDetailsTxid);
    showBanner("info", "Copied", "txid copied to clipboard.");
    setTimeout(() => clearBanners(), 1200);
  } catch {
    showBanner("warn", "Copy failed", "Clipboard permission not available. Select and copy manually.");
  }
});


  function collectRowsForExport(pairKey, kind, st, reportData, cap) {
  const { reports, keepCols, amountScale } = reportData;
  // Determine sources based on kind
  let sources;
  if (kind === "mismatch") sources = [{ type: "mismatch", rows: reports.mismatches.rows }];
  else if (kind === "missing") sources = [
    { type: "missing_in_base", rows: reports.missing_in_base.rows },
    { type: "missing_in_other", rows: reports.missing_in_other.rows },
  ];
  else sources = getSourcesForFilter(st.filter, reports);

  const headers = ["txid","base_amount","other_amount","amount_diff","base_status","other_status","type", ...keepCols.flatMap((k)=>[`base__${k}`,`other__${k}`])];

  const mmType = (st.mismatchType || "").trim();
  const stFilter = (st.statusFilter || "").trim();
  const q = (st.search || "").trim().toLowerCase();
  const minStr = (st.amtMin || "").trim();
  const maxStr = (st.amtMax || "").trim();
  const minVal = minStr ? parseFloat(minStr) : null;
  const maxVal = maxStr ? parseFloat(maxStr) : null;

  const out = [];
  for (const s of sources) {
    for (const raw of s.rows) {
      if (out.length >= cap) break;
      if (q && !String(raw.txid||"").toLowerCase().includes(q)) continue;
      const built = buildDiffRowFrom(raw, s.type, keepCols, amountScale);

      if (mmType && built.mismatch_type !== mmType) continue;
      if (stFilter) {
        const [side, val] = stFilter.split(':');
        const v = (side === 'base') ? String(built.base_status || '') : String(built.other_status || '');
        if (v.trim() !== val) continue;
      }
      if (minVal != null || maxVal != null) {
        const a = Math.max(Math.abs(parseFloat(built.base_amount||"0")||0), Math.abs(parseFloat(built.other_amount||"0")||0));
        if (minVal != null && a < minVal) continue;
        if (maxVal != null && a > maxVal) continue;
      }

      // Flatten to plain object with headers keys
      const row = {};
      for (const h of headers) row[h] = built[h] ?? "";
      out.push(row);
    }
    if (out.length >= cap) break;
  }
  return { headers, rows: out };
}

function updateTxidSuggestions(pairKey, st, reportData) {
  const dl = document.getElementById("txidSuggestions");
  if (!dl || !reportData) return;
  const { reports } = reportData;
  const q = (st.search || "").trim().toLowerCase();
  if (q.length < 2) { dl.innerHTML = ""; return; }

  // Gather up to 30 suggestions from mismatches + missing, quick scan cap.
  const pools = [reports.mismatches.rows, reports.missing_in_base.rows, reports.missing_in_other.rows];
  const sug = [];
  const seen = new Set();
  let scanned = 0;
  const cap = 40000;
  for (const arr of pools) {
    for (const r of arr) {
      scanned++; if (scanned > cap) break;
      const t = String(r.txid || "");
      const tl = t.toLowerCase();
      if (!tl.includes(q)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      sug.push(t);
      if (sug.length >= 30) break;
    }
    if (scanned > cap || sug.length >= 30) break;
  }
  dl.innerHTML = sug.map((s) => `<option value="${escapeHtml(s)}"></option>`).join("");
}

function csvCell(v) {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  function makeCsv(headers, rows) {
    const out = [];
    out.push(headers.map(csvCell).join(","));
    for (const r of rows) {
      out.push(headers.map((h) => csvCell(r[h])).join(","));
    }
    return out.join("\n");
  }

  function downloadLink(label, filename, content, mime = "text/csv;charset=utf-8") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    state.blobUrls.push(url);
    return { label, filename, url };
  


  function downloadJsonLink(label, filename, obj) {
    return downloadLink(label, filename, JSON.stringify(obj, null, 2), "application/json;charset=utf-8");
  }

  function nowMs() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  function makeDiagnosticsBase() {
    return {
      schema_version: "4.0",
      run_id: uid(),
      started_at: new Date().toISOString(),
      finished_at: null,
      environment: {
        user_agent: navigator.userAgent,
        platform: navigator.platform || "",
        language: navigator.language || "",
        time_zone: (Intl && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : "",
        papa_version: (window.Papa && (Papa.VERSION || Papa.parse?.VERSION)) || "",
      },
      settings: null,
      files: [],
      timings_ms: {},
      warnings: [],
      checks: { ok: true, issues: [] },
    };
  }

  function pushIssue(diag, level, message, extra) {
    diag.checks.ok = false;
    diag.checks.issues.push({ level, message, ...(extra ? { extra } : {}) });
  }

  function runSelfChecks(diag, pairsFull) {
    for (const p of (pairsFull || [])) {
      const c = p.counts || {};
      const reports = p.reports || {};
      const checks = [
        ["mismatches", "mismatches"],
        ["missing_in_base", "missing_in_base"],
        ["missing_in_other", "missing_in_other"],
        ["duplicates_base_rows", "duplicates_base"],
        ["duplicates_other_rows", "duplicates_other"],
      ];
      for (const [countKey, reportKey] of checks) {
        const total = Number(c[countKey] ?? 0);
        const shown = Array.isArray(reports[reportKey]) ? reports[reportKey].length : 0;
        if (!Number.isFinite(total) || total < 0) {
          pushIssue(diag, "error", `Invalid count for ${p.key}: ${countKey}=${c[countKey]}`);
        }
        if (shown > total) {
          pushIssue(diag, "error", `Report rows exceed total for ${p.key}: ${reportKey} shown=${shown} total=${total}`);
        }
      }
    }
  }
}

  function normalizeStatus(raw, statusMap) {
    const s = (raw || "").trim();
    if (!s) return null;
    const lower = s.toLowerCase();
    return (statusMap && statusMap.get(lower)) || lower;
  }

  function pow10BigInt(n) {
    let x = 1n;
    for (let i = 0; i < n; i++) x *= 10n;
    return x;
  }

  // Converts a BigInt-as-string from scaled integer units to a human-readable decimal.
  // e.g. formatScaled("20", 2) → "0.20"  |  formatScaled("-1050", 2) → "-10.50"
  function formatScaled(scaledStr, amountScale) {
    if (scaledStr == null || scaledStr === "") return "";
    const scale = Number(amountScale);
    if (!Number.isInteger(scale) || scale <= 0) return BigInt(scaledStr).toString();
    const factor = pow10BigInt(scale);
    let val = BigInt(scaledStr);
    const neg = val < 0n;
    if (neg) val = -val;
    const intPart  = (val / factor).toString();
    const fracPart = (val % factor).toString().padStart(scale, "0");
    return (neg ? "-" : "") + intPart + "." + fracPart;
  }

  function parseAmountScaled(raw, scale, decimalComma) {
    let s = (raw || "").trim();
    if (!s) return null;

    let neg = false;
    if (s.startsWith("(") && s.endsWith(")")) {
      neg = true;
      s = s.slice(1, -1).trim();
    }

    s = s.replaceAll("\u00a0", "").replaceAll(" ", "");

    if (decimalComma) {
      // Comma is decimal separator; dots are thousands separators.
      // Only strip dots when a comma is also present (unambiguous case).
      // If no comma is present, the dot might itself be the decimal separator.
      if (s.includes(",")) {
        s = s.replaceAll(".", "").replaceAll(",", ".");
      }
    } else {
      if (s.includes(",") && s.includes(".")) {
        s = s.replaceAll(",", "");
      } else if (s.includes(",") && !s.includes(".")) {
        s = s.replaceAll(",", ".");
      }
    }

    // Keep only digits, dot, sign.
    s = s.replace(/[^\d.+-]/g, "");
    if (!s || s === "-" || s === "+" || s === "." || s === "-." || s === "+.") return null;

    let sign = 1n;
    if (s.startsWith("-")) {
      sign = -1n;
      s = s.slice(1);
    } else if (s.startsWith("+")) {
      s = s.slice(1);
    }
    if (!s) return null;

    const parts = s.split(".");
    if (parts.length > 2) return null;
    let intPart = parts[0] || "0";
    let fracPart = parts[1] || "";

    intPart = intPart.replace(/^0+(?=\d)/, "");
    if (!/^\d+$/.test(intPart)) return null;
    if (fracPart && !/^\d+$/.test(fracPart)) return null;

    const scaleN = Number(scale);
    if (!Number.isInteger(scaleN) || scaleN < 0 || scaleN > 18) return null;

    const factor = pow10BigInt(scaleN);
    let scaledAbs = BigInt(intPart) * factor;

    if (scaleN === 0) {
      if (fracPart && fracPart[0] >= "5") scaledAbs += 1n;
    } else {
      if (fracPart.length <= scaleN) {
        const fracPadded = (fracPart + "0".repeat(scaleN)).slice(0, scaleN);
        if (fracPadded) scaledAbs += BigInt(fracPadded);
      } else {
        const main = fracPart.slice(0, scaleN);
        const nextDigit = fracPart[scaleN] || "0";
        if (main) scaledAbs += BigInt(main);
        if (nextDigit >= "5") scaledAbs += 1n;
      }
    }

    if (neg) sign = -sign;
    return sign * scaledAbs;
  }

  function guessColumn(header, candidates) {
    const norm = header.map((h) => String(h || "").trim().toLowerCase());
    for (const c of candidates) {
      const idx = norm.indexOf(c);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function fileCardHtml(f, idx) {
    const header = f.header || [];
    const options = header
      .map((h, i) => `<option value="${i}">${escapeHtml(h)} (index ${i})</option>`)
      .join("");

    const encOpts = encodings
      .map((e) => `<option value="${escapeHtml(e)}"${f.encoding === e ? " selected" : ""}>${escapeHtml(e)}</option>`)
      .join("");

    const isPrimary = state.primaryId === f.id;

    return `
      <div class="file-card" data-file-id="${escapeHtml(f.id)}">
        <div class="row row-between row-wrap gap">
          <h3>File ${idx + 1}</h3>
          <div class="row gap">
            <label class="row gap muted" style="user-select:none;">
              <input type="radio" name="primary" value="${escapeHtml(f.id)}" ${isPrimary ? "checked" : ""} />
              primary
            </label>
            <button class="btn btn-danger" type="button" data-action="remove-file">Remove</button>
          </div>
        </div>

        <div class="grid grid-3">
          <label class="field">
            <div class="label">Name (for reports)</div>
            <input data-field="name" value="${escapeHtml(f.name)}" placeholder="e.g. bank" />
          </label>

          <label class="field">
            <div class="label">CSV file</div>
            <input data-field="file" type="file" accept=".csv,text/csv" />
            <div class="hint">${f.file ? escapeHtml(f.file.name) : "No file selected"}</div>
          </label>

          <label class="field">
            <div class="label">Delimiter</div>
            <input data-field="delimiter" value="${escapeHtml(f.delimiter)}" placeholder="e.g. , or ;" maxlength="1" />
          </label>
        </div>

        <div class="grid grid-3 mt-10">
          <label class="field">
            <div class="label">Encoding (optional)</div>
            <select data-field="encoding">
              ${encOpts}
            </select>
            <div class="hint">CSV will be decoded using this encoding before parsing.</div>
          </label>

          <label class="field">
            <div class="label">Decimal comma</div>
            <select data-field="decimalComma">
              <option value="0"${!f.decimalComma ? " selected" : ""}>No (typically 12.34)</option>
              <option value="1"${f.decimalComma ? " selected" : ""}>Yes (typically 12,34)</option>
            </select>
          </label>

          <label class="field">
            <div class="label">Keep columns (keep_cols, comma-separated)</div>
            <input data-field="keepCols" value="${escapeHtml(f.keepColsText)}" placeholder="e.g. created_at, merchant" />
          </label>
        </div>

        <div class="grid grid-3 mt-10">
          <label class="field">
            <div class="label">transaction_id</div>
            <select data-field="idCol">
              <option value="-1">(select column)</option>
              ${options}
            </select>
          </label>
          <label class="field">
            <div class="label">amount</div>
            <select data-field="amountCol">
              <option value="-1">(select column)</option>
              ${options}
            </select>
          </label>
          <label class="field">
            <div class="label">status</div>
            <select data-field="statusCol">
              <option value="-1">(select column)</option>
              ${options}
            </select>
          </label>
        </div>

        <div class="hint">
          ${header.length ? `Header loaded: <code>${escapeHtml(header.join(" | "))}</code>` : "Select a file to read the header."}
        </div>
      </div>
    `;
  }

  function renderFiles() {
    filesEl.innerHTML = state.files.map((f, i) => fileCardHtml(f, i)).join("");

    // Set selected values for selects after innerHTML (to avoid escaping issues).
    for (const f of state.files) {
      const root = filesEl.querySelector(`[data-file-id="${CSS.escape(f.id)}"]`);
      if (!root) continue;
      const setSel = (field, val) => {
        const el = root.querySelector(`[data-field="${field}"]`);
        if (el && typeof val === "number") el.value = String(val);
      };
      setSel("idCol", f.idCol);
      setSel("amountCol", f.amountCol);
      setSel("statusCol", f.statusCol);
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
// UX: Add file button opens the file picker immediately and creates a card with the selected file.
function addFileWithPicker() {
  // Use a persistent (pre-existing) input to satisfy Safari/WebView user-gesture requirements.
  let input = document.querySelector("#filePicker");

  // Fallback: create one if index.html wasn't updated for some reason.
  if (!input) {
    input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.id = "filePicker";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.opacity = "0";
    document.body.appendChild(input);
  }

  // Allow picking the same file twice in a row.
  input.value = "";

  const onChange = async () => {
    try {
      const file = (input.files && input.files[0]) ? input.files[0] : null;
      if (!file) return;

      // Create a new file card already bound to this file.
      addFile({ file, name: (file.name || "").replace(/\.[^.]+$/, "") });

      // Refresh header so column selectors are populated right away.
      const last = state.files[state.files.length - 1];
      if (last) {
        await refreshHeaderForFile(last.id);
        renderFiles();
      }
    } finally {
      input.removeEventListener("change", onChange);
    }
  };

  input.addEventListener("change", onChange);
  // Must be called from a user gesture to avoid browser popup blockers.
  input.click();
}


  function removeFile(fileId) {
    state.files = state.files.filter((x) => x.id !== fileId);
    if (state.primaryId === fileId) state.primaryId = state.files[0]?.id || null;
    renderFiles();
  }

  function getGlobalSettings() {
    const amountScale = Number($("#amountScale").value);
    const amountTolerance = Number($("#amountTolerance").value);
    const reportLimit = Number($("#reportLimit").value);

    // Parse "Paid = success" lines into a Map { "paid" => "success" }
    const statusMap = new Map();
    for (const line of ($("#statusMappings").value || "").split("\n")) {
      const eqIdx = line.indexOf("=");
      if (eqIdx < 0) continue;
      const from = line.slice(0, eqIdx).trim().toLowerCase();
      const to   = line.slice(eqIdx + 1).trim().toLowerCase();
      if (from && to) statusMap.set(from, to);
    }

    return {
      amountScale,
      amountTolerance,
      reportLimit: Number.isFinite(reportLimit) ? Math.max(0, reportLimit) : 0,
      statusMap,
    };
  }

  function validate() {
    const errs = [];
    if (state.files.length < 2) errs.push("You need at least 2 files.");
    if (!state.primaryId) errs.push("Select a primary file.");
    for (const f of state.files) {
      if (!f.name || !f.name.trim()) errs.push(`File name cannot be empty (${f.file?.name || f.id}).`);
      if (!f.file) errs.push(`File not selected: ${f.name || "(unnamed)"}`);
      if (!f.delimiter || String(f.delimiter).length !== 1) errs.push(`Invalid delimiter for ${f.name || "(unnamed)"}`);
      if (!f.header || !f.header.length) errs.push(`Could not read header for ${f.name || "(unnamed)"}`);
      if (f.idCol < 0 || f.amountCol < 0 || f.statusCol < 0) errs.push(`Select id/amount/status columns for ${f.name || "(unnamed)"}`);
    }
    const names = state.files.map((f) => f.name).filter(Boolean);
    if (new Set(names).size !== names.length) errs.push("File names (for reports) must be unique.");
    const gs = getGlobalSettings();
    if (!Number.isInteger(gs.amountScale) || gs.amountScale < 0 || gs.amountScale > 18) errs.push("amount_scale must be between 0 and 18");
    if (!Number.isInteger(gs.amountTolerance) || gs.amountTolerance < 0) errs.push("amount_tolerance must be >= 0");
    return errs;
  }

  async function decodeFileToText(file, encoding) {
    const buf = await file.arrayBuffer();
    const dec = new TextDecoder(encoding || "utf-8", { fatal: false });
    return dec.decode(buf);
  }

  async function parseCsvToMaps(fileSpec, globalSettings, progressBasePct, progressSpanPct) {
    const { amountScale } = globalSettings;

    const keepCols = fileSpec.keepColsText
      ? fileSpec.keepColsText.split(",").map((x) => x.trim()).filter(Boolean)
      : [];

    // Map keep col name -> index (case-insensitive)
    const keepIdx = [];
    const headerNorm = fileSpec.header.map((h) => h.trim().toLowerCase());
    for (const kc of keepCols) {
      const idx = headerNorm.indexOf(kc.trim().toLowerCase());
      if (idx >= 0) keepIdx.push({ name: kc, idx });
    }

    const text = await decodeFileToText(fileSpec.file, fileSpec.encoding);
    const records = new Map(); // txid -> record (first occurrence)
    const counts = new Map(); // txid -> count
    const dupPushed = new Set(); // txid pushed previous first row into duplicates already
    const duplicates = []; // rows for export
    let rowsTotal = 0;
    let rowsBadId = 0;
    let rowsBadAmount = 0;

    const reportRowFor = (rec) => {
      const row = {
        txid: rec.txid,
        amount_raw: rec.amountRaw ?? "",
        amount_scaled: rec.amountScaled == null ? "" : rec.amountScaled.toString(),
        status_raw: rec.statusRaw ?? "",
        status_norm: rec.statusNorm ?? "",
        rownum: rec.rownum,
      };
      for (const k of keepCols) {
        row[`keep__${k}`] = rec.keep?.[k] ?? "";
      }
      return row;
    };

    setProgress(`Reading ${fileSpec.name}…`, progressBasePct);

    let rownum = 0; // 1-based; first parsed row is header
    await new Promise((resolve, reject) => {
      Papa.parse(text, {
        delimiter: fileSpec.delimiter,
        skipEmptyLines: true,
        header: false,
        worker: false,
        chunkSize: 512 * 1024, // 512 KB — yields to the event loop between chunks
        chunk: (results, parser) => {
          parser.pause();
          for (const row of (results.data || [])) {
            rownum += 1;
            if (rownum === 1) continue; // header

            rowsTotal += 1;

            const txid = String(row[fileSpec.idCol] ?? "").trim();
            if (!txid) {
              rowsBadId += 1;
              continue;
            }

            const c = (counts.get(txid) || 0) + 1;
            counts.set(txid, c);

            const amountRaw = String(row[fileSpec.amountCol] ?? "");
            const amountScaled = parseAmountScaled(amountRaw, amountScale, fileSpec.decimalComma);
            if (amountRaw && amountScaled == null) rowsBadAmount += 1;
            const statusRaw = String(row[fileSpec.statusCol] ?? "");
            const statusNorm = normalizeStatus(statusRaw, globalSettings.statusMap);

            const keep = {};
            for (const { name, idx } of keepIdx) keep[name] = String(row[idx] ?? "");

            if (c === 1) {
              records.set(txid, { txid, amountRaw, amountScaled, statusRaw, statusNorm, rownum, keep });
            } else {
              const first = records.get(txid);
              if (first && !dupPushed.has(txid)) {
                duplicates.push(reportRowFor(first));
                dupPushed.add(txid);
              }
              duplicates.push(reportRowFor({ txid, amountRaw, amountScaled, statusRaw, statusNorm, rownum, keep }));
            }

            if (rowsTotal % 5000 === 0) {
              const pct = progressBasePct + Math.min(progressSpanPct, (rowsTotal / 500000) * progressSpanPct);
              setProgress(`Reading ${fileSpec.name}… rows: ${rowsTotal.toLocaleString("en-US")}`, pct);
            }
          }
          // Yield to the event loop (allows repaint + prevents "Page Unresponsive") then continue.
          setTimeout(() => parser.resume(), 0);
        },
        complete: () => resolve(),
        error: (err) => reject(err),
      });
    });

    setProgress(`Done: ${fileSpec.name}. Rows: ${rowsTotal.toLocaleString("en-US")}`, progressBasePct + progressSpanPct);

    return {
      name: fileSpec.name,
      header: fileSpec.header,
      keepCols,
      records,
      counts,
      duplicates,
      rowsTotal,
      rowsBadId,
      rowsBadAmount,
    };
  }

  function statusTotals(mapPack) {
    const totals = new Map(); // status_norm -> {count, sumScaled BigInt}
    for (const [txid, rec] of mapPack.records.entries()) {
      if ((mapPack.counts.get(txid) || 0) !== 1) continue;
      const key = rec.statusNorm || "";
      const cur = totals.get(key) || { tx_count: 0, amount_scaled_sum: 0n };
      cur.tx_count += 1;
      if (rec.amountScaled != null) cur.amount_scaled_sum += rec.amountScaled;
      totals.set(key, cur);
    }
    const rows = [];
    const keys = Array.from(totals.keys()).sort((a, b) => a.localeCompare(b));
    for (const k of keys) {
      const v = totals.get(k);
      rows.push({
        status_norm: k,
        tx_count: v.tx_count,
        amount_scaled_sum: v.amount_scaled_sum.toString(),
      });
    }
    return { headers: ["status_norm", "tx_count", "amount_scaled_sum"], rows };
  }

  function clampRows(rows, limit) {
    if (!limit || limit <= 0) return { rows, truncated: false };
    if (rows.length <= limit) return { rows, truncated: false };
    return { rows: rows.slice(0, limit), truncated: true };
  }

  function reconcilePair(basePack, otherPack, globalSettings) {
    const tol = BigInt(globalSettings.amountTolerance || 0);
    const reportLimit = globalSettings.reportLimit || 0;

    const baseUnique = new Set();
    for (const [txid, c] of basePack.counts.entries()) if (c === 1) baseUnique.add(txid);
    const otherUnique = new Set();
    for (const [txid, c] of otherPack.counts.entries()) if (c === 1) otherUnique.add(txid);

    const missingInBase = [];
    for (const txid of otherUnique) {
      if (!baseUnique.has(txid)) {
        const rec = otherPack.records.get(txid);
        if (rec) missingInBase.push(rec);
      }
    }

    const missingInOther = [];
    for (const txid of baseUnique) {
      if (!otherUnique.has(txid)) {
        const rec = basePack.records.get(txid);
        if (rec) missingInOther.push(rec);
      }
    }

    const keepCols = Array.from(new Set([...(basePack.keepCols || []), ...(otherPack.keepCols || [])]));

    const mismatches = [];
    for (const txid of baseUnique) {
      if (!otherUnique.has(txid)) continue;
      const b = basePack.records.get(txid);
      const o = otherPack.records.get(txid);
      if (!b || !o) continue;

      // Only flag a parse error when the raw string was non-empty but couldn't be parsed.
      // If both amounts are empty, treat as equal (no parse error) and let status decide.
      const amountParseError = (b.amountRaw && b.amountScaled == null) || (o.amountRaw && o.amountScaled == null);
      // One side has a parsed amount, the other doesn't (e.g. empty raw string).
      // Must be checked before arithmetic to avoid BigInt × null TypeError.
      const amountOneNull = !amountParseError && (b.amountScaled == null) !== (o.amountScaled == null);
      const amountMismatch = !amountParseError && !amountOneNull
        && b.amountScaled != null && o.amountScaled != null
        && ((b.amountScaled > o.amountScaled ? b.amountScaled - o.amountScaled : o.amountScaled - b.amountScaled) > tol);
      const statusMismatch = (b.statusNorm || "") !== (o.statusNorm || "");
      if (!(amountParseError || amountOneNull || amountMismatch || statusMismatch)) continue;

      let mismatchType = "status_mismatch";
      if (amountParseError) mismatchType = "amount_parse_error";
      else if (amountOneNull) mismatchType = "amount_missing_one_side";
      else if (amountMismatch && statusMismatch) mismatchType = "amount_and_status_mismatch";
      else if (amountMismatch) mismatchType = "amount_mismatch";

      const row = {
        txid,
        mismatch_type: mismatchType,
        base_amount_raw: b.amountRaw ?? "",
        base_amount_scaled: b.amountScaled == null ? "" : b.amountScaled.toString(),
        other_amount_raw: o.amountRaw ?? "",
        other_amount_scaled: o.amountScaled == null ? "" : o.amountScaled.toString(),
        amount_diff_scaled: (o.amountScaled != null && b.amountScaled != null) ? (o.amountScaled - b.amountScaled).toString() : "",
        base_status_raw: b.statusRaw ?? "",
        base_status_norm: b.statusNorm ?? "",
        other_status_raw: o.statusRaw ?? "",
        other_status_norm: o.statusNorm ?? "",
        base_rownum: b.rownum,
        other_rownum: o.rownum,
      };
      for (const k of keepCols) {
        row[`base__${k}`] = b.keep?.[k] ?? "";
        row[`other__${k}`] = o.keep?.[k] ?? "";
      }
      mismatches.push(row);
    }

    const missingHeaders = (pack) => {
      const hs = ["txid", "amount_raw", "amount_scaled", "status_raw", "status_norm", "rownum"];
      for (const k of pack.keepCols || []) hs.push(`keep__${k}`);
      return hs;
    };

    const baseRow = (rec, pack) => {
      const r = {
        txid: rec.txid,
        amount_raw: rec.amountRaw ?? "",
        amount_scaled: rec.amountScaled == null ? "" : rec.amountScaled.toString(),
        status_raw: rec.statusRaw ?? "",
        status_norm: rec.statusNorm ?? "",
        rownum: rec.rownum,
      };
      for (const k of pack.keepCols || []) r[`keep__${k}`] = rec.keep?.[k] ?? "";
      return r;
    };

    const baseMissingRows = missingInOther.map((rec) => baseRow(rec, basePack));
    const otherMissingRows = missingInBase.map((rec) => baseRow(rec, otherPack));

    const mismatchHeaders = [
      "txid",
      "mismatch_type",
      "base_amount_raw",
      "base_amount_scaled",
      "other_amount_raw",
      "other_amount_scaled",
      "amount_diff_scaled",
      "base_status_raw",
      "base_status_norm",
      "other_status_raw",
      "other_status_norm",
      "base_rownum",
      "other_rownum",
      ...keepCols.flatMap((k) => [`base__${k}`, `other__${k}`]),
    ];

    const limited = {
      missing_in_base: clampRows(otherMissingRows, reportLimit),
      missing_in_other: clampRows(baseMissingRows, reportLimit),
      mismatches: clampRows(mismatches, reportLimit),
      duplicates_base: clampRows(basePack.duplicates, reportLimit),
      duplicates_other: clampRows(otherPack.duplicates, reportLimit),
    };

    return {
      counts: {
        missing_in_base: otherMissingRows.length,
        missing_in_other: baseMissingRows.length,
        mismatches: mismatches.length,
        duplicates_base_rows: basePack.duplicates.length,
        duplicates_other_rows: otherPack.duplicates.length,
      },
      reports: {
        missing_in_base: { headers: missingHeaders(otherPack), rows: limited.missing_in_base.rows, truncated: limited.missing_in_base.truncated },
        missing_in_other: { headers: missingHeaders(basePack), rows: limited.missing_in_other.rows, truncated: limited.missing_in_other.truncated },
        mismatches: { headers: mismatchHeaders, rows: limited.mismatches.rows, truncated: limited.mismatches.truncated },
        duplicates_base: { headers: missingHeaders(basePack), rows: limited.duplicates_base.rows, truncated: limited.duplicates_base.truncated },
        duplicates_other: { headers: missingHeaders(otherPack), rows: limited.duplicates_other.rows, truncated: limited.duplicates_other.truncated },
      },
      keepCols,
    };
  }

  // Returns the subset of report source arrays that match the given filter.
  function getSourcesForFilter(filter, reports) {
    const all = [
      { rows: reports.mismatches.rows,       type: "mismatch"         },
      { rows: reports.missing_in_base.rows,  type: "missing_in_base"  },
      { rows: reports.missing_in_other.rows, type: "missing_in_other" },
      { rows: reports.duplicates_base.rows,  type: "dup_base"         },
      { rows: reports.duplicates_other.rows, type: "dup_other"        },
    ];
    return filter === "all" ? all : all.filter((s) => s.type === filter);
  }

  // Converts a single raw report row into a display DiffRow object.
  // Only called for the rows on the current page — never materialises the full list.
  function buildDiffRowFrom(r, type, keepCols, amountScale) {
    switch (type) {
      case "mismatch":
        return {
          _rowType:      "mismatch",
          txid:          r.txid,
          base_amount:   r.base_amount_raw,
          other_amount:  r.other_amount_raw,
          amount_diff:   formatScaled(r.amount_diff_scaled, amountScale),
          base_status:   r.base_status_norm,
          other_status:  r.other_status_norm,
          mismatch_type: r.mismatch_type,
          base_keep:  keepCols.reduce((acc, k) => { acc[k] = r[`base__${k}`]  ?? ""; return acc; }, {}),
          other_keep: keepCols.reduce((acc, k) => { acc[k] = r[`other__${k}`] ?? ""; return acc; }, {}),
        };
      case "missing_in_base":
        return {
          _rowType:      "missing_in_base",
          txid:          r.txid,
          base_amount:   "—",
          other_amount:  r.amount_raw,
          amount_diff:   "—",
          base_status:   "—",
          other_status:  r.status_norm,
          mismatch_type: "missing_in_base",
          base_keep:  keepCols.reduce((acc, k) => { acc[k] = "—";                  return acc; }, {}),
          other_keep: keepCols.reduce((acc, k) => { acc[k] = r[`keep__${k}`] ?? ""; return acc; }, {}),
        };
      case "missing_in_other":
        return {
          _rowType:      "missing_in_other",
          txid:          r.txid,
          base_amount:   r.amount_raw,
          other_amount:  "—",
          amount_diff:   "—",
          base_status:   r.status_norm,
          other_status:  "—",
          mismatch_type: "missing_in_other",
          base_keep:  keepCols.reduce((acc, k) => { acc[k] = r[`keep__${k}`] ?? ""; return acc; }, {}),
          other_keep: keepCols.reduce((acc, k) => { acc[k] = "—";                  return acc; }, {}),
        };
      case "dup_base":
        return {
          _rowType:      "dup_base",
          txid:          r.txid,
          base_amount:   r.amount_raw,
          other_amount:  "—",
          amount_diff:   "—",
          base_status:   r.status_norm,
          other_status:  "—",
          mismatch_type: "dup_base",
          base_keep:  keepCols.reduce((acc, k) => { acc[k] = r[`keep__${k}`] ?? ""; return acc; }, {}),
          other_keep: keepCols.reduce((acc, k) => { acc[k] = "—";                  return acc; }, {}),
        };
      case "dup_other":
        return {
          _rowType:      "dup_other",
          txid:          r.txid,
          base_amount:   "—",
          other_amount:  r.amount_raw,
          amount_diff:   "—",
          base_status:   "—",
          other_status:  r.status_norm,
          mismatch_type: "dup_other",
          base_keep:  keepCols.reduce((acc, k) => { acc[k] = "—";                  return acc; }, {}),
          other_keep: keepCols.reduce((acc, k) => { acc[k] = r[`keep__${k}`] ?? ""; return acc; }, {}),
        };
      default:
        return null;
    }
  }

  const ROW_TYPE_CLASS = {
    mismatch:        "diff-row--mismatch",
    missing_in_base: "diff-row--missing",
    missing_in_other:"diff-row--missing",
    dup_base:        "diff-row--dup",
    dup_other:       "diff-row--dup",
  };

  function renderDiffRow(r, keepCols) {
    const cls   = ROW_TYPE_CLASS[r._rowType] || "";
    const cells = [
      r.txid, r.base_amount, r.other_amount, r.amount_diff,
      r.base_status, r.other_status, r.mismatch_type,
      ...keepCols.flatMap((k) => [r.base_keep[k] ?? "", r.other_keep[k] ?? ""]),
    ].map((v) => `<td>${escapeHtml(String(v ?? ""))}</td>`).join("");
    return `<tr class="${cls}" data-row-type="${escapeHtml(r._rowType)}" data-txid="${escapeHtml(r.txid)}" tabindex="0">${cells}</tr>`;
  }

  function reRenderPairTable(pairKey) {
    const pairBlock = resultsEl.querySelector(`[data-pair-key="${CSS.escape(pairKey)}"]`);
    if (!pairBlock) return;
    const reportData = diffReports.get(pairKey);
    if (!reportData) return;
    const st = diffState.get(pairKey);
    if (!st) return;

    const { filter, page, pageSize } = st;
    const { reports, keepCols, amountScale } = reportData;

    // 1. Virtual filter — count total without materialising all rows.
    let sources = getSourcesForFilter(filter, reports);
const mmType = (st.mismatchType || "").trim();
const stFilter = (st.statusFilter || "").trim();

    const searchQ = (st.search || "").trim().toLowerCase();
    if (searchQ) {
      // One-time scan for this render: filter by txid substring. This can be expensive on huge datasets, so we cap scanning when total rows is enormous.
      const maxScan = 500000; // safety cap
      let scanned = 0;
      const matched = [];
      for (const s of sources) {
        for (const r of s.rows) {
          scanned++;
          if (scanned > maxScan) break;
          if (String(r.txid || "").toLowerCase().includes(searchQ)) matched.push({ _rowType: s.type, r });
        }
        if (scanned > maxScan) break;
      }
      sources = [{ rows: matched, type: "search" }];
    }

    const total   = sources.reduce((sum, s) => sum + s.rows.length, 0);

    // 2. Paginate.
    const useAll     = pageSize === "all";
    const size       = useAll ? total : pageSize;
    const totalPages = size > 0 && total > 0 ? Math.ceil(total / size) : 1;
    const safePage   = Math.min(Math.max(1, page), totalPages);
    if (st.page !== safePage) st.page = safePage;

    const start = useAll ? 0 : (safePage - 1) * size;
    const end   = useAll ? total : Math.min(start + size, total);

    // 3. Build only the rows for this page by walking sources in order.
    const pageRows = [];
    let offset = 0;
    for (const { rows, type } of sources) {
      const srcStart = Math.max(0, start - offset);
      const srcEnd   = Math.min(rows.length, end - offset);
      if (srcStart < srcEnd) {
        for (let i = srcStart; i < srcEnd; i++) {
          pageRows.push(buildDiffRowFrom(rows[i], type, keepCols, amountScale));
        }
      }
      offset += rows.length;
      if (offset >= end) break;
    }

    // 4. Re-render tbody.
    const tbody = pairBlock.querySelector(".diff-table tbody");
    if (tbody) tbody.innerHTML = pageRows.map((r) => renderDiffRow(r, keepCols)).join("");

    // 5. Update pagination controls.
    const pagination = pairBlock.querySelector(".diff-pagination");
    if (!pagination) return;

    pagination.querySelectorAll("[data-page-size]").forEach((btn) => {
      const v = btn.getAttribute("data-page-size");
      btn.classList.toggle("diff-pgsz-btn--active", useAll ? v === "all" : v === String(pageSize));
    });

    const indicator = pagination.querySelector(".diff-page-indicator");
    if (indicator) {
      indicator.textContent = (useAll || totalPages <= 1)
        ? `${total} row${total !== 1 ? "s" : ""}`
        : `Page ${safePage} of ${totalPages}`;
    }

    const prevBtn = pagination.querySelector("[data-page-prev]");
    const nextBtn = pagination.querySelector("[data-page-next]");
    if (prevBtn) prevBtn.disabled = useAll || safePage <= 1;
    if (nextBtn) nextBtn.disabled = useAll || safePage >= totalPages;
  }

  function renderDiffTable(pair) {
    const { reports, keepCols = [], counts, key, amountScale } = pair;

    // Store reports for lazy on-demand rendering (no upfront row materialisation).
    diffReports.set(key, { reports, keepCols, amountScale });
    if (!diffState.has(key)) {
      diffState.set(key, { filter: "all", page: 1, pageSize: 50, search: null, mismatchType: "", statusFilter: "", amtMin: "", amtMax: "" });
    }

    const totalDisplayRows =
      reports.mismatches.rows.length + reports.missing_in_base.rows.length +
      reports.missing_in_other.rows.length + reports.duplicates_base.rows.length +
      reports.duplicates_other.rows.length;

    const anyTruncated = reports.mismatches.truncated || reports.missing_in_base.truncated ||
      reports.missing_in_other.truncated || reports.duplicates_base.truncated || reports.duplicates_other.truncated;

    const tabs = [
      { filter: "all",              label: `All (${totalDisplayRows})` },
      { filter: "mismatch",         label: `Mismatches (${counts.mismatches})` },
      { filter: "missing_in_base",  label: `Missing in base (${counts.missing_in_base})` },
      { filter: "missing_in_other", label: `Missing in other (${counts.missing_in_other})` },
      { filter: "dup_base",         label: `Dups base (${counts.duplicates_base_rows})` },
      { filter: "dup_other",        label: `Dups other (${counts.duplicates_other_rows})` },
    ];

    const kpiHtml = `
  <div class="kpi kpi--pair">
    <button class="item kpi-btn" type="button" data-kpi-filter="mismatch"><div class="value">${escapeHtml(String(counts.mismatches))}</div><div class="name">mismatches</div></button>
    <button class="item kpi-btn" type="button" data-kpi-filter="missing_in_base"><div class="value">${escapeHtml(String(counts.missing_in_base))}</div><div class="name">missing in base</div></button>
    <button class="item kpi-btn" type="button" data-kpi-filter="missing_in_other"><div class="value">${escapeHtml(String(counts.missing_in_other))}</div><div class="name">missing in other</div></button>
    <button class="item kpi-btn" type="button" data-kpi-filter="dup_base"><div class="value">${escapeHtml(String(counts.duplicates_base_rows))}</div><div class="name">dups base</div></button>
  </div>
`;

const toolbarHtml = `
  <div class="pair-toolbar">
    <div class="left">
      <span class="muted mono">Pair:</span>
      <span class="mono">${escapeHtml(pair.key)}</span>
      ${anyTruncated ? `<span class="chip">UI sample (row cap)</span>` : ``}
    </div>
    <div class="right">
      <div class="pair-filters">
        <input class="input input-sm mono" style="width:120px" inputmode="decimal" placeholder="min amt" data-amt-min="${escapeHtml(pair.key)}" title="Minimum amount (base/other)"/>
        <input class="input input-sm mono" style="width:120px" inputmode="decimal" placeholder="max amt" data-amt-max="${escapeHtml(pair.key)}" title="Maximum amount (base/other)"/>
        <select class="select" data-mismatch-type="${escapeHtml(pair.key)}" title="Mismatch type">
          <option value="">All mismatch types</option>
          <option value="AMOUNT">AMOUNT</option>
          <option value="STATUS">STATUS</option>
          <option value="BOTH">BOTH</option>
          <option value="AMOUNT_MISSING_ONE_SIDE">AMOUNT_MISSING_ONE_SIDE</option>
        </select>
        <select class="select" data-status-filter="${escapeHtml(pair.key)}" title="Status filter">
          <option value="">All statuses</option>
          <option value="base:OK">base: OK</option>
          <option value="other:OK">other: OK</option>
          <option value="base:FAIL">base: FAIL</option>
          <option value="other:FAIL">other: FAIL</option>
        </select>
        <div class="pair-search">
          <input class="input input-sm" type="search" placeholder="Search txid in this pair…" data-pair-search="${escapeHtml(pair.key)}" list="txidSuggestions" />
          <button class="btn btn-ghost btn-sm" type="button" data-pair-search-clear="${escapeHtml(pair.key)}">Clear</button>
        </div>
        <button class="btn btn-primary btn-sm" type="button" data-export-view="${escapeHtml(pair.key)}" title="Export the currently displayed rows">Export view</button>
        <button class="btn btn-ghost btn-sm" type="button" data-export-kind="${escapeHtml(pair.key)}:mismatch" title="Export mismatches (current filters)">mismatches</button>
        <button class="btn btn-ghost btn-sm" type="button" data-export-kind="${escapeHtml(pair.key)}:missing" title="Export missing (current filters)">missing</button>
      </div>
    </div>
  </div>
`;
const tabsHtml = `<div class="diff-tabs" role="tablist">
      ${tabs.map((t, i) => `<button class="diff-tab${i === 0 ? " diff-tab--active" : ""}" type="button" role="tab" aria-selected="${i === 0 ? "true" : "false"}" data-diff-filter="${escapeHtml(t.filter)}">${escapeHtml(t.label)}</button>`).join("")}
    </div>`;

    if (totalDisplayRows === 0) {
      return `${tabsHtml}<div class="hint">No discrepancies found.</div>`;
    }

    const extraHeaders = keepCols.flatMap((k) => [`base__${k}`, `other__${k}`]);
    const allHeaders   = ["txid", "base_amount", "other_amount", "amount_diff", "base_status", "other_status", "type", ...extraHeaders];
    const thead        = `<thead><tr>${allHeaders.map((h) => `${(() => { const cls = (h==="txid") ? "sticky-col" : (h==="base_amount") ? "sticky-col-2" : ""; return `<th class="${cls}">${escapeHtml(h)}</th>`; })()}`).join("")}</tr></thead>`;

    // tbody is intentionally empty — reRenderPairTable fills it after innerHTML is set.
    const paginationHtml = `
      <div class="diff-pagination">
        <div class="diff-page-sizes">
          <span class="muted" style="font-size:0.82rem">Rows:</span>
          <button class="diff-pgsz-btn diff-pgsz-btn--active" type="button" data-page-size="50">50</button>
          <button class="diff-pgsz-btn" type="button" data-page-size="100">100</button>
          <button class="diff-pgsz-btn" type="button" data-page-size="all">All</button>
        </div>
        <div class="diff-page-nav">
          <button class="diff-nav-btn" type="button" data-page-prev="1" aria-label="Previous" disabled>&#8592;</button>
          <span class="diff-page-indicator muted"></span>
          <button class="diff-nav-btn" type="button" data-page-next="1" aria-label="Next">&#8594;</button>
        </div>
      </div>`;

    const truncatedNote = anyTruncated
      ? `<div class="hint">Table shows up to the row limit. Download CSV reports for full data.</div>`
      : "";

    return `${kpiHtml}${toolbarHtml}${tabsHtml}${truncatedNote}${paginationHtml}<div class="diff-table-wrap"><table class="diff-table">${thead}<tbody></tbody></table></div>`;
  }

  function csvCell(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, headers) {
  const head = headers.join(",");
  const body = rows.map((r) => headers.map((h) => csvCell(r[h])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  state.blobUrls.push(url);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

function updatePerfBar() {
  if (!perfBarEl) return;
  const d = state.lastDiagnostics;
  if (!d || !d.timings) { perfBarEl.hidden = true; perfBarEl.innerHTML = ""; return; }
  const t = d.timings;
  const pills = [];
  const add = (label, ms) => {
    if (ms == null) return;
    pills.push(`<span class="pill"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(ms))} ms</span>`);
  };
  add("parse", t.parse_total_ms ?? t.parse_ms);
  add("sort", t.sort_ms);
  add("merge", t.merge_ms);
  add("export", t.export_ms);
  add("total", t.total_ms);
  const mode = d.engine?.selected ? `<span class="pill"><strong>mode:</strong> ${escapeHtml(d.engine.selected)}</span>` : "";
  perfBarEl.innerHTML = mode + pills.join("");
  perfBarEl.hidden = false;
}

function downloadDiagnostics() {
  const diag = state.lastDiagnostics;
  if (!diag) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `diagnostics-${ts}.json`;
  const blob = new Blob([JSON.stringify(diag, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  state.blobUrls.push(url);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

function renderResults(summary, downloads) {
    const blocks = [];
    blocks.push(`
      <div class="result-block">
        <div class="result-title">
          <strong>Summary</strong>
          <span class="muted mono">${escapeHtml(new Date().toLocaleString("en-US"))}</span>
        </div>
        <div class="kpi">
          <div class="item"><div class="value">${escapeHtml(summary.primary)}</div><div class="name">primary</div></div>
          <div class="item"><div class="value">${escapeHtml(String(summary.settings.amount_scale))}</div><div class="name">amount_scale</div></div>
          <div class="item"><div class="value">${escapeHtml(String(summary.settings.amount_tolerance_scaled))}</div><div class="name">tolerance (scaled)</div></div>
          <div class="item"><div class="value">${escapeHtml(String(summary.files_count))}</div><div class="name">files</div></div>
        </div>
        <div class="links">
          ${downloads.summary ? `<a class="link" href="${downloads.summary.url}" download="${escapeHtml(downloads.summary.filename)}">summary.json</a>` : ""}
          ${downloads.diagnostics ? `<a class="link" href="${downloads.diagnostics.url}" download="${escapeHtml(downloads.diagnostics.filename)}">diagnostics.json</a>` : ""}
          ${downloads.warnings ? `<a class="link" href="${downloads.warnings.url}" download="${escapeHtml(downloads.warnings.filename)}">warnings.txt</a>` : ""}
        </div>
      </div>
    `);

    for (const pair of summary.pairs) {
      blocks.push(`
        <div class="result-block" data-pair-key="${escapeHtml(pair.key)}">
          <div class="result-title">
            <strong>${escapeHtml(pair.base)} vs ${escapeHtml(pair.other)}</strong>
            <span class="muted mono">${escapeHtml(pair.key)}</span>
          </div>
          <div class="kpi">
            <div class="item"><div class="value">${escapeHtml(String(pair.counts.missing_in_base))}</div><div class="name">missing_in_base</div></div>
            <div class="item"><div class="value">${escapeHtml(String(pair.counts.missing_in_other))}</div><div class="name">missing_in_other</div></div>
            <div class="item"><div class="value">${escapeHtml(String(pair.counts.mismatches))}</div><div class="name">mismatches</div></div>
            <div class="item"><div class="value">${escapeHtml(String(pair.counts.duplicates_base_rows))}</div><div class="name">duplicates_base_rows</div></div>
            <div class="item"><div class="value">${escapeHtml(String(pair.counts.duplicates_other_rows))}</div><div class="name">duplicates_other_rows</div></div>
          </div>
          <div class="links">
            ${pair.links
              .map((l) => `<a class="link" href="${l.url}" download="${escapeHtml(l.filename)}">${escapeHtml(l.label)}</a>`)
              .join("")}
          </div>
          ${pair.notes.length ? `<div class="hint">${pair.notes.map(escapeHtml).join("<br/>")}</div>` : ""}
          ${renderDiffTable(pair)}
        </div>
      `);
    }

    blocks.push(`
      <div class="result-block">
        <div class="result-title">
          <strong>Status aggregates</strong>
          <span class="muted">for each file (unique txid only)</span>
        </div>
        <div class="links">
          ${downloads.statusTotals.map((l) => `<a class="link" href="${l.url}" download="${escapeHtml(l.filename)}">${escapeHtml(l.label)}</a>`).join("")}
        </div>
        <div class="hint">Transactions with a duplicate txid are excluded from these totals.</div>
      </div>
    `);

    resultsEl.innerHTML = `<div class="results">${blocks.join("")}</div>`;

    // Populate diff tables now that DOM elements exist.
    for (const pair of summary.pairs) {
      reRenderPairTable(pair.key);
    }
  }

  async function run() {
    if (state.running) return;
    const errs = validate();
    if (errs.length) {
      resultsEl.innerHTML = `<div class="mono" style="color: var(--danger)">${escapeHtml(errs.join("\n"))}</div>`;
      return;
    }
    if (!window.Papa) {
      resultsEl.innerHTML = `<div class="mono" style="color: var(--danger)">PapaParse failed to load (check your internet connection and CDN blockers).</div>`;
      return;
    }

    // Revoke previous blob URLs to prevent memory leak.
    for (const u of state.blobUrls) URL.revokeObjectURL(u);
    state.blobUrls = [];

    // Reset diff table state for the new run.
    diffReports.clear();
    diffState.clear();

    state.running = true;
    resultsEl.textContent = "Reconciling…";
    setProgress("Starting…", 0);


    const diag = makeDiagnosticsBase();
    const tRun0 = nowMs();

    try {
      const gs = getGlobalSettings();

      diag.settings = {
        amount_scale: gs.amountScale,
        amount_tolerance_scaled: gs.amountTolerance,
        report_limit: gs.reportLimit,
        status_mappings: Object.fromEntries(gs.statusMap),
      };

      const totalSize = state.files.reduce((acc, f) => acc + (f.file ? f.file.size : 0), 0);
      if (gs.reportLimit === 0 && totalSize > 50 * 1024 * 1024) {
        diag.warnings.push("report_limit=0 on large inputs may produce very large exports; UI will still show a capped sample.");
      }
      for (const f of state.files) {
        diag.files.push({
          name: f.name,
          filename: f.file?.name || "",
          size_bytes: f.file?.size || 0,
          delimiter: f.delimiter,
          encoding: f.encoding,
          decimal_comma: Boolean(f.decimalComma),
          columns: { id_index: f.idCol, amount_index: f.amountCol, status_index: f.statusCol },
          keep_cols: f.keepColsText ? f.keepColsText.split(",").map(x=>x.trim()).filter(Boolean) : [],
        });
      }

      const primary = state.files.find((f) => f.id === state.primaryId) || state.files[0];
      const others = state.files.filter((f) => f.id !== primary.id);

      // Heuristic: distribute progress across files.
      setProgress("Preparing…", 1);

      const tBase0 = nowMs();
      const basePack = await parseCsvToMaps(primary, gs, 2, 28);
      diag.timings_ms.parse_primary = Math.round(nowMs() - tBase0);
      const statusTotalsLinks = [];

      const baseTotals = statusTotals(basePack);
      statusTotalsLinks.push(
        downloadLink(
          `status_totals__${primary.name}.csv`,
          `status_totals__${primary.name}.csv`,
          makeCsv(baseTotals.headers, baseTotals.rows)
        )
      );

      const pairs = [];
      let pairIdx = 0;
      for (const other of others) {
        pairIdx += 1;
        const otherPack = await parseCsvToMaps(other, gs, 30 + (pairIdx - 1) * (50 / others.length), 22);

        const otherTotals = statusTotals(otherPack);
        statusTotalsLinks.push(
          downloadLink(
            `status_totals__${other.name}.csv`,
            `status_totals__${other.name}.csv`,
            makeCsv(otherTotals.headers, otherTotals.rows)
          )
        );

        setProgress(`Comparing ${primary.name} vs ${other.name}…`, 60 + (pairIdx - 1) * (30 / others.length));
        const pair = reconcilePair(basePack, otherPack, gs);

        const links = [];
        const notes = [];
        const mk = (label, filename, rep) => {
          const suffix = rep.truncated ? " (truncated)" : "";
          if (rep.truncated) notes.push(`${label}: report truncated to row limit (see "Row limit per report" setting)`);
          links.push(downloadLink(`${label}${suffix}`, filename, makeCsv(rep.headers, rep.rows)));
        };

        mk("mismatches.csv", `${primary.name}__vs__${other.name}__mismatches.csv`, pair.reports.mismatches);
        mk("missing_in_base.csv", `${primary.name}__vs__${other.name}__missing_in_base.csv`, pair.reports.missing_in_base);
        mk("missing_in_other.csv", `${primary.name}__vs__${other.name}__missing_in_other.csv`, pair.reports.missing_in_other);
        mk("duplicates_base.csv", `${primary.name}__vs__${other.name}__duplicates_base.csv`, pair.reports.duplicates_base);
        mk("duplicates_other.csv", `${primary.name}__vs__${other.name}__duplicates_other.csv`, pair.reports.duplicates_other);

        pairs.push({
          key: `${primary.name}__vs__${other.name}`,
          base: primary.name,
          other: other.name,
          counts: pair.counts,
          links,
          notes,
          reports: pair.reports,
          keepCols: pair.keepCols,
          amountScale: gs.amountScale,
        });
      }

      const summary = {
        created_at: new Date().toISOString(),
        primary: primary.name,
        files_count: state.files.length,
        settings: {
          amount_scale: gs.amountScale,
          amount_tolerance_scaled: gs.amountTolerance,
          report_limit: gs.reportLimit,
          status_mappings: Object.fromEntries(gs.statusMap),
        },
        files: state.files.map((f) => ({
          name: f.name,
          filename: f.file?.name || "",
          delimiter: f.delimiter,
          encoding: f.encoding,
          decimal_comma: Boolean(f.decimalComma),
          columns: {
            id_index: f.idCol,
            amount_index: f.amountCol,
            status_index: f.statusCol,
          },
          keep_cols: f.keepColsText
            ? f.keepColsText.split(",").map((x) => x.trim()).filter(Boolean)
            : [],
        })),
        pairs: pairs.map((p) => ({ key: p.key, counts: p.counts })),
      };



      // Finalize diagnostics
      diag.finished_at = new Date().toISOString();
      diag.timings_ms.total = Math.round(nowMs() - tRun0);
      runSelfChecks(diag, pairs);

      // Prepare warnings text (if any)
      const warningsText = diag.warnings.length
        ? diag.warnings.map((w, i) => `${i+1}. ${w}`).join("
") + "
"
        : "";
      state.lastDiagnostics = diag;

      const downloads = {
        summary: downloadJsonLink("summary.json", "summary.json", summary),
        diagnostics: downloadJsonLink("diagnostics.json", "diagnostics.json", diag),
        warnings: warningsText ? downloadLink("warnings.txt", "warnings.txt", warningsText, "text/plain;charset=utf-8") : null,
        statusTotals: statusTotalsLinks,
      };

      setProgress("Done.", 100);
      renderResults({ ...summary, pairs }, downloads);
    } catch (e) {
      setProgress("Error.", 0);
      resultsEl.innerHTML = `<div class="mono" style="color: var(--danger)">${escapeHtml(e?.stack || String(e))}</div>`;
    } finally {
      state.running = false;
    }
  }

  async function refreshHeaderForFile(fileId) {
    const f = state.files.find((x) => x.id === fileId);
    if (!f || !f.file) return;
    if (f._refreshing) return;
    f._refreshing = true;
    try {
      setProgress(`Reading header: ${f.name}…`, 0);
      // Decode a small slice for preview to respect encoding.
      const slice = f.file.slice(0, Math.min(512 * 1024, f.file.size));
      const text = await decodeFileToText(slice, f.encoding);
      const header = await new Promise((resolve, reject) => {
        Papa.parse(text, {
          delimiter: f.delimiter || "",
          preview: 1,
          skipEmptyLines: true,
          complete: (res) => resolve(((res.data && res.data[0]) || []).map((x) => String(x ?? "").trim())),
          error: (err) => reject(err),
        });
      });
      f.header = header;

      // Auto-guess columns.
      if (f.idCol < 0) {
        const idx = guessColumn(header, ["transaction_id", "txid", "txn", "transactionid", "id"]);
        if (idx >= 0) f.idCol = idx;
      }
      if (f.amountCol < 0) {
        const idx = guessColumn(header, ["amount", "sum", "total", "value"]);
        if (idx >= 0) f.amountCol = idx;
      }
      if (f.statusCol < 0) {
        const idx = guessColumn(header, ["status", "state"]);
        if (idx >= 0) f.statusCol = idx;
      }

      renderFiles();
      setProgress(`Header loaded: ${f.name}`, 0);
    } catch (e) {
      f.header = [];
      renderFiles();
      setProgress(`Failed to read header: ${f.name}`, 0);
      resultsEl.innerHTML = `<div class="mono" style="color: var(--danger)">Header read error for ${escapeHtml(f.name)}: ${escapeHtml(String(e))}</div>`;
    } finally {
      f._refreshing = false;
    }
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
    if (btn.getAttribute("data-action") === "remove-file") removeFile(fileId);
  });

  filesEl.addEventListener("change", async (ev) => {
    const root = ev.target.closest("[data-file-id]");
    if (!root) return;
    const fileId = root.getAttribute("data-file-id");
    const f = state.files.find((x) => x.id === fileId);
    if (!f) return;

    if (ev.target.name === "primary") {
      state.primaryId = fileId;
      renderFiles();
      return;
    }

    const field = ev.target.getAttribute("data-field");
    if (!field) return;

    if (field === "file") {
      f.file = ev.target.files && ev.target.files[0] ? ev.target.files[0] : null;
      if (f.file) await refreshHeaderForFile(fileId);
      renderFiles();
      return;
    }

    if (field === "encoding") {
      f.encoding = ev.target.value;
      if (f.file) await refreshHeaderForFile(fileId);
      return;
    }

    if (field === "decimalComma") {
      f.decimalComma = ev.target.value === "1";
      return;
    }

    if (field === "idCol" || field === "amountCol" || field === "statusCol") {
      f[field] = Number(ev.target.value);
      return;
    }
  });

  filesEl.addEventListener("input", async (ev) => {
    const root = ev.target.closest("[data-file-id]");
    if (!root) return;
    const fileId = root.getAttribute("data-file-id");
    const f = state.files.find((x) => x.id === fileId);
    if (!f) return;
    const field = ev.target.getAttribute("data-field");
    if (!field) return;

    if (field === "name") {
      f.name = ev.target.value;
      return;
    }
    if (field === "delimiter") {
      const d = ev.target.value;
      f.delimiter = d ? d[0] : "";
      if (f.file && f.delimiter.length === 1) await refreshHeaderForFile(fileId);
      return;
    }
    if (field === "keepCols") {
      f.keepColsText = ev.target.value;
      return;
    }
  });

  // Unified click delegation for diff table controls (tabs + pagination).
  resultsEl.addEventListener("click", (ev) => {
    // ── Tab filter ──────────────────────────────────────────────────────────
    const tab = ev.target.closest("[data-diff-filter]");
    if (tab) {
      const pairBlock = tab.closest("[data-pair-key]");
      if (!pairBlock) return;
      const pairKey = pairBlock.getAttribute("data-pair-key");
      pairBlock.querySelectorAll("[data-diff-filter]").forEach((t) => {
        t.classList.remove("diff-tab--active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("diff-tab--active");
      tab.setAttribute("aria-selected", "true");
      const st = diffState.get(pairKey);
      if (st) { st.filter = tab.getAttribute("data-diff-filter"); st.page = 1; }
      reRenderPairTable(pairKey);
      return;
    }

    // ── Page size ───────────────────────────────────────────────────────────
    const pgSzBtn = ev.target.closest("[data-page-size]");
    if (pgSzBtn) {
      const pairBlock = pgSzBtn.closest("[data-pair-key]");
      if (!pairBlock) return;
      const pairKey  = pairBlock.getAttribute("data-pair-key");
      const rawVal   = pgSzBtn.getAttribute("data-page-size");
      const st = diffState.get(pairKey);
      if (st) { st.pageSize = rawVal === "all" ? "all" : Number(rawVal); st.page = 1; }
      reRenderPairTable(pairKey);
      return;
    }

    // ── Prev page ───────────────────────────────────────────────────────────
    const prevBtn = ev.target.closest("[data-page-prev]");
    if (prevBtn && !prevBtn.disabled) {
      const pairBlock = prevBtn.closest("[data-pair-key]");
      if (!pairBlock) return;
      const pairKey = pairBlock.getAttribute("data-pair-key");
      const st = diffState.get(pairKey);
      if (st && st.page > 1) { st.page -= 1; reRenderPairTable(pairKey); }
      return;
    }

    // ── Next page ───────────────────────────────────────────────────────────
    const nextBtn = ev.target.closest("[data-page-next]");
    if (nextBtn && !nextBtn.disabled) {
      const pairBlock = nextBtn.closest("[data-pair-key]");
      if (!pairBlock) return;
      const pairKey = pairBlock.getAttribute("data-pair-key");
      const st = diffState.get(pairKey);
      if (!st) return;
      st.page += 1; // reRenderPairTable clamps to totalPages internally
      reRenderPairTable(pairKey);
      return;
    }
  });

  // init
  addFile({ name: "primary" });
  addFile({ name: "other" });
})();
