# Behavior Guarantees

These are the intended product guarantees.

## Correctness
- Amount comparisons are performed using integer-scaled arithmetic (no floating-point rounding).
- Key matching is deterministic: the same inputs + settings produce the same results.

## Transparency
- If the UI shows a sample (for performance), it is labeled; exports aim to remain complete when feasible.
- Any fallback path (e.g., OPFS unavailable) is surfaced as a warning.

## Privacy
- The tool is designed to run locally in the browser. No network transmission is required for core operation.
