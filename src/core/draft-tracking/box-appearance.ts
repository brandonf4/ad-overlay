// @DEV-GUIDE: Tiny brightness thumbnails of pool boxes, for telling a DRAFTED ability from
// one that is merely unreadable. Real game data (saved crops from live drafts) shows a
// drafted ability's pool box stays in the grid as a DIMMED copy of its own icon — about
// 20-40% of its normal brightness, same picture, grey frame — not a blank box. Whether the
// scanner still recognises the dimmed icon varies by ability (some read as themselves,
// most fall below the confidence gate), so the reliable signal is brightness relative to
// how the SAME box looked while the ability was still available.
// Pure logic, no Electron imports.

/** Thumbnails are THUMB_SIZE x THUMB_SIZE luma bytes. */
export const THUMB_SIZE = 24

/**
 * Box-averaged luma thumbnail of one square RGB image inside a flat pixel array
 * (`srcSize` x `srcSize` x 3, values 0-255, starting at `offset`).
 */
export function lumaThumb(pixels: ArrayLike<number>, offset: number, srcSize: number): Uint8Array {
  const block = Math.floor(srcSize / THUMB_SIZE)
  const out = new Uint8Array(THUMB_SIZE * THUMB_SIZE)
  for (let ty = 0; ty < THUMB_SIZE; ty++) {
    for (let tx = 0; tx < THUMB_SIZE; tx++) {
      let sum = 0
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const p = offset + ((ty * block + dy) * srcSize + (tx * block + dx)) * 3
          sum += 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]
        }
      }
      out[ty * THUMB_SIZE + tx] = Math.round(sum / (block * block))
    }
  }
  return out
}

export interface ThumbStats {
  mean: number
  std: number
}

/**
 * Stats and correlation look only at the INNER part of the thumbnail. A dimmed box keeps
 * a light grey frame along its edges (real crops: the top/left frame band is ~1.9x the
 * dimmed icon's brightness), which inflated a dimmed box's mean by 17% on median and up
 * to 2x — enough to push a truly dimmed box over the dim cutoff — and is not part of the
 * icon anyway.
 */
export const INNER_INSET = 3

function forEachInner(length: number, fn: (index: number) => void): void {
  const size = Math.round(Math.sqrt(length))
  if (size * size !== length) {
    for (let i = 0; i < length; i++) fn(i)
    return
  }
  for (let y = INNER_INSET; y < size - INNER_INSET; y++)
    for (let x = INNER_INSET; x < size - INNER_INSET; x++) fn(y * size + x)
}

export function thumbStats(t: ArrayLike<number>): ThumbStats {
  let sum = 0
  let n = 0
  forEachInner(t.length, (i) => {
    sum += t[i]
    n++
  })
  const mean = sum / n
  let varSum = 0
  forEachInner(t.length, (i) => {
    varSum += (t[i] - mean) ** 2
  })
  return { mean, std: Math.sqrt(varSum / n) }
}

/**
 * Normalised cross-correlation of two thumbnails in [-1, 1] over their inner regions.
 * Unaffected by a uniform brightness change, which is why it recognises a dimmed icon as
 * the same picture. Returns 0 when either side has no structure (flat).
 */
export function thumbNcc(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0
  const sa = thumbStats(a)
  const sb = thumbStats(b)
  if (sa.std === 0 || sb.std === 0) return 0
  let dot = 0
  let n = 0
  forEachInner(a.length, (i) => {
    dot += (a[i] - sa.mean) * (b[i] - sb.mean)
    n++
  })
  return dot / (n * sa.std * sb.std)
}
