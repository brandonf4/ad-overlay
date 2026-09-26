import { thumbNcc, thumbStats } from './box-appearance'

// @DEV-GUIDE: Tracks which pool abilities have been drafted during a live draft, from
// repeated scans of the pool grid. A slot's identity is fixed from its baseline read and
// later reads are only compared against it.
//
// What a drafted ability leaves behind (measured on saved crops from live drafts): its
// pool box stays in the grid as a DIMMED copy of its own icon, ~20-40% of normal
// brightness. It is NOT blank (blank/black frames come only from whole-screen
// transitions), and whether the scanner still recognises the dimmed icon varies by
// ability — so the read's NAME can't tell "still there" from "drafted". Brightness
// relative to the same box's own earlier look can:
// - dim = much darker than the box looked while available (<= DIM_RATIO of it) AND still
//   the same picture: the scanner names it as the baseline ability, or (when it can't)
//   the thumbnail still correlates with the box's earlier look (thumbNcc >= DIM_MIN_NCC)
// - a slot is marked picked after PICKED_AFTER_DIMS consecutive dim reads
// - unreadable-but-not-dim reads are ignored: a tooltip over the box (different content),
//   a black screen (no structure), the gold hover highlight (brighter) all say nothing
// - many boxes turning dim in the same scan is a screen-wide effect (a dialog dimming
//   the grid), not picks — real picks are one or two at a time — so it is ignored
// - picked can be undone: the baseline ability reading at normal brightness again for
//   REVIVE_AFTER_AVAILABLE scans means it never left
// (Independently, an ability held in a player's row is drafted — draft-tracker.ts
// combines both signals.) Pure logic, no Electron imports.

export interface PoolSlotRead {
  key: string
  name: string | null
  /** Luma thumbnail of the box (see box-appearance.ts); absent = no appearance info. */
  thumb?: Uint8Array
}

export interface TrackedPoolSlot {
  key: string
  /** The ability this slot held at baseline (kept even after it is picked). */
  name: string | null
  picked: boolean
}

export interface PoolEvent {
  kind: 'drafted' | 'restored' | 'burst-ignored'
  key?: string
  name?: string | null
  mean?: number
  refMean?: number
  ncc?: number
  count?: number
}

export interface PoolTracker {
  update(reads: readonly PoolSlotRead[]): Map<string, TrackedPoolSlot>
  /** Notable state changes since the last call, for diagnostics logging. */
  drainEvents(): PoolEvent[]
  reset(): void
}

export const DIM_RATIO = 0.55
export const AVAILABLE_RATIO = 0.75
export const DIM_MIN_NCC = 0.6
/** A box this dark (or flat) has no picture to judge dimming by. */
export const MIN_REF_MEAN = 15
export const MIN_STRUCTURE_STD = 3
export const PICKED_AFTER_DIMS = 2
export const REVIVE_AFTER_AVAILABLE = 2
/** More than this many still-available boxes going dim in one scan is not a pick. */
export const DIM_BURST_LIMIT = 4
export const ADOPT_AFTER_READS = 2
const REF_HISTORY = 5

interface SlotState {
  name: string | null
  picked: boolean
  dims: number
  availables: number
  refMeans: number[]
  refThumb: Uint8Array | null
  candidate: string | null
  candidateReads: number
}

type Look = 'available' | 'dim' | 'unknown'

