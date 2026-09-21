// @DEV-GUIDE: Port of the pick-scoring algorithm from ad-simulator's testing-branch
// public/simulator.html (pickScore and the terms it sums: synergy with the seat's own
// picks, pool synergy, enemy denial, ally avoidance). LOWER score = better pick.
// Kept as a line-for-line port so the two stay comparable — tests/unit/core/scoring
// checks it against golden values produced by the simulator's own code. If the
// simulator's tuning constants change, update them here too.
//
// The simulator scores the seat whose turn it is, at the current pick number. Here the
// same state (everyone's held picks, what's still in the pool, the pick number) is
// scored for ANY seat, i.e. "the ranking if this seat picked right now".
// Pure logic, no Electron imports.

// Snake draft over seats 0-9 (0-4 one team, 5-9 the other): five rounds — the model
// round plus the four ability rounds — as one continuous snake.
const FORWARD = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9]
const BACKWARD = [...FORWARD].reverse()
export const PICK_ORDER: readonly number[] = [
  ...FORWARD,
  ...BACKWARD,
  ...FORWARD,
  ...BACKWARD,
  ...FORWARD,
]
export const SEAT_COUNT = 10

export interface ScoreItem {
  name: string
  kind: 'ability' | 'model'
  isUlt: boolean
  winrateHigh: number | null
  /** Models: already run through transformModelPickPosition. */
  pickPositionHigh: number | null
}

export interface SynergyLookup {
  between(nameA: string, nameB: string): number
  has(nameA: string, nameB: string): boolean
}

export interface ScoreState {
  /** Everything still unpicked in the pool (models and abilities). */
  available: readonly ScoreItem[]
  /** Items each seat (0-9) holds, in the order they were picked. */
  picks: readonly (readonly ScoreItem[])[]
  /** Number of picks made so far in the draft, across both teams. */
  pickIndex: number
}

const SYNERGY_MULTIPLIER_BASE = 1.2
const SYNERGY_MULTIPLIER_INCREMENT = 0.08
const KNOWN_COMBO_BONUS_COEFFICIENT = 0.008
const SYNERGY_ORDER_WEIGHTS = [1.4, 1, 0.8, 0.6]
const POOL_SYNERGY_WEIGHTS_BY_PICKS_MADE = [0.5, 0.15, 0.1, 0.1, 0]

/** Models already at 5 or below are untouched; above 5 follows x^2/25, floored at 5. */
export function transformModelPickPosition(x: number | null): number | null {
  if (x == null) return null
  if (x <= 5) return x
  return Math.max((x * x) / 25, 5)
}

export function enemiesOf(seat: number): number[] {
  return seat < 5 ? [5, 6, 7, 8, 9] : [0, 1, 2, 3, 4]
}

export function alliesOf(seat: number): number[] {
  return (seat < 5 ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9]).filter((p) => p !== seat)
}

/** A seat's final loadout is exactly 1 model + 3 basics + 1 ultimate. */
export function pickBlockedFor(
  picks: readonly (readonly ScoreItem[])[],
  seat: number,
  item: ScoreItem,
): boolean {
  const held = picks[seat]
  if (item.kind === 'model') return held.some((x) => x.kind === 'model')
  const abilities = held.filter((x) => x.kind === 'ability')
  if (item.isUlt) return abilities.some((a) => a.isUlt)
  return abilities.filter((a) => !a.isUlt).length >= 3
}

/** The next index in PICK_ORDER after afterIndex where seat picks again, or null. */
export function nextPickIndexFor(seat: number, afterIndex: number): number | null {
  for (let i = afterIndex + 1; i < PICK_ORDER.length; i++) {
    if (PICK_ORDER[i] === seat) return i
  }
  return null
}

// Negative and neutral pairs are excluded entirely — only good pairings count.
function sumPositiveSynergy(
  itemName: string,
  others: readonly ScoreItem[],
  synergy: SynergyLookup,
): number {
  return others.reduce((sum, o) => {
    const s = synergy.between(itemName, o.name)
    return s > 0 ? sum + s : sum
  }, 0)
}

function poolSynergyTerm(
  item: ScoreItem,
  seat: number,
  state: ScoreState,
  synergy: SynergyLookup,
): number {
  const weight = POOL_SYNERGY_WEIGHTS_BY_PICKS_MADE[state.picks[seat].length] ?? 0
  const others = state.available.filter((o) => o !== item)
  return sumPositiveSynergy(item.name, others, synergy) * weight
}

function enemySynergyTerm(
  item: ScoreItem,
  seat: number,
  state: ScoreState,
  synergy: SynergyLookup,
): number {
  let total = 0
  for (const enemy of enemiesOf(seat)) {
    if (pickBlockedFor(state.picks, enemy, item)) continue
    const nextIdx = nextPickIndexFor(enemy, state.pickIndex)
    if (nextIdx == null) continue
    const picksBetween = nextIdx - state.pickIndex - 1
    const weight = 10 / (4 + picksBetween)
    total += weight * sumPositiveSynergy(item.name, state.picks[enemy], synergy)
  }
  return total
}

function allySynergyTerm(
  item: ScoreItem,
  seat: number,
  state: ScoreState,
  synergy: SynergyLookup,
): number {
  let total = 0
  for (const ally of alliesOf(seat)) {
    if (pickBlockedFor(state.picks, ally, item)) continue
    total += sumPositiveSynergy(item.name, state.picks[ally], synergy)
  }
  return total * 2
}

export function pickScore(
  item: ScoreItem,
  seat: number,
  state: ScoreState,
  synergy: SynergyLookup,
): number {
  const base =
    item.pickPositionHigh == null
      ? Infinity
      : item.pickPositionHigh - (item.winrateHigh ?? 0) * 100 + 60
  const multiplier = SYNERGY_MULTIPLIER_BASE + state.pickIndex * SYNERGY_MULTIPLIER_INCREMENT
  const bonus = state.pickIndex * state.pickIndex * KNOWN_COMBO_BONUS_COEFFICIENT
  let adjustment = 0
  state.picks[seat].forEach((held, i) => {
    const orderWeight = SYNERGY_ORDER_WEIGHTS[i] ?? 0
    adjustment += synergy.between(item.name, held.name) * multiplier * orderWeight
    if (synergy.has(item.name, held.name)) adjustment += bonus * orderWeight
  })
  adjustment += poolSynergyTerm(item, seat, state, synergy)
  adjustment += enemySynergyTerm(item, seat, state, synergy)
  adjustment -= allySynergyTerm(item, seat, state, synergy)
  return base - adjustment
}

export interface RankedPick {
  item: ScoreItem
  score: number
}

/**
 * Best (lowest-scoring) options for a seat: everything still available that the seat
 * can legally take, scored. Items with no pick-position data score Infinity and are
 * dropped rather than shown.
 */
export function rankPicksForSeat(
  seat: number,
  state: ScoreState,
  synergy: SynergyLookup,
  limit: number,
  kind: ScoreItem['kind'] | null = null,
): RankedPick[] {
  return state.available
    .filter((item) => (kind === null || item.kind === kind) && !pickBlockedFor(state.picks, seat, item))
    .map((item) => ({ item, score: pickScore(item, seat, state, synergy) }))
    .filter((r) => Number.isFinite(r.score))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
}
