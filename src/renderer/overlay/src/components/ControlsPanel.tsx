import type { JSX } from 'react'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import type { ScanState } from '../hooks/use-overlay-data'

// @DEV-GUIDE: Phase-1 placeholder control bar — just a Scan button and status text,
// positioned top-right. Replace with real chrome in Phase 3.

interface ControlsPanelProps {
  scanState: ScanState
  scanError: string | null
  onScan: () => void
}

export function ControlsPanel({ scanState, scanError, onScan }: ControlsPanelProps): JSX.Element {
  const { onMouseEnter, onMouseLeave } = useMousePassthrough()
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
      <button onClick={onScan} disabled={scanState === 'scanning'}>
        {scanState === 'scanning' ? 'Scanning…' : 'Scan'}
      </button>
      <span>Status: {scanState}</span>
      {scanError && <span style={{ color: '#ff5c5c' }}>{scanError}</span>}
    </div>
  )
}
