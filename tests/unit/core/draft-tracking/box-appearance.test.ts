import { describe, it, expect } from 'vitest'
import { lumaThumb, thumbNcc, thumbStats, THUMB_SIZE } from '@core/draft-tracking/box-appearance'
import { picture, dimmed, tooltip, blackScreen } from './thumb-fixtures'

describe('lumaThumb', () => {
  it('reduces a square RGB image to a THUMB_SIZE luma thumbnail by block averaging', () => {
    const src = 96
    // left half white, right half black
    const px = new Float32Array(src * src * 3)
    for (let y = 0; y < src; y++)
      for (let x = 0; x < src / 2; x++) px.fill(255, (y * src + x) * 3, (y * src + x) * 3 + 3)
    const t = lumaThumb(px, 0, src)
    expect(t).toHaveLength(THUMB_SIZE * THUMB_SIZE)
    expect(t[0]).toBe(255)
    expect(t[THUMB_SIZE - 1]).toBe(0)
  })

  it('reads the image at the given offset of a batch', () => {
    const src = 48
    const one = src * src * 3
    const batch = new Float32Array(one * 2)
    batch.fill(200, one) // second image is uniform 200
    const t = lumaThumb(batch, one, src)
    expect(thumbStats(t).mean).toBeCloseTo(200, 0)
    expect(thumbStats(lumaThumb(batch, 0, src)).mean).toBe(0)
  })

  it('weights green most, as luma does', () => {
    const src = 24
    const px = new Float32Array(src * src * 3)
    for (let i = 0; i < src * src; i++) px[i * 3 + 1] = 200 // pure green
    expect(thumbStats(lumaThumb(px, 0, src)).mean).toBeCloseTo(0.587 * 200, 0)
  })
})

describe('thumbNcc', () => {
  it('sees a dimmed picture as the same picture', () => {
    const p = picture('atrophy')
    expect(thumbNcc(p, dimmed(p, 0.3))).toBeGreaterThan(0.98)
  })

  it('sees an unrelated picture as different', () => {
    expect(Math.abs(thumbNcc(picture('atrophy'), tooltip()))).toBeLessThan(0.3)
  })

  it('has nothing to say about a flat frame', () => {
    expect(thumbNcc(picture('a'), blackScreen())).toBe(0)
  })
})

describe('the frame is ignored', () => {
  // A dimmed box keeps a light grey frame; measured on real crops it made the box look up
  // to 2x brighter than its icon, which is not part of the picture.
  const withFrame = (interior: number, frame: number): Uint8Array => {
    const t = new Uint8Array(THUMB_SIZE * THUMB_SIZE).fill(interior)
    for (let y = 0; y < THUMB_SIZE; y++)
      for (let x = 0; x < THUMB_SIZE; x++)
        if (x < 3 || y < 3 || x >= THUMB_SIZE - 3 || y >= THUMB_SIZE - 3) t[y * THUMB_SIZE + x] = frame
    return t
  }

  it('measures brightness of the icon area only', () => {
    expect(thumbStats(withFrame(20, 200)).mean).toBe(20)
  })

  it('correlates the picture even when the frame differs a lot between the two looks', () => {
    const p = picture('x')
    const a = Uint8Array.from(p)
    const b = dimmed(p, 0.3)
    for (let y = 0; y < THUMB_SIZE; y++)
      for (let x = 0; x < THUMB_SIZE; x++)
        if (x < 3 || y < 3) b[y * THUMB_SIZE + x] = 220 // bright frame on the dimmed look only
    expect(thumbNcc(a, b)).toBeGreaterThan(0.95)
  })
})
