# Reconciler Web UI (v5.1 stable)

Static web interface for viewing and interacting with reconciliation outputs.

## Deploy on GitHub Pages (recommended)

### Option 1 — `/docs` folder (classic Pages)

1. Put the project into the root of your repo.
2. Ensure there is a `docs/` folder that contains the built static site (HTML/CSS/JS).
3. In GitHub:
   - Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main`
   - Folder: `/docs`

### Option 2 — root (`/`)

If your Pages is configured to serve from `/ (root)`, place the static files in the repository root.

## Local run

This is a static site. Open `index.html` in a browser.

For a simple local server:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Notes

- This archive is a code snapshot to ensure the latest UI work is preserved.
