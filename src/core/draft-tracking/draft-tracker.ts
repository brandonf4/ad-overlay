import { createPoolTracker, poolSlotKey, type PoolEvent } from './pool-tracker'
import { createSeatPickTracker, type SeatSlotRead } from './seat-pick-tracker'
import { createModelPickTracker, type ModelTileCapture } from './model-pick-tracker'
import { PICK_ORDER, SEAT_COUNT } from '@core/scoring/pick-score'

// @DEV-GUIDE: Reconstructs the live draft from repeated scans, in the shape the
// scoring needs (see core/scoring/pick-score.ts): what each of the 10 seats holds, what
// is still in the pool, and how many picks have been made. Three signals feed it:
// - the pool grid (pool-tracker.ts): which pool abilities have been drafted (an ability
//   held in a player's row is drafted too, whatever its pool box looks like)
// - the 10 player rows (seat-pick-tracker.ts): which seat holds which ability
// - the 12 model tiles (model-pick-tracker.ts): which pool hero MODELS were drafted —
//   their tiles change when picked, and the hero behind a tile is known from its
//   defining ability (same lookup as hero identification), so no model recognition.
// The board never shows which seat took a model, but the snake pick order does: after
// K total picks seat s has made n_s of them, so if it holds only a_s abilities it must
// hold a model iff n_s - a_s = 1. Picked models are handed to such seats when the match
// is unambiguous (same number of unassigned models as seats missing one).
// Pure logic, no Electron imports.

export interface PoolSlotInput {
  hero_order: number
  ability_order: number
  is_ultimate: boolean
  name: string | null
  /** Luma thumbnail of the box — see ScanResult.thumb. */
  thumb?: Uint8Array
}

export interface DraftUpdate {
  pool: readonly PoolSlotInput[]
  seatSlots: readonly SeatSlotRead[]
  modelTiles: readonly ModelTileCapture[] | null
}

export interface HeldEntry {
  name: string
  kind: 'ability' | 'model'
  isUlt: boolean
}

export interface DraftSnapshot {
  /** Total picks made so far across both teams (0-50). */
  pickIndex: number
  /** Every pool ability whose identity is known, with whether it has been drafted. */
  poolAbilities: { name: string; isUltimate: boolean; picked: boolean }[]
  /** Pool hero models whose hero is known, with whether they have been drafted. */
  models: { heroOrder: number; heroName: string; picked: boolean }[]
  /** Items each seat (0-9) holds, in the order they were picked. */
  seats: HeldEntry[][]
}

export interface DraftTracker {
  update(update: DraftUpdate): DraftSnapshot
  /** Names a pick box can hold, for scoping the next rows scan (empty = unrestricted). */
  pickCandidates(): { standard: string[]; ultimates: string[] }
  /** Notable pool changes (drafted / restored / screen-wide dim ignored) since last call. */
  drainPoolEvents(): PoolEvent[]
  reset(): void
}

const MAX_PICKS = PICK_ORDER.length
const DEFINING_ABILITY_ORDER = 2

function picksMadeBySeat(seat: number, totalPicks: number): number {
  let n = 0
  for (let i = 0; i < totalPicks && i < MAX_PICKS; i++) if (PICK_ORDER[i] === seat) n++
  return n
}

function firstPickIndex(seat: number): number {
  return PICK_ORDER.indexOf(seat)
}

