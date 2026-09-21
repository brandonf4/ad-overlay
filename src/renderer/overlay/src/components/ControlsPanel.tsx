import { useState } from 'react'
import type { JSX } from 'react'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import type { ScanState } from '../hooks/use-overlay-data'

// @DEV-GUIDE: Phase-1 placeholder control bar — Scan/Stop and Close buttons, a Pick side
// button, and status text, positioned top-right. Replace with real chrome in Phase 3.

export type Side = 'radiant' | 'dire'

interface ControlsPanelProps {
  scanState: ScanState
  scanError: string | null
  live: boolean
  pickCount: number
  modelStatus: { read: number; picked: number }
  side: Side | null
  onSideChange: (side: Side) => void
  onStartLive: () => void
  onStopLive: () => void
  onClose: () => void
}

const SIDE_LABEL: Record<Side, string> = { radiant: 'Radiant', dire: 'Dire' }

export function ControlsPanel({
  scanState,
  scanError,
  live,
  pickCount,
  modelStatus,
  side,
  onSideChange,
  onStartLive,
  onStopLive,
  onClose,
}: ControlsPanelProps): JSX.Element {
  const { onMouseEnter, onMouseLeave } = useMousePassthrough()
  const [choosingSide, setChoosingSide] = useState(false)
  const status = live
    ? scanState === 'scanning'
      ? 'starting…'
      : `live · ${pickCount}/50 picks`
    : scanState

  const chooseSide = (s: Side): void => {
    onSideChange(s)
    setChoosingSide(false)
  }

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
      {choosingSide ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => chooseSide('radiant')}>Radiant</button>
          <button onClick={() => chooseSide('dire')}>Dire</button>
        </div>
      ) : (
        <button onClick={() => setChoosingSide(true)}>
          {side ? `Side: ${SIDE_LABEL[side]}` : 'Pick side'}
        </button>
      )}
      <span>Status: {status}</span>
      {live && scanState !== 'scanning' && (
        <span title="Hero models whose hero was identified from the pool, and how many of those are drafted">
          Models: {modelStatus.read}/12 read · {modelStatus.picked} taken
        </span>
      )}
      {scanError && <span style={{ color: '#ff5c5c' }}>{scanError}</span>}
    </div>
  )
}
