import type { SynergyLookup } from './pick-score'

// @DEV-GUIDE: Ranks pairs of pool items (abilities and hero models together) by their
// COMBO win rate — the actual win rate two items produce together when held by one hero,
// not the synergy "lift" pickScore uses internally.
//
// ad-simulator's synergy data (ability_synergies.json) stores that lift in percentage
// points: synergyIncrease = comboWinrate - average(soloWinrateA, soloWinrateB) (see the
// commit that generated it, sourced from Windrun's own pair-winrate stat). Inverting it
// — comboWinrate = synergyIncrease/100 + average(soloA, soloB) — recovers the real combo
// win rate exactly, using data already loaded for scoring (no new data source).
//
// Which pairs are "available": both halves still in the pool, OR one half already drafted
// by a player who could still take the other (a combo in progress). A pair with both halves
// drafted is over, and a drafted half whose holder has no room left for the other half
// (e.g. both are ultimates) can't be completed by anyone, so neither is listed.
// Pure logic, no Electron imports.

export interface ComboItem {
  name: string
  kind: 'ability' | 'model'
  /** Solo win rate [0, 1]; a pair needs both sides to have one. */
  winrateHigh: number | null
  /** The seat (0-9) that has drafted this item, or null while it is still in the pool. */
  heldBy: number | null
}

export interface RankedCombo {
  a: ComboItem
  b: ComboItem
  /** Estimated win rate [0, 1] of holding both together. */
  comboWinrate: number
}

/**
 * Top pairs among `items` by combo win rate. Only pairs with recorded synergy data and a
 * known solo win rate on both sides are considered — no data, no guess. Two hero models
 * are never paired (only one model fits on a loadout).
 *
 * `canComplete(seat, item)` says whether `seat` could still take `item` (the pool half of
 * a pair whose other half `seat` already holds).
 */
export function rankTopCombos(
  items: readonly ComboItem[],
  synergy: SynergyLookup,
  limit: number,
  canComplete: (seat: number, item: ComboItem) => boolean = () => true,
): RankedCombo[] {
  const ranked: RankedCombo[] = []
  for (let i = 0; i < items.length; i++) {
    const a = items[i]
    if (a.winrateHigh === null) continue
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]
      if (b.winrateHigh === null) continue
      if (a.kind === 'model' && b.kind === 'model') continue
      if (a.heldBy !== null && b.heldBy !== null) continue
      if (a.heldBy !== null && !canComplete(a.heldBy, b)) continue
      if (b.heldBy !== null && !canComplete(b.heldBy, a)) continue
      if (!synergy.has(a.name, b.name)) continue
      const increase = synergy.between(a.name, b.name)
      const comboWinrate = increase / 100 + (a.winrateHigh + b.winrateHigh) / 2
      ranked.push({ a, b, comboWinrate })
    }
  }
  return ranked.sort((x, y) => y.comboWinrate - x.comboWinrate).slice(0, limit)
}
