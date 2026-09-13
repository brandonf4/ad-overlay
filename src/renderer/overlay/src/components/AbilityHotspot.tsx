import type { CSSProperties, JSX } from 'react'
import type { DisplayScanSlot } from '@shared/types'

// @DEV-GUIDE: Phase-1 placeholder — proves the coordinate-driven positioning still
// lines up with the actual game screen after a scan, with no scoring/UI design yet.
// Positioning follows the same approach as the upstream AbilityHotspot: each slot's
// calibrated screen rect (from src/core/resolution), divided by scaleFactor, placed
// absolutely inside the overlay window. Replace the visual chrome here in Phase 3;
// keep the coordinate math.

interface AbilityHotspotProps {
  slot: DisplayScanSlot
  scaleFactor: number
}

export function AbilityHotspot({ slot, scaleFactor }: AbilityHotspotProps): JSX.Element {
  const recognized = slot.name !== null
  const style: CSSProperties = {
    position: 'absolute',
    left: slot.coord.x / scaleFactor,
    top: slot.coord.y / scaleFactor,
    width: slot.coord.width / scaleFactor,
    height: slot.coord.height / scaleFactor,
    border: `2px solid ${recognized ? '#3ddc84' : '#ff5c5c'}`,
    borderRadius: 4,
    boxSizing: 'border-box',
    pointerEvents: 'none',
  }
  return (
    <div style={style} title={`${slot.displayName} (${slot.confidence.toFixed(2)})`}>
      <span
        style={{
          position: 'absolute',
          bottom: -16,
          left: 0,
          fontSize: 10,
          color: '#fff',
          background: 'rgba(0,0,0,0.7)',
          padding: '0 2px',
          whiteSpace: 'nowrap',
        }}
      >
        {slot.displayName}
      </span>
    </div>
  )
}
