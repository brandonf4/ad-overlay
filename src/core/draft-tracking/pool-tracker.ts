// @DEV-GUIDE: Tracks which pool abilities have been drafted during a live draft, from
// repeated scans of the pool grid. A slot's identity is fixed from its baseline read and
// later reads are only compared against it.
//
// What counts as evidence that an ability is GONE is deliberately narrow. A drafted
// ability leaves a solid black (blank) box, but an ability that is still there can fail to
// read too: a hover tooltip lying over the box, the gold hover highlight, another screen.
// Real logs showed a tooltip covering a cluster of boxes making ~9 present abilities
// vanish at once, so "unreadable" is NOT evidence:
// - a slot is marked picked only after PICKED_AFTER_BLANKS reads of a BLANK box
//   (the scanner reports `blank`; see ScanResult) — unreadable-but-not-blank reads are
//   ignored, neither a match nor a miss
// - picked can be undone: if the baseline ability reads confidently again for
//   REVIVE_AFTER_MATCHES scans it never left (a drafted ability cannot return to the pool)
// - a slot whose baseline read was Unknown adopts a name only after ADOPT_AFTER_READS
//   identical consecutive reads, and never one already claimed by another slot
// (Independent of all this, an ability held in a player's row is drafted — see
// draft-tracker.ts, which combines both signals.)
// Pure logic, no Electron imports.

export interface PoolSlotRead {
  key: string
  name: string | null
  /** The box is a solid dark rectangle (drafted). Only meaningful when name is null. */
  blank?: boolean
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

export const PICKED_AFTER_BLANKS = 2
export const REVIVE_AFTER_MATCHES = 2
export const ADOPT_AFTER_READS = 2

interface SlotState {
  name: string | null
  picked: boolean
  blanks: number
  matches: number
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
          state = {
            name: read.name,
            picked: false,
            blanks: 0,
            matches: 0,
            candidate: null,
            candidateReads: 0,
          }
          states.set(read.key, state)
          if (read.name) claimed.add(read.name)
        } else if (state.name !== null) {
          if (read.name === state.name) {
            state.blanks = 0
            state.matches += 1
            if (state.picked && state.matches >= REVIVE_AFTER_MATCHES) state.picked = false
          } else {
            state.matches = 0
            if (read.blank && !state.picked) {
              state.blanks += 1
              if (state.blanks >= PICKED_AFTER_BLANKS) state.picked = true
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
