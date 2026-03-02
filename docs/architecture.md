# Architecture (v5.0)

_Last updated: 2026-02-27_

This project is a **client-side CSV reconciliation tool** designed to handle large datasets in the browser with predictable performance.

## Components

- **UI (main thread)**: file selection, settings, rendering, progress UI, downloads.
- **Worker (`worker.js`)**: heavy compute (parsing, indexing, diffing, exporting).
- **Storage (OPFS when available)**: persistent storage for inputs and derived indices to reduce RAM pressure and enable restore.

## Data flow

1. **Load**: user selects base + other CSV.
2. **Autotune**: choose engine mode based on file size/estimated rows/capabilities.
3. **Parse**: streaming/chunk parsing in the worker (no UI blocking).
4. **Index**: build compact indexes for fast reconciliation and “details on demand”.
5. **Reconcile**: merge/diff pipeline produces summary + pageable result views.
6. **Details**: UI requests keep-columns for the visible page; worker serves from index/OPFS where possible.
7. **Export**: export is produced in a memory-safe way (chunked and/or disk streaming when supported).

## Design goals

- Keep the UI responsive (main thread never does heavy parsing/diffing).
- Prefer **bounded memory** over “hold everything”.
- Provide reproducible diagnostics and predictable behavior under load.
