# CSV Reconciler

Browser-based transaction reconciliation tool. Upload two or more CSV files and get a colour-coded diff of mismatches, missing transactions, and duplicates — entirely in the browser, no data leaves your machine.

**Live:** https://vshroot.github.io/reconciler

## Usage
1. Open the live link or open `index.html` locally.
2. Add at least 2 CSV files and configure columns (transaction_id, amount, status).
3. Click **Run reconciliation**.
4. Review the in-page diff table and download CSV reports.

## Privacy
All processing happens locally in the browser. No files or data are sent to any server.

## Performance notes
- 3.10 reduces memory use in the worker by removing the `keyIndex` Map for unique txids and using binary search on sorted `uniqueKeys[]` instead.


## UI v5
This build includes UI v2–v5 improvements: sticky columns, filters, export view, saved views, column manager, compare pins, performance bar.