export function poolSlotKey(slot: {
  hero_order: number
  ability_order: number
  is_ultimate: boolean
}): string {
  return `${slot.hero_order}-${slot.ability_order}-${slot.is_ultimate}`
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function createPoolTracker(): PoolTracker {
  const states = new Map<string, SlotState>()
  let events: PoolEvent[] = []

  function newState(name: string | null): SlotState {
    return {
      name,
      picked: false,
      dims: 0,
      availables: 0,
      refMeans: [],
      refThumb: null,
      candidate: null,
      candidateReads: 0,
    }
  }

  function seedReference(state: SlotState, thumb: Uint8Array | undefined): void {
    if (!thumb) return
    state.refMeans = [thumbStats(thumb).mean]
    state.refThumb = thumb
  }

  function claimedNames(): Set<string> {
    const claimed = new Set<string>()
    for (const state of states.values()) {
      if (state.name) claimed.add(state.name)
    }
    return claimed
  }

  function judge(state: SlotState, read: PoolSlotRead): { look: Look; mean?: number; refMean?: number; ncc?: number } {
    const isBaseline = read.name === state.name
    if (!read.thumb) return { look: isBaseline ? 'available' : 'unknown' }

    const { mean, std } = thumbStats(read.thumb)
    if (state.refMeans.length === 0) {
      // nothing to compare against yet: a confident read of the ability seeds the reference
      return { look: isBaseline ? 'available' : 'unknown', mean }
    }
    const refMean = median(state.refMeans)
    if (isBaseline && mean >= AVAILABLE_RATIO * refMean) return { look: 'available', mean, refMean }
    if (refMean < MIN_REF_MEAN || std < MIN_STRUCTURE_STD || mean > DIM_RATIO * refMean) {
      return { look: 'unknown', mean, refMean }
    }
    if (isBaseline) return { look: 'dim', mean, refMean }
    // The scanner can't name it: only call it dim if it is still the same picture.
    const ncc = state.refThumb ? thumbNcc(read.thumb, state.refThumb) : 0
    return ncc >= DIM_MIN_NCC ? { look: 'dim', mean, refMean, ncc } : { look: 'unknown', mean, refMean, ncc }
  }

  return {
    update(reads) {
      const claimed = claimedNames()
      const result = new Map<string, TrackedPoolSlot>()

      // Pass 1: judge every slot with a baseline, so a screen-wide dim can be told from picks.
      const looks = new Map<string, ReturnType<typeof judge>>()
      let newlyDim = 0
      for (const read of reads) {
        const state = states.get(read.key)
        if (!state || state.name === null) continue
        const verdict = judge(state, read)
        looks.set(read.key, verdict)
        if (verdict.look === 'dim' && !state.picked) newlyDim++
      }
      const burst = newlyDim > DIM_BURST_LIMIT
      if (burst) events.push({ kind: 'burst-ignored', count: newlyDim })

      // Pass 2: apply.
      for (const read of reads) {
        let state = states.get(read.key)
        if (!state) {
          state = newState(read.name)
          states.set(read.key, state)
          if (read.name) {
            claimed.add(read.name)
            seedReference(state, read.thumb)
          }
        } else if (state.name !== null) {
          const verdict = looks.get(read.key)!
          if (verdict.look === 'available') {
            state.dims = 0
            state.availables += 1
            if (verdict.mean !== undefined) {
              state.refMeans.push(verdict.mean)
              if (state.refMeans.length > REF_HISTORY) state.refMeans.shift()
              state.refThumb = read.thumb ?? state.refThumb
            }
            if (state.picked && state.availables >= REVIVE_AFTER_AVAILABLE) {
              state.picked = false
              events.push({ kind: 'restored', key: read.key, name: state.name, mean: verdict.mean, refMean: verdict.refMean })
            }
          } else if (verdict.look === 'dim') {
            state.availables = 0
            if (!state.picked && !burst) {
              state.dims += 1
              if (state.dims >= PICKED_AFTER_DIMS) {
                state.picked = true
                events.push({
                  kind: 'drafted',
                  key: read.key,
                  name: state.name,
                  mean: verdict.mean,
                  refMean: verdict.refMean,
                  ncc: verdict.ncc,
                })
              }
            }
          }
        } else if (read.name !== null && !claimed.has(read.name)) {
          state.candidateReads = state.candidate === read.name ? state.candidateReads + 1 : 1
          state.candidate = read.name
          if (state.candidateReads >= ADOPT_AFTER_READS) {
            state.name = read.name
            state.candidate = null
            state.candidateReads = 0
            claimed.add(read.name)
            seedReference(state, read.thumb)
          }
        } else {
          state.candidate = null
          state.candidateReads = 0
        }

        result.set(read.key, { key: read.key, name: state.name, picked: state.picked })
      }

      return result
    },
    drainEvents() {
      const out = events
      events = []
      return out
    },
    reset() {
      states.clear()
      events = []
    },
  }
}
