import type { SynergyLookup } from './pick-score'

// @DEV-GUIDE: Ranks pairs of still-available pool items (abilities and hero models
// together) by their COMBO win rate — the actual win rate two items produce together
// when held by one hero, not the synergy "lift" pickScore uses internally.
//
// ad-simulator's synergy data (ability_synergies.json) stores that lift in percentage
// points: synergyIncrease = comboWinrate - average(soloWinrateA, soloWinrateB) (see the
// commit that generated it, sourced from Windrun's own pair-winrate stat). Inverting it
// — comboWinrate = synergyIncrease/100 + average(soloA, soloB) — recovers the real combo
// win rate exactly, using data already loaded for scoring (no new data source).
// Pure logic, no Electron imports.

export interface ComboItem {
  name: string
  kind: 'ability' | 'model'
  /** Solo win rate [0, 1]; a pair needs both sides to have one. */
  winrateHigh: number | null
}

export interface RankedCombo {
  a: ComboItem
  b: ComboItem
  /** Estimated win rate [0, 1] of holding both together. */
  comboWinrate: number
}

/**
 * Top pairs among `available` by combo win rate. Only pairs with recorded synergy data
 * and a known solo win rate on both sides are considered — no data, no guess. Two hero
 * models are never paired (only one model fits on a loadout).
 */
export function rankTopCombos(
  available: readonly ComboItem[],
  synergy: SynergyLookup,
  limit: number,
): RankedCombo[] {
  const ranked: RankedCombo[] = []
  for (let i = 0; i < available.length; i++) {
    const a = available[i]
    if (a.winrateHigh === null) continue
    for (let j = i + 1; j < available.length; j++) {
      const b = available[j]
      if (a.kind === 'model' && b.kind === 'model') continue
      if (b.winrateHigh === null) continue
      if (!synergy.has(a.name, b.name)) continue
      const increase = synergy.between(a.name, b.name)
      const comboWinrate = increase / 100 + (a.winrateHigh + b.winrateHigh) / 2
      ranked.push({ a, b, comboWinrate })
    }
  }
  return ranked.sort((x, y) => y.comboWinrate - x.comboWinrate).slice(0, limit)
}
