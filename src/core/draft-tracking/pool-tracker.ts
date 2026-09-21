// @DEV-GUIDE: Tracks which pool abilities have been picked during a live draft, from
// repeated scans of the (static) pool grid. A picked ability's pool box goes empty, and
// the classifier can misread an empty box — so a slot's identity is fixed from its
// baseline read and later reads are only ever compared against it:
// - a slot is marked picked after PICKED_AFTER_MISSES consecutive reads that differ from
//   its baseline (a lone bad frame — tooltip, animation — must not drop a live ability)
// - picked is sticky: a drafted ability never returns to the pool
// - a slot whose baseline read was Unknown adopts a name only after ADOPT_AFTER_READS
//   identical consecutive reads, and never one already claimed by another slot
// Pure logic, no Electron imports.

export interface PoolSlotRead {
  key: string
  name: string | null
}

export interface TrackedPoolSlot {
  key: string
  /** The ability this slot held at baseline (kept even after it is picked). */
  name: string | null
  picked: boolean
}

export interface PoolTracker {
  update(reads: readonly PoolSlotRead[]): Map<string, TrackedPoolSlot>
  reset(): void
}

export const PICKED_AFTER_MISSES = 2
export const ADOPT_AFTER_READS = 2

interface SlotState {
  name: string | null
  picked: boolean
  misses: number
  candidate: string | null
  candidateReads: number
}

export function poolSlotKey(slot: {
  hero_order: number
  ability_order: number
  is_ultimate: boolean
}): string {
  return `${slot.hero_order}-${slot.ability_order}-${slot.is_ultimate}`
}

export function createPoolTracker(): PoolTracker {
  const states = new Map<string, SlotState>()

  function claimedNames(): Set<string> {
    const claimed = new Set<string>()
    for (const state of states.values()) {
      if (state.name) claimed.add(state.name)
    }
    return claimed
  }

  return {
    update(reads) {
      const claimed = claimedNames()
      const result = new Map<string, TrackedPoolSlot>()

      for (const read of reads) {
        let state = states.get(read.key)
        if (!state) {
          state = { name: read.name, picked: false, misses: 0, candidate: null, candidateReads: 0 }
          states.set(read.key, state)
          if (read.name) claimed.add(read.name)
        } else if (state.picked) {
          // sticky
        } else if (state.name !== null) {
          if (read.name === state.name) {
            state.misses = 0
          } else {
            state.misses += 1
            if (state.misses >= PICKED_AFTER_MISSES) state.picked = true
          }
        } else if (read.name !== null && !claimed.has(read.name)) {
          state.candidateReads = state.candidate === read.name ? state.candidateReads + 1 : 1
          state.candidate = read.name
          if (state.candidateReads >= ADOPT_AFTER_READS) {
            state.name = read.name
            state.candidate = null
            state.candidateReads = 0
            claimed.add(read.name)
          }
        } else {
          state.candidate = null
          state.candidateReads = 0
        }

        result.set(read.key, { key: read.key, name: state.name, picked: state.picked })
      }

      return result
    },
    reset() {
      states.clear()
    },
  }
}
