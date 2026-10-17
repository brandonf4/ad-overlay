# Scoring tests

`bot-engine.test.ts` checks `src/core/scoring/bot-engine.ts` against
`bot-engine.golden.json`: 100 draft states with the expected score of every term, produced
by running ad-simulator's own `botDecision` in a browser. It is what proves the port still
matches the site.

## When the site changes

1. Port the change into `src/core/scoring/bot-engine.ts` (and `engine-data.ts` if the data
   shape changed).
2. Copy the simulator's updated data files from its `public/` folder into
   `resources/data/` (heroes_abilities, ability_synergies, synergy_overrides,
   model_ability_shifts, ability_strength, role_skew, aghs_upgrades).
3. Regenerate the golden file. Serve the simulator's `public/` folder (with the same data
   files) on port 8765, e.g. `python3 -m http.server 8765`, then from this repo:

   ```bash
   node scripts/gen-bot-engine-golden.cjs tests/unit/core/scoring/bot-engine.golden.json
   ```

   It needs the `playwright` package and a Chromium (set `CHROMIUM_PATH` if it isn't at the
   default location).
4. `npx vitest run tests/unit/core/scoring` — a failure means the port and the site
   disagree.

`top-combos.test.ts` covers the combo win-rate reconstruction (the synergy files store a lift
over the two items' solo win rates; the panel inverts that to a real combo win rate).
