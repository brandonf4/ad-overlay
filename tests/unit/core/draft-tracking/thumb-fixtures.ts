import { THUMB_SIZE } from '@core/draft-tracking/box-appearance'

// Deterministic stand-ins for pool-box thumbnails: a "picture" per name (bright, with
// structure), the dimmed copy a drafted box shows, and unrelated pictures for tooltips.

function hash(seed: string, i: number): number {
  let h = 2166136261
  const s = `${seed}:${i}`
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000
}

/** A bright textured picture (mean ~110, plenty of structure) unique to `seed`. */
export function picture(seed: string): Uint8Array {
  const t = new Uint8Array(THUMB_SIZE * THUMB_SIZE)
  for (let i = 0; i < t.length; i++) t[i] = Math.round(30 + 160 * hash(seed, i))
  return t
}

/** The same picture at `factor` of its brightness — what a drafted pool box looks like. */
export function dimmed(t: Uint8Array, factor = 0.3): Uint8Array {
  return Uint8Array.from(t, (v) => Math.round(v * factor))
}

/** The same picture brighter (the gold hover highlight), clipped at 255. */
export function brightened(t: Uint8Array, factor = 1.4): Uint8Array {
  return Uint8Array.from(t, (v) => Math.min(255, Math.round(v * factor)))
}

/** A dark panel with unrelated content (a hover tooltip's text over the box). */
export function tooltip(seed = 'tooltip'): Uint8Array {
  const t = new Uint8Array(THUMB_SIZE * THUMB_SIZE)
  for (let i = 0; i < t.length; i++) t[i] = Math.round(15 + 60 * hash(seed, i))
  return t
}

/** Solid black: a screen transition. */
export function blackScreen(): Uint8Array {
  return new Uint8Array(THUMB_SIZE * THUMB_SIZE)
}
