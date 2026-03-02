# Security & Privacy

## Data locality
- The application is intended to process files locally in the browser.
- Persistent data (if enabled) is stored in the browser's origin-private storage (OPFS) when supported.

## Threat model notes
- Inputs are treated as untrusted. UI rendering must escape content to prevent XSS.
- Downloads are generated locally.
