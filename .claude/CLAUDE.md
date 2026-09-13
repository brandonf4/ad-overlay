# AD Draft Overlay

Fork of [Tiarin-Hino/ability-draft-plus](https://github.com/Tiarin-Hino/ability-draft-plus)
(ISC license). Keeps its scanning/overlay infrastructure (window tracking, screenshot
capture, ONNX ability classifier, resolution/coordinate calibration, GSI phase detection,
click-through overlay window) and replaces its scoring engine + UI with this project's own.

**Read `docs/plan.md` first** — it has the full context: what was kept vs. replaced vs.
dropped from upstream, why, and the phased roadmap. Currently on Phase 1 (scanning
pipeline proven end-to-end with a placeholder overlay; no scoring or real UI yet).

Do not trust any other doc in this repo (or comments referencing removed services like
`database-service`, `scraper-service`, `stream-server-service`, role-mode scoring, etc.)
as current — those describe the pre-fork upstream architecture and are stale here.

Stack: Electron + electron-vite (main/preload/renderer×2), React 19, TypeScript, Zustand +
@zubridge, onnxruntime-node, sharp, koffi (Win32 FFI). Windows-only.
