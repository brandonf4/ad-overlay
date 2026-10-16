// Regenerates tests/unit/core/scoring/bot-engine.golden.json from ad-simulator's own
// botDecision. Serve the simulator's public/ folder (with the same data files as
// resources/data) on port 8765, e.g. `python3 -m http.server 8765`, then run:
//   node scripts/gen-bot-engine-golden.cjs tests/unit/core/scoring/bot-engine.golden.json
// Needs the playwright package and a Chromium (set CHROMIUM_PATH if not the default).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const pg = await b.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('http://localhost:8765/simulator.html'); await pg.waitForTimeout(3000);
  const cases = await pg.evaluate(() => {
    // Seeded RNG so the drafts are reproducible.
    let s = 12345; Math.random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const out = [];
    const keys = ['base','ownSynergy','combo','scepter','shard','pool','getBack','personal','enemy','ally','scarcity','role','roleScarcity','total'];
    for (let d = 0; d < 6; d++) {
      initDraft();
      while (!done) {
        botDecisionCache = null;
        const dec = botDecision();
        if (pickIndex % 3 === d % 3) {
          out.push({
            pool: pool.map(a => ({ name: a.name, kind: a.kind, isUlt: !!a.isUlt, pickPositionHigh: a.pickPositionHigh ?? null })),
            picked: pool.map(a => a.picked),
            picks: picks.map(h => h.map(x => pool.indexOf(x))),
            pickIndex, seat: dec.seat,
            chosen: dec.chosen.name, deferredCats: dec.deferredCats,
            rows: dec.rows.map(r => Object.fromEntries([['name', r.item.name], ...keys.map(k => [k, Number.isFinite(r[k]) ? +r[k].toFixed(6) : (r[k] > 0 ? 'inf' : '-inf')])])),
          });
        }
        // Mostly the bot's pick, sometimes a random legal one so states vary.
        const avail = dec.rows.map(r => r.item);
        confirmPick(Math.random() < 0.25 ? avail[Math.floor(Math.random() * avail.length)] : dec.chosen);
      }
    }
    return out;
  });
  fs.writeFileSync(process.argv[2], JSON.stringify({ cases }));
  console.log(cases.length, 'cases', errs);
  await b.close();
})();
