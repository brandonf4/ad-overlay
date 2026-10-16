// @DEV-GUIDE: Draft-order helpers and the per-seat ranking the overlay shows. The
// scoring itself is bot-engine.ts, a port of ad-simulator's botDecision (testing
// branch, public/simulator.html), checked against the simulator's own numbers by
// tests/unit/core/scoring/bot-engine.test.ts.
//
// The simulator scores the seat whose turn it is, at the current pick number. Here the
// same state (everyone's held picks, what's still in the pool, the pick number) is
// scored for ANY seat, i.e. "the ranking if this seat picked right now".
// Pure logic, no Electron imports.

import type { DraftScorer } from './bot-engine'
import { categoryOf, shown } from './bot-engine'

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
  /** Raw windrun average pick position (models too, as the simulator uses it). */
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

export interface RankedPick {
  item: ScoreItem
  /** The simulator's shown score: higher = better. */
  score: number
}

/**
 * Best options for a seat, in the order the simulator's bot would take them: its
 * pick first, categories the bot defers (nothing an enemy can take before this seat
 * picks again) after the rest. Items with no pick-position data are dropped.
 */
export function rankPicksForSeat(seat: number, scorer: DraftScorer, limit: number): RankedPick[] {
  const d = scorer.decide(seat)
  const deferred = (item: ScoreItem): number => (d.deferredCats.includes(categoryOf(item)) ? 1 : 0)
  return d.rows
    .filter((r) => Number.isFinite(r.total))
    .sort((a, b) => deferred(a.item) - deferred(b.item) || a.total - b.total)
    .slice(0, limit)
    .map((r) => ({ item: r.item, score: shown(r.total) }))
}
