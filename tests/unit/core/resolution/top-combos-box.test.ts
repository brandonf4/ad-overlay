import { describe, it, expect } from 'vitest'
import layouts from '../../../../resources/config/layout_coordinates.json'
import { topCombosBox } from '@core/resolution/top-combos-box'
import type { ResolutionLayout } from '@shared/types'

const resolutions = (layouts as { resolutions: Record<string, ResolutionLayout> }).resolutions

describe('topCombosBox', () => {
  it('sits right of the ultimates row, at their topmost y, at 1920x1080', () => {
    const layout = resolutions['1920x1080']
    const box = topCombosBox(layout, 1920)!
    const rightEdge = Math.max(...layout.ultimate_slots_coords.map((s) => s.x + s.width))
    const topY = Math.min(...layout.ultimate_slots_coords.map((s) => s.y))
    expect(box.x).toBeGreaterThan(rightEdge)
    expect(box.y).toBe(topY)
    expect(box.x + box.width).toBeLessThanOrEqual(1920)
  })

  it('shrinks to fit a tight resolution rather than overflow', () => {
    const box = topCombosBox(resolutions['640x480'], 640)!
    expect(box.x + box.width).toBeLessThanOrEqual(640)
  })

  it('returns null when there truly is no room for even a narrow panel', () => {
    const layout = resolutions['1920x1080']
    const rightEdge = Math.max(...layout.ultimate_slots_coords.map((s) => s.x + s.width))
    expect(topCombosBox(layout, rightEdge + 50)).toBeNull()
  })

  it('never overflows the screen at any shipped resolution', () => {
    for (const [res, layout] of Object.entries(resolutions)) {
      const width = Number(res.split('x')[0])
      const box = topCombosBox(layout, width)
      if (box) expect(box.x + box.width, res).toBeLessThanOrEqual(width)
    }
  })
})
