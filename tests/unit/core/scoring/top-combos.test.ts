import { describe, it, expect } from 'vitest'
import { rankTopCombos, type ComboItem } from '@core/scoring/top-combos'
import type { SynergyLookup } from '@core/scoring/pick-score'

// Synergy data is stored as a "lift" in percentage points: increase = comboWinrate -
// average(soloA, soloB). rankTopCombos inverts that (comboWinrate = increase/100 +
// average) to recover the real combo win rate — these tests check that inversion
// directly against hand-computed values, not just relative ordering.

function synergyOf(pairs: Record<string, number>): SynergyLookup {
  const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const map = new Map(Object.entries(pairs).map(([k, v]) => [k, v]))
  return {
    between: (a, b) => map.get(key(a, b)) ?? 0,
    has: (a, b) => map.has(key(a, b)),
  }
}

const ability = (name: string, winrateHigh: number | null, heldBy: number | null = null): ComboItem => ({
  name,
  kind: 'ability',
  winrateHigh,
  heldBy,
})
const model = (name: string, winrateHigh: number | null, heldBy: number | null = null): ComboItem => ({
  name,
  kind: 'model',
  winrateHigh,
  heldBy,
})

describe('rankTopCombos', () => {
  it('computes the real combo win rate by inverting the stored synergy lift', () => {
    const items = [ability('a', 0.5), ability('b', 0.6)]
    const synergy = synergyOf({ 'a|b': 10 }) // 10 percentage points of lift
    const [top] = rankTopCombos(items, synergy, 5)
    // increase/100 + avg(0.5, 0.6) = 0.10 + 0.55 = 0.65
    expect(top.comboWinrate).toBeCloseTo(0.65, 10)
  })

  it('ranks by combo win rate, best first, respecting the limit', () => {
    const items = [ability('a', 0.5), ability('b', 0.5), ability('c', 0.5), ability('d', 0.5)]
    const synergy = synergyOf({ 'a|b': 1, 'a|c': 20, 'a|d': 10 })
    const ranked = rankTopCombos(items, synergy, 2)
    expect(ranked.map((r) => [r.a.name, r.b.name])).toEqual([
      ['a', 'c'],
      ['a', 'd'],
    ])
  })

  it('excludes pairs with no recorded synergy data', () => {
    const items = [ability('a', 0.5), ability('b', 0.5)]
    const ranked = rankTopCombos(items, synergyOf({}), 5)
    expect(ranked).toEqual([])
  })

  it('excludes a pair where either side has no win rate on file', () => {
    const items = [ability('a', null), ability('b', 0.5), ability('c', 0.5)]
    const synergy = synergyOf({ 'a|b': 10, 'b|c': 10 })
    const ranked = rankTopCombos(items, synergy, 5)
    expect(ranked.map((r) => [r.a.name, r.b.name])).toEqual([['b', 'c']])
  })

  it('never pairs two hero models together', () => {
    const items = [model('x', 0.5), model('y', 0.5)]
    const ranked = rankTopCombos(items, synergyOf({ 'x|y': 10 }), 5)
    expect(ranked).toEqual([])
  })

  it('allows a model paired with an ability', () => {
    const items = [model('x', 0.5), ability('x_a', 0.5)]
    const ranked = rankTopCombos(items, synergyOf({ 'x|x_a': 10 }), 5)
    expect(ranked).toHaveLength(1)
  })
})

describe('combos with one half already drafted', () => {
  const synergy = synergyOf({ 'a|b': 10, 'a|c': 5, 'b|c': 8 })

  it('lists a pair whose other half is still in the pool, with who holds the drafted one', () => {
    const items = [ability('a', 0.5, 3), ability('b', 0.5)]
    const [top] = rankTopCombos(items, synergy, 5)
    expect(top.a.heldBy).toBe(3)
    expect(top.b.heldBy).toBeNull()
    expect(top.comboWinrate).toBeCloseTo(0.6, 10) // 0.10 + avg(0.5, 0.5)
  })

  it('finds the drafted half whichever side of the pair it sits on', () => {
    const items = [ability('b', 0.5), ability('a', 0.5, 7)]
    const ranked = rankTopCombos(items, synergy, 5)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].b.heldBy).toBe(7)
  })

  it('drops a pair once BOTH halves are drafted — the combo is over, or split across players', () => {
    const items = [ability('a', 0.5, 1), ability('b', 0.5, 6)]
    expect(rankTopCombos(items, synergy, 5)).toEqual([])
    const sameHolder = [ability('a', 0.5, 2), ability('b', 0.5, 2)]
    expect(rankTopCombos(sameHolder, synergy, 5)).toEqual([])
  })

  it('drops a pair when the player holding one half has no room to take the other', () => {
    const items = [ability('a', 0.5, 4), ability('b', 0.5), ability('c', 0.5)]
    // player 4 is full for 'b' but can still take 'c'
    const canComplete = (_seat: number, item: ComboItem): boolean => item.name !== 'b'
    const ranked = rankTopCombos(items, synergy, 5, canComplete)
    const pairs = ranked.map((r) => [r.a.name, r.b.name].sort().join('+'))
    expect(pairs).not.toContain('a+b')
    expect(pairs).toContain('a+c')
    expect(pairs).toContain('b+c') // both still in the pool: unaffected
  })

  it('asks canComplete about the right player and the pool half', () => {
    const calls: [number, string][] = []
    rankTopCombos([ability('a', 0.5, 9), ability('b', 0.5)], synergy, 5, (seat, item) => {
      calls.push([seat, item.name])
      return true
    })
    expect(calls).toEqual([[9, 'b']])
  })

  it('ranks drafted-half combos alongside pool-only ones by win rate', () => {
    const items = [ability('a', 0.5, 0), ability('b', 0.5), ability('c', 0.5)]
    const ranked = rankTopCombos(items, synergy, 5)
    const rates = ranked.map((r) => r.comboWinrate)
    expect(rates).toEqual([...rates].sort((x, y) => y - x))
    expect(ranked).toHaveLength(3)
  })
})
