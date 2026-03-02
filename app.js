/* ===============================
   CSV Reconciler — app.js (FULL)
   =============================== */

"use strict";

/* ---------- helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8
  });
}

function showBanner(msg, type = "info", ttl = 4000) {
  const host = $("#bannerHost");
  if (!host) return;

  const el = document.createElement("div");
  el.className = `banner ${type}`;
  el.textContent = msg;
  host.appendChild(el);

  setTimeout(() => {
    el.classList.add("hide");
    setTimeout(() => el.remove(), 300);
  }, ttl);
}

/* ---------- global state ---------- */

const state = {
  files: [],
  results: [],
  tolerance: 0.01,
  keepColsGlobal: [],
  globalTxid: "",
  primaryFileId: null
};

/* ---------- DOM refs ---------- */

const els = {
  files: $("#files"),
  results: $("#results"),
  progress: $("#progress"),
  progressBar: $("#progressBar"),
  tolerance: $("#tolerance"),
  keepColsGlobal: $("#keepColsGlobal"),
  globalTxidSearch: $("#globalTxidSearch"),
  globalTxidClear: $("#globalTxidClear"),
  addFileBtn: $("#addFileBtn"),
  runBtn: $("#runBtn"),

  detailsPanel: $("#detailsPanel"),
  detailsBody: $("#detailsBody"),
  detailsCloseBtn: $("#detailsCloseBtn"),
  detailsCopyTxidBtn: $("#detailsCopyTxidBtn"),

  modalBackdrop: $("#modalBackdrop"),
  modal: $("#modal"),
  modalTitle: $("#modalTitle"),
  modalBody: $("#modalBody"),
  modalFoot: $("#modalFoot"),
  modalClose: $("#modalClose")
};

/* ---------- init ---------- */

function init() {
  bindGlobalEvents();
  renderFiles();
  renderResults();
}

document.addEventListener("DOMContentLoaded", init);

/* ---------- global bindings ---------- */

function bindGlobalEvents() {
  els.addFileBtn?.addEventListener("click", addFileWithPicker);
  els.runBtn?.addEventListener("click", runReconcile);

  els.tolerance?.addEventListener("change", () => {
    state.tolerance = parseFloat(els.tolerance.value) || 0;
  });

  els.keepColsGlobal?.addEventListener("change", () => {
    state.keepColsGlobal = els.keepColsGlobal.value
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
  });

  els.globalTxidSearch?.addEventListener("input", () => {
    state.globalTxid = els.globalTxidSearch.value.trim();
    renderResults();
  });

  els.globalTxidClear?.addEventListener("click", () => {
    state.globalTxid = "";
    els.globalTxidSearch.value = "";
    renderResults();
  });

  els.detailsCloseBtn?.addEventListener("click", closeDetails);
  els.detailsCopyTxidBtn?.addEventListener("click", copyDetailsTxid);

  els.modalClose?.addEventListener("click", closeModal);
  els.modalBackdrop?.addEventListener("click", e => {
    if (e.target === els.modalBackdrop) closeModal();
  });
}

/* ---------- file picker ---------- */

