import type { ResolutionLayout } from '@shared/types'

// @DEV-GUIDE: Where each seat's suggestion menu goes: in the strip between the screen
// edge and the seat's OUTER pick box — left of the row for seats 0-4 (Radiant, left
// column), right of it for seats 5-9 (Dire, right column) — vertically matching the
// seat's player card. Coordinates are in the layout's own pixel space (divide by the
// overlay scaleFactor at render, like every other overlay coordinate).

export interface SeatMenuBox {
  x: number
  y: number
  width: number
  height: number
}

const EDGE_MARGIN = 4

export function seatMenuBox(
  layout: ResolutionLayout,
  seat: number,
  screenWidth: number,
): SeatMenuBox | null {
  const card = layout.heroes_coords?.find((c) => c.hero_order === seat)
  const slots = (layout.selected_abilities_coords ?? []).filter((c) => c.hero_order === seat)
  const boxWidth = layout.selected_abilities_params?.width ?? 0
  if (!card || !layout.heroes_params || slots.length === 0 || boxWidth <= 0) return null

  const y = card.y
  const height = layout.heroes_params.height

  if (seat < 5) {
    const outerLeft = Math.min(...slots.map((s) => s.x))
    const width = outerLeft - EDGE_MARGIN * 2
    return width > 0 ? { x: EDGE_MARGIN, y, width, height } : null
  }

  const outerRight = Math.max(...slots.map((s) => s.x)) + boxWidth
  const x = outerRight + EDGE_MARGIN
  const width = screenWidth - x - EDGE_MARGIN
  return width > 0 ? { x, y, width, height } : null
}
