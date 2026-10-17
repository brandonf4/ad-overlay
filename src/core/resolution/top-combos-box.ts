import type { ResolutionLayout } from '@shared/types'

// @DEV-GUIDE: Where the top-combos panel goes: to the right of the ultimates row (the
// same spot the old highest-winrate panel used), following the ultimates' own calibrated
// coordinates rather than a fixed screen offset, so it tracks the real layout at whatever
// resolution is active. Returns null when there is no usable room (very small/legacy
// resolutions), rather than overflow the screen.
//
// The panel is anchored at the ultimates' top edge and grows downward, but a long list
// runs into the Dire hero model tiles below it. So the box also reports where those
// start (limitY) and how far the panel may climb above the ultimates' top edge to clear
// them (maxGrowUp, a fraction of screen height — "a bit", not up the whole screen);
// placeTopCombos() turns that plus the panel's real rendered height into its final top.
// All values are layout pixels, like every other overlay coordinate.

export interface TopCombosBox {
  x: number
  y: number
  width: number
  /** Top of the nearest board element below the panel's column (a model tile or pool
   * box), or null when nothing is below it. */
  limitY: number | null
  /** The most the panel may move up from y to avoid covering what is below. */
  maxGrowUp: number
}

const MARGIN_PX = 12
const PREFERRED_WIDTH = 240
const MIN_WIDTH = 140
/** Max upward growth as a fraction of the screen height (~100px at 1080p). */
const MAX_GROW_UP_RATIO = 0.09

export function topCombosBox(
  layout: ResolutionLayout,
  screenWidth: number,
  screenHeight: number,
): TopCombosBox | null {
  const ultimates = layout.ultimate_slots_coords
  if (!ultimates || ultimates.length === 0) return null

  const x = Math.max(...ultimates.map((s) => s.x + s.width)) + MARGIN_PX
  const y = Math.min(...ultimates.map((s) => s.y))
  const width = Math.min(PREFERRED_WIDTH, screenWidth - x - MARGIN_PX)
  if (width < MIN_WIDTH) return null

  const right = x + width
  const below = [...(layout.models_coords ?? []), ...(layout.standard_slots_coords ?? [])]
    .filter((c) => c.x < right && c.x + c.width > x && c.y > y)
    .map((c) => c.y)
  const limitY = below.length > 0 ? Math.min(...below) : null

  return {
    x,
    y,
    width,
    limitY,
    maxGrowUp: Math.max(0, Math.min(y, Math.round(screenHeight * MAX_GROW_UP_RATIO))),
  }
}

/**
 * Final top edge of the panel (layout px) given its real rendered height: the anchor
 * position if it fits above `limitY`, otherwise moved up by just enough to clear it,
 * but never by more than `maxGrowUp`.
 */
export function placeTopCombos(
  box: Pick<TopCombosBox, 'y' | 'limitY' | 'maxGrowUp'>,
  panelHeight: number,
  gap = 4,
): number {
  if (box.limitY === null) return box.y
  const fitsAt = box.limitY - panelHeight - gap
  return Math.max(box.y - box.maxGrowUp, Math.min(box.y, fitsAt))
}