export function createDraftTracker(
  heroOfAbility: (abilityName: string) => string | null,
): DraftTracker {
  const poolTracker = createPoolTracker()
  const seatTracker = createSeatPickTracker()

  const modelTracker = createModelPickTracker()
  let modelHeroOrders: number[] = [] // the tile positions, fixed by the first capture
  let modelPicked: number[] = []
  const modelOwner = new Map<number, number>() // pool hero order -> seat
  const seatModel = new Map<number, number>() // seat -> pool hero order
  let seatEntries: HeldEntry[][] = Array.from({ length: SEAT_COUNT }, () => [])
  let lastPool: readonly PoolSlotInput[] = []
  let lastTrackedNames = new Map<string, string | null>()

  function reset(): void {
    poolTracker.reset()
    seatTracker.reset()
    modelTracker.reset()
    modelHeroOrders = []
    modelPicked = []
    modelOwner.clear()
    seatModel.clear()
    seatEntries = Array.from({ length: SEAT_COUNT }, () => [])
    lastPool = []
    lastTrackedNames = new Map()
  }

  function modelHeroName(heroOrder: number, trackedNames: Map<string, string | null>): string | null {
    const group = lastPool.filter((s) => s.hero_order === heroOrder)
    const nameOf = (slot: PoolSlotInput): string | null => trackedNames.get(poolSlotKey(slot)) ?? null

    const defining = group.find((s) => s.ability_order === DEFINING_ABILITY_ORDER && !s.is_ultimate)
    const definingName = defining ? nameOf(defining) : null
    if (definingName) return heroOfAbility(definingName)

    // The defining ability's box didn't read: fall back to the hero that owns most of the
    // rest of this group. Needs two agreeing abilities, since a group can contain
    // backfilled abilities from other heroes.
    const votes = new Map<string, number>()
    for (const slot of group) {
      const name = nameOf(slot)
      const hero = name ? heroOfAbility(name) : null
      if (hero) votes.set(hero, (votes.get(hero) ?? 0) + 1)
    }
    const ranked = [...votes].sort((a, b) => b[1] - a[1])
    return ranked.length > 0 && ranked[0][1] >= 2 && ranked[0][1] > (ranked[1]?.[1] ?? 0)
      ? ranked[0][0]
      : null
  }

  return {
    reset,
    update(update) {
      lastPool = update.pool
      const tracked = poolTracker.update(
        update.pool.map((s) => ({ key: poolSlotKey(s), name: s.name, thumb: s.thumb })),
      )
      lastTrackedNames = new Map([...tracked].map(([k, v]) => [k, v.name]))

      seatTracker.update(update.seatSlots)
      for (let seat = 0; seat < SEAT_COUNT; seat++) {
        const adopted = seatTracker.held(seat)
        const have = seatEntries[seat].filter((e) => e.kind === 'ability').length
        for (const held of adopted.slice(have)) {
          seatEntries[seat].push({ name: held.name, kind: 'ability', isUlt: held.slot === 3 })
        }
      }

      if (update.modelTiles && update.modelTiles.length > 0) {
        if (modelHeroOrders.length === 0) modelHeroOrders = update.modelTiles.map((t) => t.heroOrder)
        const result = modelTracker.update(update.modelTiles)
        modelPicked = result.picked
        // A pick that turned out to be a tooltip over the tile: give the model (and the
        // seat it had been handed to) back.
        for (const heroOrder of result.revived) {
          const seat = modelOwner.get(heroOrder)
          if (seat === undefined) continue
          modelOwner.delete(heroOrder)
          seatModel.delete(seat)
          seatEntries[seat] = seatEntries[seat].filter((e) => e.kind !== 'model')
        }
      }

      const heldNames = new Set(seatEntries.flatMap((entries) => entries.map((e) => e.name)))
      const poolAbilities: DraftSnapshot['poolAbilities'] = []
      let poolPicked = 0
      for (const slot of update.pool) {
        const t = tracked.get(poolSlotKey(slot))
        if (!t || t.name === null) continue
        const picked = t.picked || heldNames.has(t.name)
        if (picked) poolPicked++
        poolAbilities.push({ name: t.name, isUltimate: slot.is_ultimate, picked })
      }

      const heldAbilities = seatEntries.reduce(
        (n, entries) => n + entries.filter((e) => e.kind === 'ability').length,
        0,
      )
      const pickIndex = Math.min(MAX_PICKS, Math.max(heldAbilities, poolPicked) + modelPicked.length)

      // Hand newly picked models to the seats that must hold one.
      const unassigned = modelPicked.filter((h) => !modelOwner.has(h))
      if (unassigned.length > 0) {
        const needing: number[] = []
        for (let seat = 0; seat < SEAT_COUNT; seat++) {
          const abilities = seatEntries[seat].filter((e) => e.kind === 'ability').length
          const owned = seatModel.has(seat) ? 1 : 0
          if (picksMadeBySeat(seat, pickIndex) - abilities - owned === 1) needing.push(seat)
        }
        if (needing.length === unassigned.length) {
          needing.sort((a, b) => firstPickIndex(a) - firstPickIndex(b))
          needing.forEach((seat, i) => {
            const heroOrder = unassigned[i]
            modelOwner.set(heroOrder, seat)
            seatModel.set(seat, heroOrder)
            const name = modelHeroName(heroOrder, lastTrackedNames) ?? `model_${heroOrder}`
            seatEntries[seat].push({ name, kind: 'model', isUlt: false })
          })
        }
      }

      const models: DraftSnapshot['models'] = []
      for (const heroOrder of modelHeroOrders) {
        const heroName = modelHeroName(heroOrder, lastTrackedNames)
        if (heroName === null) continue
        models.push({ heroOrder, heroName, picked: modelPicked.includes(heroOrder) })
      }

      return {
        pickIndex,
        poolAbilities,
        models,
        seats: seatEntries.map((entries) => entries.map((e) => ({ ...e }))),
      }
    },
    pickCandidates() {
      const standard: string[] = []
      const ultimates: string[] = []
      let standardUnknown = false
      let ultimatesUnknown = false
      for (const slot of lastPool) {
        const name = lastTrackedNames.get(poolSlotKey(slot)) ?? null
        if (name === null) {
          if (slot.is_ultimate) ultimatesUnknown = true
          else standardUnknown = true
        } else if (slot.is_ultimate) ultimates.push(name)
        else standard.push(name)
      }
      // A pool slot that never read leaves a name unaccounted for: leave that box
      // type unrestricted rather than make the missing ability unmatchable.
      return {
        standard: standardUnknown ? [] : standard,
        ultimates: ultimatesUnknown ? [] : ultimates,
      }
    },
    drainPoolEvents: () => poolTracker.drainEvents(),
  }
}
