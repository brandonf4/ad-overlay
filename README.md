# AD Draft Overlay

A live Dota 2 Ability Draft overlay: scans the draft board on-screen and (eventually)
surfaces pick suggestions from the same scoring engine used in
[ad-simulator](../ad-simulator).

## What this is

This is a fork of [Tiarin-Hino/ability-draft-plus](https://github.com/Tiarin-Hino/ability-draft-plus)
(ISC license), keeping its scanning/overlay infrastructure — window tracking,
screenshot capture, the ONNX ability classifier, per-resolution coordinate
calibration, GSI phase detection, and the click-through always-on-top overlay
window — while replacing its scoring algorithm and visual UI with this project's
own. See `docs/plan.md` for the full breakdown of what was kept vs. replaced vs.
dropped, and why.

All credit for the scanning/ML/overlay-window engineering goes to the upstream
project; see `LICENSE` for the required copyright notice.

## Status: Phase 1 (scanning pipeline proven, no scoring yet)

The current build is a placeholder: it scans the draft pool and draws a colored
border + name label on every recognized ability slot, proving the kept pipeline
(capture → ONNX inference → coordinate mapping → overlay) works end-to-end. It
has **no suggestions, no data layer, and no real UI yet** — that's Phase 2/3.

### Try it

```bash
npm install
node node_modules/electron/install.js   # only if npm's postinstall didn't run the binary download
npm run dev
```

In the control panel, activate the overlay, then click **Scan**. Recognized
ability/hero slots should get a green border + label; unrecognized slots get a
red border.

## Roadmap

1. ~~Fork + strip to a minimal working scan/overlay shell~~ (this phase)
2. Port the `ad-simulator` scoring engine (`pickScore` and its synergy terms) into
   a real data layer + scan-processor replacement
3. Design and build the real overlay UI
4. End-to-end test against a live Dota 2 draft, iterate
