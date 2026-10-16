import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import golden from './bot-engine.golden.json'
import { DraftScorer, type EngineData } from '@core/scoring/bot-engine'
import { buildEngineData } from '@core/scoring/engine-data'
import { rankPicksForSeat, type ScoreItem } from '@core/scoring/pick-score'

// bot-engine.golden.json was produced by running ad-simulator's own botDecision
// (public/simulator.html) over seeded random drafts with the same resources/data
// files, so this asserts the port matches the simulator's numbers, not just its own
// idea of them. Regenerate it whenever the simulator or resources/data changes
// (scripts/gen-bot-engine-golden.cjs).

const read = (f: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '../../../../resources/data', f), 'utf-8'))

const data: EngineData = buildEngineData({
  synergies: read('ability_synergies.json') as [string, string, number][],
  overrides: read('synergy_overrides.json') as never,
  shifts: read('model_ability_shifts.json') as never,
  strength: read('ability_strength.json') as never,
  roles: read('role_skew.json') as never,
  upgrades: read('aghs_upgrades.json') as never,
})

const PARTS = [
  'base',
  'ownSynergy',
  'combo',
  'scepter',
  'shard',
  'pool',
  'getBack',
  'personal',
  'enemy',
  'ally',
  'scarcity',
  'role',
  'roleScarcity',
  'total',
] as const
const num = (v: number | string): number =>
  v === 'inf' ? Infinity : v === '-inf' ? -Infinity : (v as number)

describe('bot engine matches the simulator', () => {
  for (const [i, c] of golden.cases.entries()) {
    it(`case ${i}: pick ${c.pickIndex}, seat ${c.seat}`, () => {
      const items: ScoreItem[] = c.pool.map((p) => ({
        name: p.name,
        kind: p.kind as ScoreItem['kind'],
        isUlt: p.isUlt,
        winrateHigh: null,
        pickPositionHigh: p.pickPositionHigh,
      }))
      const scorer = new DraftScorer(data, {
        available: items.filter((_, j) => !c.picked[j]),
        picks: c.picks.map((idx) => idx.map((j) => items[j])),
        pickIndex: c.pickIndex,
      })
      const d = scorer.decide(c.seat)
      expect(d.chosen?.name).toBe(c.chosen)
      expect(d.deferredCats).toEqual(c.deferredCats)
      const byName = new Map(d.rows.map((r) => [r.item.name, r]))
      expect(d.rows.length).toBe(c.rows.length)
      for (const g of c.rows) {
        const r = byName.get(g.name)
        expect(r, g.name).toBeDefined()
        for (const k of PARTS) {
          const want = num(g[k] as number | string)
          const got = r![k]
          if (Number.isFinite(want)) expect(got, `${g.name} ${k}`).toBeCloseTo(want, 4)
          else expect(got, `${g.name} ${k}`).toBe(want)
        }
      }
    })
  }
})

describe('rankPicksForSeat', () => {
  it("lists the bot's pick first, with the shown (higher = better) score", () => {
    for (const c of golden.cases.slice(0, 20)) {
      const items: ScoreItem[] = c.pool.map((p) => ({
        name: p.name,
        kind: p.kind as ScoreItem['kind'],
        isUlt: p.isUlt,
        winrateHigh: null,
        pickPositionHigh: p.pickPositionHigh,
      }))
      const scorer = new DraftScorer(data, {
        available: items.filter((_, j) => !c.picked[j]),
        picks: c.picks.map((idx) => idx.map((j) => items[j])),
        pickIndex: c.pickIndex,
      })
      const ranked = rankPicksForSeat(c.seat, scorer, 5)
      expect(ranked[0].item.name).toBe(c.chosen)
      const row = c.rows.find((r) => r.name === c.chosen)!
      expect(ranked[0].score).toBeCloseTo(-(row.total as number), 4)
    }
  })
})
