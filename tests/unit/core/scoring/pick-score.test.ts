import { describe, it, expect } from 'vitest'
import golden from './golden.json'
import {
  pickScore,
  rankPicksForSeat,
  transformModelPickPosition,
  nextPickIndexFor,
  type ScoreItem,
  type ScoreState,
  type SynergyLookup,
} from '@core/scoring/pick-score'

// golden.json was produced by running ad-simulator's own pickScore (testing branch
// public/simulator.html) over random legal draft states, so this asserts the port
// matches the simulator's numbers, not just its own idea of them.

const synergyMap = new Map<string, number>(
  (golden.synergy as [string, string, number][]).map(([a, b, s]) => [a < b ? `${a}|${b}` : `${b}|${a}`, s]),
)
const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
const synergy: SynergyLookup = {
  between: (a, b) => (a === b ? 0 : (synergyMap.get(key(a, b)) ?? 0)),
  has: (a, b) => a !== b && synergyMap.has(key(a, b)),
}

interface GoldenItem extends ScoreItem {
  picked: boolean
}

function stateFor(c: (typeof golden.cases)[number]): { state: ScoreState; byName: Map<string, ScoreItem> } {
  const items = c.pool as GoldenItem[]
  const byName = new Map(items.map((i) => [i.name, i as ScoreItem]))
  return {
    byName,
    state: {
      available: items.filter((i) => !i.picked),
      picks: c.picks.map((names) => names.map((n) => byName.get(n) as ScoreItem)),
      pickIndex: c.pickIndex,
    },
  }
}

describe('pickScore matches the simulator', () => {
  for (const c of golden.cases) {
    it(`draft state at pick ${c.pickIndex}`, () => {
      const { state, byName } = stateFor(c)
      for (const check of c.checks) {
        const item = byName.get(check.name) as ScoreItem
        const score = pickScore(item, check.seat, state, synergy)
        if (check.score === null) {
          // The simulator yields NaN (not a real score) when scoring for a seat that
          // already holds all 5 picks — its pool-synergy weight table has no entry.
          // Such a seat has no legal candidates, so it's unreachable; anything else
          // that's non-finite must be a missing-data Infinity.
          if (state.picks[check.seat].length < 5) expect(score).toBe(Infinity)
        } else {
          expect(score).toBeCloseTo(check.score, 9)
        }
      }
    })
  }
})

describe('rankPicksForSeat', () => {
  it('returns the lowest scores first, only legal and finite ones', () => {
    const c = golden.cases[3]
    const { state } = stateFor(c)
    const ranked = rankPicksForSeat(2, state, synergy, 5, 'ability')
    expect(ranked.length).toBeLessThanOrEqual(5)
    for (let i = 1; i < ranked.length; i++) expect(ranked[i].score).toBeGreaterThanOrEqual(ranked[i - 1].score)
    for (const r of ranked) {
      expect(r.item.kind).toBe('ability')
      expect(Number.isFinite(r.score)).toBe(true)
    }
  })

  it('never offers a fourth basic or a second ultimate', () => {
    const basic = (n: string): ScoreItem => ({ name: n, kind: 'ability', isUlt: false, winrateHigh: 0.5, pickPositionHigh: 10 })
    const ult = (n: string): ScoreItem => ({ name: n, kind: 'ability', isUlt: true, winrateHigh: 0.5, pickPositionHigh: 10 })
    const held = [basic('a'), basic('b'), basic('c'), ult('u1')]
    const state: ScoreState = {
      available: [basic('d'), ult('u2')],
      picks: [held, ...Array.from({ length: 9 }, () => [])],
      pickIndex: 4,
    }
    expect(rankPicksForSeat(0, state, synergy, 5, 'ability')).toEqual([])
    expect(rankPicksForSeat(1, state, synergy, 5, 'ability').length).toBe(2)
  })
})

describe('helpers', () => {
  it('transformModelPickPosition', () => {
    expect(transformModelPickPosition(null)).toBeNull()
    expect(transformModelPickPosition(3)).toBe(3)
    expect(transformModelPickPosition(10)).toBe(5)
    expect(transformModelPickPosition(20)).toBe(16)
  })
  it('nextPickIndexFor walks the snake', () => {
    expect(nextPickIndexFor(0, 0)).toBe(19)
    expect(nextPickIndexFor(9, 9)).toBe(10)
    expect(nextPickIndexFor(0, 49)).toBeNull()
  })
})
