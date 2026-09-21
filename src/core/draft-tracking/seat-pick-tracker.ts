// @DEV-GUIDE: Tracks the abilities each seat (0-9) has drafted, from repeated scans of
// the 10 player rows (4 pick boxes each: 3 basics + 1 ultimate). A drafted ability
// never leaves its box, so a read is adopted once it repeats in two consecutive scans
// (a lone misread from a tooltip/animation is dropped) and is then final. An ability
// can only be drafted once, so a name already adopted elsewhere is never adopted again.
// Adoption order per seat is kept: the scoring weighs a seat's earlier picks more.
// Pure logic, no Electron imports.

export interface SeatSlotRead {
  seat: number
  /** 0-2 = basic boxes, 3 = ultimate box. */
  slot: number
  name: string | null
}

export interface HeldSlot {
  name: string
  slot: number
}

export interface SeatPickTracker {
  update(reads: readonly SeatSlotRead[]): void
  /** Adopted abilities per seat (with the pick box they were read from), in adoption order. */
  held(seat: number): readonly HeldSlot[]
  reset(): void
}

export const SEAT_ADOPT_AFTER_READS = 2

interface SlotState {
  name: string | null
  candidate: string | null
  candidateReads: number
}

export function createSeatPickTracker(): SeatPickTracker {
  const slots = new Map<string, SlotState>()
  const order = new Map<number, HeldSlot[]>()
  const adoptedNames = new Set<string>()

  return {
    update(reads) {
      for (const read of reads) {
        const key = `${read.seat}-${read.slot}`
        let state = slots.get(key)
        if (!state) {
          state = { name: null, candidate: null, candidateReads: 0 }
          slots.set(key, state)
        }
        if (state.name !== null) continue

        if (read.name === null || adoptedNames.has(read.name)) {
          state.candidate = null
          state.candidateReads = 0
          continue
        }
        state.candidateReads = state.candidate === read.name ? state.candidateReads + 1 : 1
        state.candidate = read.name
        if (state.candidateReads >= SEAT_ADOPT_AFTER_READS) {
          state.name = read.name
          state.candidate = null
          state.candidateReads = 0
          adoptedNames.add(read.name)
          const list = order.get(read.seat) ?? []
          list.push({ name: read.name, slot: read.slot })
          order.set(read.seat, list)
        }
      }
    },
    held: (seat) => order.get(seat) ?? [],
    reset() {
      slots.clear()
      order.clear()
      adoptedNames.clear()
    },
  }
}
