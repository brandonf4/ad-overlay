import type { ResolutionLayout } from '@shared/types'

// @DEV-GUIDE: Where the top-combos panel goes: to the right of the ultimates row (the
// same spot the old highest-winrate panel used), following the ultimates' own calibrated
// coordinates rather than a fixed screen offset, so it tracks the real layout at whatever
// resolution is active. Returns null when there is no usable room (very small/legacy
// resolutions), rather than overflow the screen.

export interface TopCombosBox {
  x: number
  y: number
  width: number
}

const MARGIN_PX = 12
const PREFERRED_WIDTH = 240
const MIN_WIDTH = 140

export function topCombosBox(layout: ResolutionLayout, screenWidth: number): TopCombosBox | null {
  const ultimates = layout.ultimate_slots_coords
  if (!ultimates || ultimates.length === 0) return null

  const x = Math.max(...ultimates.map((s) => s.x + s.width)) + MARGIN_PX
  const y = Math.min(...ultimates.map((s) => s.y))
  const width = Math.min(PREFERRED_WIDTH, screenWidth - x - MARGIN_PX)
  return width >= MIN_WIDTH ? { x, y, width } : null
}
