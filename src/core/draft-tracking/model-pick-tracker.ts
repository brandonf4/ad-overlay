import { MODEL_PICK_DIFF_THRESHOLD } from '@shared/constants/thresholds'

// @DEV-GUIDE: Picked-model detection by TILE DIFFING — zero image recognition. The 12 model
// portrait tiles on the AD draft stage are pixel-static while unpicked (measured mean abs
// diff 0.0 between scans minutes apart) and change drastically when picked (35-120).
// Because each tile position maps to a pool hero (identified from its defining ability),
// "the tile at spot H changed" IS "hero H was picked" — the new tile content never needs
// to be identified.
//
// A hover tooltip or highlight over a tile changes it too, and real logs showed models
// being flagged picked in groups of three that way. So:
// - a change must persist for COMMIT_AFTER_SCANS consecutive scans before it commits
//   (a real pick never reverts, so waiting only costs a few seconds of latency)
// - a committed pick is UNDONE if the tile reads as its baseline again for
//   REVIVE_AFTER_SCANS consecutive scans — a real pick's tile never goes back
// Pure logic, no Electron imports.

/** One normalized model tile: raw RGB bytes at MODEL_TILE_COMPARE_SIZE². */
export interface ModelTileCapture {
  heroOrder: number
  tile: Uint8Array
}

export const MODEL_COMMIT_AFTER_SCANS = 3
export const MODEL_REVIVE_AFTER_SCANS = 2

/** Mean absolute per-byte difference; Infinity on length mismatch (treat as changed). */
export function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return Infinity
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i])
  }
  return sum / a.length
}

export interface ModelPickUpdate {
  /** Hero orders committed as picked, in the order they were committed. */
  picked: number[]
  /** Committed by THIS update. */
  newlyPicked: number[]
  /** Un-committed by THIS update (the tile went back to how it started). */
  revived: number[]
}

export interface ModelPickTracker {
  /** The first call captures the unpicked baseline; later calls detect changes. */
  update(current: readonly ModelTileCapture[]): ModelPickUpdate
  reset(): void
}

export function createModelPickTracker(
  threshold: number = MODEL_PICK_DIFF_THRESHOLD,
): ModelPickTracker {
  let baselines: Map<number, Uint8Array> | null = null
  let picked: number[] = []
  const changedStreak = new Map<number, number>()
  const sameStreak = new Map<number, number>()

  return {
    update(current) {
      if (baselines === null) {
        baselines = new Map(current.map((t) => [t.heroOrder, t.tile]))
        return { picked: [...picked], newlyPicked: [], revived: [] }
      }

      const newlyPicked: number[] = []
      const revived: number[] = []
      for (const t of current) {
        const baseline = baselines.get(t.heroOrder)
        if (!baseline) continue
        const changed = meanAbsDiff(baseline, t.tile) > threshold

        if (!picked.includes(t.heroOrder)) {
          const streak = changed ? (changedStreak.get(t.heroOrder) ?? 0) + 1 : 0
          changedStreak.set(t.heroOrder, streak)
          if (streak >= MODEL_COMMIT_AFTER_SCANS) {
            picked.push(t.heroOrder)
            newlyPicked.push(t.heroOrder)
            sameStreak.set(t.heroOrder, 0)
          }
        } else {
          const streak = changed ? 0 : (sameStreak.get(t.heroOrder) ?? 0) + 1
          sameStreak.set(t.heroOrder, streak)
          if (streak >= MODEL_REVIVE_AFTER_SCANS) {
            picked = picked.filter((h) => h !== t.heroOrder)
            revived.push(t.heroOrder)
            changedStreak.set(t.heroOrder, 0)
          }
        }
      }
      return { picked: [...picked], newlyPicked, revived }
    },
    reset() {
      baselines = null
      picked = []
      changedStreak.clear()
      sameStreak.clear()
    },
  }
}
