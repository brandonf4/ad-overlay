# AD Draft Overlay

A live Dota 2 Ability Draft overlay: scans the draft board on-screen, keeps track of
what everyone has picked, and shows each player on your team their best remaining picks,
scored with the same bot logic and data as [ad-simulator](../ad-simulator).

## What this is

This is a fork of [Tiarin-Hino/ability-draft-plus](https://github.com/Tiarin-Hino/ability-draft-plus)
(ISC license), keeping its scanning/overlay infrastructure — window tracking,
screenshot capture, the ONNX ability classifier, per-resolution coordinate
calibration, and the click-through always-on-top overlay window — while replacing its
scoring algorithm and visual UI with this project's own. See `docs/plan.md` for the
original breakdown of what was kept vs. replaced vs. dropped, and why.

All credit for the scanning/ML/overlay-window engineering goes to the upstream
project; see `LICENSE` for the required copyright notice.

## What it does now

Windows only. With Dota 2 in an Ability Draft:

- **Live scan.** **Scan** starts a loop that re-reads the board about every 1.5 s;
  **Stop** ends it, **Close** (or Esc) closes the overlay.
- **Draft tracking.** From each scan it works out which pool abilities and hero models
  have been drafted, and which player holds what. An ability counts as drafted when its
  pool box turns into a dimmed copy of its own icon (or it shows up in a player's row);
  hover tooltips, black transition screens and similar don't count. Hero models are
  identified from their abilities, and counted as drafted when their tile changes for
  several scans in a row.
- **Per-player menus.** **Pick side** (Radiant or Dire) puts a menu beside each of your
  teammates with their top 5 picks (abilities and hero models, with mini icons), in the
  simulator bot's order with the site's score (higher is better).
- **Top combos panel.** Right of the ultimates: the 15 best ability/model pairs still
  available by estimated combo win rate, including pairs where one half is already drafted
  by a player who still has room for the other (tagged R1-R5 / D1-D5).
- **Logging.** `%APPDATA%\ad-draft-overlay\logs\main.log` records the draft state as it
  changes, and each time a pool ability is judged drafted, with the numbers behind it.

Known limits: the combos panel can overlap the Dire hero models at resolutions below
about 1080p; a picked ability whose player-row icon can't be matched isn't attributed to
that player (it is still removed from the suggestions); the real UI design is still to do.

### Try it

```bash
npm install
node node_modules/electron/install.js   # only if npm's postinstall didn't run the binary download
npm run dev
```

In the control panel, activate the overlay, click **Scan**, and pick your side.
`npm run build:dist` builds a Windows installer.

## Scoring

`src/core/scoring/bot-engine.ts` is a function-for-function port of the simulator's
`botDecision`; `engine-data.ts` builds its data from the files in `resources/data`,
which are copies of the simulator's. When the site's logic or data changes, port the
change, refresh those files, and regenerate the golden test — see
`tests/unit/core/scoring/README.md`.

## Tests

```bash
npx vitest run
```

34 test files from the original upstream project still fail because they test code that
was removed in the fork (14 tests); they were failing before any of the new work and can
be deleted. Note `npm run typecheck` checks nothing here (the root tsconfig only has
project references) — use `npx tsc -b tsconfig.json --force`, which still reports some
older errors in the worker, ONNX and control-panel code.

## Roadmap

1. ~~Fork + strip to a minimal working scan/overlay shell~~
2. ~~Port the `ad-simulator` scoring engine into a real data layer + scan-processor~~
3. Design and build the real overlay UI (the current one is a functional placeholder)
4. Keep testing against live drafts and fix what they turn up
