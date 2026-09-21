import { describe, it, expect } from 'vitest'
import layouts from '../../../../resources/config/layout_coordinates.json'
import { seatMenuBox } from '@core/resolution/seat-menu-box'
import type { ResolutionLayout } from '@shared/types'

const layout = (layouts as { resolutions: Record<string, ResolutionLayout> }).resolutions['1920x1080']

describe('seatMenuBox', () => {
  it('puts Radiant seats between the screen edge and their outer pick box', () => {
    const box = seatMenuBox(layout, 0, 1920)!
    expect(box.x).toBe(4)
    expect(box.x + box.width).toBeLessThan(211) // outer pick box of seat 0 starts at x=211
    expect(box.y).toBe(146)
    expect(box.height).toBe(146)
  })

  it('puts Dire seats between their outer pick box and the right screen edge', () => {
    const box = seatMenuBox(layout, 5, 1920)!
    expect(box.x).toBeGreaterThan(1644 + 66 - 1) // outer pick box ends at 1710
    expect(box.x + box.width).toBeLessThanOrEqual(1920)
  })

  it('lines each seat up with its own player card', () => {
    const ys = [0, 1, 2, 3, 4].map((s) => seatMenuBox(layout, s, 1920)!.y)
    expect(ys).toEqual([146, 308, 470, 632, 794])
  })

  it('returns a box for every seat at every shipped resolution', () => {
    for (const [res, l] of Object.entries((layouts as { resolutions: Record<string, ResolutionLayout> }).resolutions)) {
      const [width, height] = res.split('x').map(Number)
      // 16:9-ish modes 1280x720 and up leave a usable strip; legacy 4:3 / tiny modes
      // are only required to yield a (narrow) box.
      const roomy = width >= 1280 && width / height >= 1.7
      for (let seat = 0; seat < 10; seat++) {
        const box = seatMenuBox(l, seat, width)
        expect(box, `${res} seat ${seat}`).not.toBeNull()
        expect(box!.width).toBeGreaterThan(roomy ? 100 : 15)
      }
    }
  })
})