function addFileWithPicker() {
  let input = document.querySelector("#filePicker");

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

  input.value = "";

  const onChange = async () => {
    try {
      const file = input.files && input.files[0];
      if (!file) return;

      addFile({
        id: uid(),
        file,
        name: file.name.replace(/\.[^.]+$/, ""),
        cols: [],
        rows: [],
        primary: false
      });

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
  input.click();
}

/* ---------- file handling ---------- */

function addFile(f) {
  state.files.push(f);
  if (!state.primaryFileId) {
    state.primaryFileId = f.id;
    f.primary = true;
  }
  renderFiles();
}

async function refreshHeaderForFile(fileId) {
  const f = state.files.find(x => x.id === fileId);
  if (!f) return;

  const text = await f.file.text();
  const parsed = Papa.parse(text, {
    header: true,
    preview: 1,
    skipEmptyLines: true
  });

  f.cols = parsed.meta.fields || [];
}

/* ---------- rendering: files ---------- */

function renderFiles() {
  if (!els.files) return;
  els.files.innerHTML = "";

  if (!state.files.length) {
    els.files.innerHTML =
      `<div class="muted small">No files added yet</div>`;
    return;
  }

  state.files.forEach(f => {
    const row = document.createElement("div");
    row.className = "fileRow";

    row.innerHTML = `
      <div class="fileMain">
        <label class="radio">
          <input type="radio" name="primary"
            ${f.primary ? "checked" : ""}/>
          <span>PRIMARY</span>
        </label>
        <div class="fileName mono">${f.name}</div>
      </div>
      <div class="fileCols mono small">
        ${f.cols.length ? f.cols.join(", ") : "—"}
      </div>
    `;

    $("input", row).addEventListener("change", () => {
      state.files.forEach(x => (x.primary = false));
      f.primary = true;
      state.primaryFileId = f.id;
      renderFiles();
    });

    els.files.appendChild(row);
  });
}

/* ---------- reconcile ---------- */

async function runReconcile() {
  if (state.files.length < 2) {
    showBanner("Add at least two CSV files", "warn");
    return;
  }

  const primary = state.files.find(f => f.primary);
  if (!primary) {
    showBanner("Pick a PRIMARY file", "warn");
    return;
  }

  els.progress.hidden = false;
  els.progressBar.style.width = "0%";

  await sleep(50);

  const worker = new Worker("./worker.js");

  worker.postMessage({
    files: state.files.map(f => ({
      id: f.id,
      name: f.name,
      file: f.file
    })),
    primaryId: state.primaryFileId,
    tolerance: state.tolerance,
    keepCols: state.keepColsGlobal
  });

  worker.onmessage = e => {
    const { type, payload } = e.data;

    if (type === "progress") {
      els.progressBar.style.width = payload + "%";
    }

    if (type === "done") {
      state.results = payload || [];
      els.progress.hidden = true;
      renderResults();
      showBanner("Reconciliation complete", "ok");
      worker.terminate();
    }
  };
}

/* ---------- rendering: results ---------- */

function renderResults() {
  if (!els.results) return;
  els.results.innerHTML = "";

  let rows = state.results;

  if (state.globalTxid) {
    rows = rows.filter(r =>
      String(r.txid || "").includes(state.globalTxid)
    );
  }

  if (!rows.length) {
    els.results.innerHTML =
      `<div class="muted small">No results</div>`;
    return;
  }

  rows.forEach(r => {
    const row = document.createElement("div");
    row.className = "resultRow";

    row.innerHTML = `
      <div class="mono">${r.txid || "—"}</div>
      <div class="mono">${fmt(r.diff)}</div>
      <div class="small muted">${r.status}</div>
    `;

    row.addEventListener("click", () => openDetails(r));
    els.results.appendChild(row);
  });
}

/* ---------- details ---------- */

function openDetails(r) {
  els.detailsPanel.hidden = false;
  els.detailsBody.innerHTML = "";

  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(r, null, 2);
  els.detailsBody.appendChild(pre);

  els.detailsPanel.dataset.txid = r.txid || "";
}

function closeDetails() {
  els.detailsPanel.hidden = true;
  els.detailsBody.innerHTML = "";
}

function copyDetailsTxid() {
  const txid = els.detailsPanel.dataset.txid;
  if (!txid) return;
  navigator.clipboard.writeText(txid);
  showBanner("txid copied", "ok", 1500);
}

/* ---------- modal ---------- */

function openModal(title, bodyHtml, footHtml = "") {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = bodyHtml;
  els.modalFoot.innerHTML = footHtml;

  els.modalBackdrop.hidden = false;
  els.modal.hidden = false;
}

function closeModal() {
  els.modalBackdrop.hidden = true;
  els.modal.hidden = true;
  els.modalTitle.textContent = "";
  els.modalBody.innerHTML = "";
  els.modalFoot.innerHTML = "";
}

/* ---------- eof ---------- */
