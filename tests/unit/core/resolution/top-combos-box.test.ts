import { describe, it, expect } from 'vitest'
import layouts from '../../../../resources/config/layout_coordinates.json'
import { topCombosBox, placeTopCombos } from '@core/resolution/top-combos-box'
import type { ResolutionLayout } from '@shared/types'

const resolutions = (layouts as { resolutions: Record<string, ResolutionLayout> }).resolutions
const size = (res: string): [number, number] => res.split('x').map(Number) as [number, number]

describe('topCombosBox', () => {
  it('sits right of the ultimates row, at their topmost y, at 1920x1080', () => {
    const layout = resolutions['1920x1080']
    const box = topCombosBox(layout, 1920, 1080)!
    const rightEdge = Math.max(...layout.ultimate_slots_coords.map((s) => s.x + s.width))
    const topY = Math.min(...layout.ultimate_slots_coords.map((s) => s.y))
    expect(box.x).toBeGreaterThan(rightEdge)
    expect(box.y).toBe(topY)
    expect(box.x + box.width).toBeLessThanOrEqual(1920)
  })

  it('shrinks to fit a tight resolution rather than overflow', () => {
    const box = topCombosBox(resolutions['640x480'], 640, 480)!
    expect(box.x + box.width).toBeLessThanOrEqual(640)
  })

  it('returns null when there truly is no room for even a narrow panel', () => {
    const layout = resolutions['1920x1080']
    const rightEdge = Math.max(...layout.ultimate_slots_coords.map((s) => s.x + s.width))
    expect(topCombosBox(layout, rightEdge + 50, 1080)).toBeNull()
  })

  it('never overflows the screen at any shipped resolution', () => {
    for (const [res, layout] of Object.entries(resolutions)) {
      const [w, h] = size(res)
      const box = topCombosBox(layout, w, h)
      if (box) expect(box.x + box.width, res).toBeLessThanOrEqual(w)
    }
  })

  it('reports where the Dire hero models start below it, and allows a modest climb', () => {
    const box = topCombosBox(resolutions['1920x1080'], 1920, 1080)!
    expect(box.limitY).toBe(343) // the top Dire model tile (x 1244, y 343)
    expect(box.maxGrowUp).toBe(97) // 9% of the screen height
  })

  it('scales the allowed climb with the screen and never lets it go above the screen top', () => {
    const [w, h] = size('2560x1440')
    expect(topCombosBox(resolutions['2560x1440'], w, h)!.maxGrowUp).toBe(130)
    for (const [res, layout] of Object.entries(resolutions)) {
      const [rw, rh] = size(res)
      const box = topCombosBox(layout, rw, rh)
      if (box) {
        expect(box.maxGrowUp, res).toBeGreaterThanOrEqual(0)
        expect(box.y - box.maxGrowUp, res).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('placeTopCombos', () => {
  const box = { y: 166, limitY: 343, maxGrowUp: 97 }

  it('keeps the anchor position when the panel fits above what is below', () => {
    expect(placeTopCombos(box, 150)).toBe(166)
  })

  it('moves up by just enough to clear what is below', () => {
    // panel 220 tall + 4 gap must end at 343 -> top at 119
    expect(placeTopCombos(box, 220)).toBe(119)
  })

  it('never climbs past the allowed amount, even if that still overlaps', () => {
    expect(placeTopCombos(box, 400)).toBe(166 - 97)
  })

  it('does not move when nothing is below the panel', () => {
    expect(placeTopCombos({ y: 166, limitY: null, maxGrowUp: 97 }, 500)).toBe(166)
  })

  it('15 rows at 1080p now clear the Dire models almost entirely', () => {
    // 15 rows ~ 262px tall: needs 262 + 4 - (343 - 166) = 89px of climb, under the 97 allowed
    const top = placeTopCombos(box, 262)
    expect(top + 262 + 4).toBeLessThanOrEqual(343)
  })
})
