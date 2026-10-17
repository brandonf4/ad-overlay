# Dota 2 Ability Draft live overlay — new project, forked scanning core

> **Status note (later update):** this is the original Phase 1 plan, kept for the
> kept/replaced/dropped breakdown. Phases 1 and 2 are done, and the overlay now scans live,
> tracks the draft and shows scored picks and combos — see `README.md` for the current
> state. Details below about the data layer and the old scoring (`pickScore`, the
> in-memory data files) describe the plan, not what shipped; the shipped scoring is
> `src/core/scoring/bot-engine.ts`.

## Context

`ad-simulator` already has a validated pick-scoring engine (`pickScore`, `poolSynergyTerm`, `enemySynergyTerm`, `allySynergyTerm`, held-item synergy, `transformModelPickPosition`) and fresh Windrun-sourced data (`heroes_abilities.json`, `ability_synergies.json`). The goal now is a **live desktop overlay** that scans an actual Dota 2 Ability Draft in progress and surfaces suggestions from that same scoring logic, instead of only simulating drafts in a browser.

Building the scanning half from scratch (window capture, an ML model trained to recognize all 528 abilities/heroes from screenshots, per-resolution coordinate calibration, GSI-driven lifecycle, a click-through always-on-top overlay window) would be a multi-week project on its own. `Tiarin-Hino/ability-draft-plus` (ISC-licensed, permissive) already solves exactly that half, in a codebase where the scanning pipeline and the suggestion/UI layer are already cleanly separated by one seam. The plan is to fork it, keep the scanning/overlay infrastructure close to as-is, and replace the two things the user explicitly wants different: the scoring algorithm and the visual UI.

Confirmed via direct source reading (not just the README) that the seam is real: everything from window tracking through ML inference through resolution calibration through GSI down to the overlay window mechanics has **zero imports** from the old scoring (`src/core/domain/`) or old UI (`src/renderer/`) — grep-verified. The one integration point is `scan-trigger-service.ts` calling `scanProcessingService.handleScanResults(...)` as its last step, and the one IPC channel is `overlay:data`.

## What gets kept vs. replaced

**Kept (forked close to verbatim, ISC copyright notice preserved):**
- `src/main/services/window-tracker-service.ts`, `cached-window-capture-service.ts`, `screenshot-service.ts` — Dota 2 window discovery (koffi + `user32.dll`) and screenshot capture. Windows-only.
- `src/core/ml/*`, `src/main/services/ml-service.ts`, `src/main/workers/ml-worker.ts` — ONNX classifier (MobileNetV2, `resources/model/ability_classifier_fp16.onnx` + `class_names.json`, both plain files already in the repo) plus the NCC template-matcher for picked-slot detection.
- `src/core/resolution/*`, `src/main/services/layout-service.ts` — the 28-resolution preset table, auto-scaling formula, and 4-anchor calibration wizard. Pure functions; also what drives hotspot *positioning* in the UI, so this is shared infrastructure for both the scan and the (new) overlay rendering.
- `src/core/gsi/*`, `src/main/services/gsi-cfg-service.ts` — phase/clock detection and cfg installation. `draft-clock.ts`'s `turnAt()`/schedule math is a bonus: combined with "my seat," it gives the current global pick index for free, which is exactly what `enemySynergyTerm`'s `picksBetween` weighting needs.
- `src/main/services/window-manager.ts` — the click-through/always-on-top/transparent overlay window, including the hard-won Windows quirks (1px-shrink-to-avoid-fullscreen-mouse-lock, re-arming mouse-forwarding after `setBounds`).
- `src/main/services/scan-trigger-service.ts` — capture cascade + orchestration, with its `scanProcessingService` dependency swapped for a new implementation (same call shape).
- `src/shared/types`, `src/shared/ipc/api.ts`, `src/shared/constants` — kept as the base; extended/trimmed for the new payload.

**Replaced:**
- `src/core/domain/*` (scoring, top-tier, op-trap-filter, role-scoring, synergy-enrichment, player-draft-score, etc.) → a new, much smaller module porting `pickScore` and its terms from `ad-simulator/public/simulator.html` (testing branch) into TypeScript, run against the *not-yet-picked* pool for "my seat" specifically (not simulating all 10 players — just ranking what's left for me).
- `src/core/database/*` (sql.js + Drizzle + scraper pipeline) → dropped entirely. Load `heroes_abilities.json` + `ability_synergies.json` into in-memory `Map`s at startup instead; no SQLite, no scraper, no Liquipedia/Windrun scraping code carried over.
- `src/renderer/overlay/src/components/*` (hotspot borders, tooltip, OP/Trap panels, role panel) → new components, but reusing the same absolute-positioning approach (`slot.coord.x/scaleFactor` etc.) since that part is coordinate math, not visual design.
- `OverlayDataPayload` in `src/shared/ipc/api.ts` → a slimmer payload shape carrying only what the new scoring produces (per-slot suggestion score + rank, not the 25-field legacy `EnrichedScanSlot`).

**Dropped outright (unrelated to the ask, cut for a leaner base):** the control-panel's role-mode UI, Aghanim's-stacking/skill-point-conflict logic, personal-Windrun-profile linking, stream-server/OBS overlay, auto-updater wiring, Sentry, and non-English locales. Basic settings (overlay opacity/anchor, thresholds) and the control-panel window itself stay, minus the parts that only existed to configure removed features.

## New project

- Location: `C:\Users\brand\ad-draft-overlay` (sibling to `ad-simulator`), new independent git repo — not a subfolder of ad-simulator.
- Bootstrap by cloning `ability-draft-plus` in, then deleting/rewriting per the split above, rather than starting `package.json` from zero — keeps `electron-vite`/`electron-builder` config, tsconfig, eslint/prettier setup, and the Windows build pipeline intact.
- `LICENSE`/`README` credit the original project per the ISC notice requirement, alongside a new README describing this fork's actual scope.

## Phased delivery (this session covers Phase 1 only)

1. **Phase 1 (now)**: Fork the repo into the new location, strip the dropped features and old domain/database/renderer code, get a buildable/runnable shell that captures the Dota 2 window, runs the ONNX scan, and shows a *minimal placeholder* overlay (e.g. just a colored border per detected slot, no scores yet) — proving the kept pipeline still works end-to-end before any new logic is layered on.
2. **Phase 2 (separate follow-up)**: Port the scoring module (data loading + `pickScore`/synergy terms) and wire it into the new `scan-processor` replacement.
3. **Phase 3 (separate follow-up)**: Design and build the real overlay UI on top of the working data.
4. **Phase 4 (separate follow-up)**: End-to-end test against a live Dota 2 Ability Draft, iterate.

## Verification for Phase 1

- `npm install && npm run build` succeeds in the new project.
- `npm run dev` launches the control panel + can create the overlay window without crashing.
- Manually confirm window-tracker finds a "Dota 2" window (can test against any window titled "Dota 2" or a renamed test window if Dota isn't running) and a scan produces classifier output in the dev console/logs, without requiring the new scoring or UI to be functional yet.
