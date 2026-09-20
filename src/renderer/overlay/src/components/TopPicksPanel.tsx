import type { CSSProperties, JSX } from 'react'
import type { DisplayScanSlot } from '@shared/types'

// @DEV-GUIDE: Phase-1-lite — a plain ranked list, no synergy/role scoring yet (see
// docs/plan.md). Positioned relative to the ultimates grid's own calibrated
// coordinates (not a fixed screen offset), so it tracks the real layout at whatever
// resolution is active instead of guessing a pixel position.

interface TopPicksPanelProps {
  picks: DisplayScanSlot[]
  ultimateSlots: DisplayScanSlot[]
  scaleFactor: number
}

const MARGIN_PX = 12

export function TopPicksPanel({
  picks,
  ultimateSlots,
  scaleFactor,
}: TopPicksPanelProps): JSX.Element | null {
  if (picks.length === 0 || ultimateSlots.length === 0) return null

  const rightEdge = Math.max(...ultimateSlots.map((s) => s.coord.x + s.coord.width))
  const topY = Math.min(...ultimateSlots.map((s) => s.coord.y))

  const style: CSSProperties = {
    position: 'absolute',
    left: rightEdge / scaleFactor + MARGIN_PX,
    top: topY / scaleFactor,
    width: 220,
    background: 'rgba(20,20,20,0.85)',
    color: '#fff',
    borderRadius: 6,
    padding: '8px 10px',
    fontFamily: 'sans-serif',
    fontSize: 12,
    pointerEvents: 'none',
  }

  return (
    <div style={style}>
      <div style={{ fontWeight: 'bold', marginBottom: 6, opacity: 0.8 }}>
        Highest Win Rate
      </div>
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        {picks.map((slot) => (
          <li key={`${slot.hero_order}-${slot.ability_order}-${slot.is_ultimate}`}>
            <span>{slot.displayName}</span>
            <span style={{ float: 'right', color: '#3ddc84' }}>
              {((slot.winrateHigh as number) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
