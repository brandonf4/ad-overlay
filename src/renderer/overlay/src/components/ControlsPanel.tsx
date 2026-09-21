import type { JSX } from 'react'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import type { ScanState } from '../hooks/use-overlay-data'

// @DEV-GUIDE: Phase-1 placeholder control bar — Scan/Stop and Close buttons plus status
// text, positioned top-right. Replace with real chrome in Phase 3.

interface ControlsPanelProps {
  scanState: ScanState
  scanError: string | null
  live: boolean
  pickedCount: number
  onStartLive: () => void
  onStopLive: () => void
  onClose: () => void
}

export function ControlsPanel({
  scanState,
  scanError,
  live,
  pickedCount,
  onStartLive,
  onStopLive,
  onClose,
}: ControlsPanelProps): JSX.Element {
  const { onMouseEnter, onMouseLeave } = useMousePassthrough()
  const status = live
    ? scanState === 'scanning'
      ? 'starting…'
      : `live · ${pickedCount} picked`
    : scanState
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        background: 'rgba(20,20,20,0.85)',
        color: '#fff',
        padding: '8px 12px',
        borderRadius: 6,
        fontFamily: 'sans-serif',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        {live ? (
          <button onClick={onStopLive}>Stop</button>
        ) : (
          <button onClick={onStartLive}>Scan</button>
        )}
        <button onClick={onClose}>Close</button>
      </div>
      <span>Status: {status}</span>
      {scanError && <span style={{ color: '#ff5c5c' }}>{scanError}</span>}
    </div>
  )
}
