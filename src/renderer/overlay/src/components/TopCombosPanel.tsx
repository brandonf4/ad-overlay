import type { CSSProperties, JSX } from 'react'
import type { ComboSuggestion, TopCombosPanelData } from '@shared/types'
import { useIcon } from '../hooks/use-icon'

// @DEV-GUIDE: Panel of the best still-available ability/model pairs by estimated combo
// win rate (see core/scoring/top-combos.ts) — sits where the old single-item highest-
// winrate panel used to, right of the ultimates row (core/resolution/top-combos-box.ts
// computes the position server-side, same coordinate-driven approach as everywhere else
// in the overlay). Replace the chrome in Phase 3.

interface TopCombosPanelProps {
  data: TopCombosPanelData | null
  scaleFactor: number
}

const FONT_SIZE = 11

interface ComboRowProps {
  combo: ComboSuggestion
}

function ComboRow({ combo }: ComboRowProps): JSX.Element {
  const iconA = useIcon(combo.a.kind, combo.a.name)
  const iconB = useIcon(combo.b.kind, combo.b.name)
  const iconPx = Math.round(FONT_SIZE * 1.2)
  const nameStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }
  const iconSlotStyle: CSSProperties = {
    width: iconPx,
    height: iconPx,
    flexShrink: 0,
    display: 'inline-block',
  }
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      <span style={iconSlotStyle}>
        {iconA && <img src={iconA} alt="" width={iconPx} height={iconPx} style={{ display: 'block', borderRadius: 2 }} />}
      </span>
      <span style={nameStyle}>{combo.a.displayName}</span>
      <span style={{ opacity: 0.6, flexShrink: 0 }}>+</span>
      <span style={iconSlotStyle}>
        {iconB && <img src={iconB} alt="" width={iconPx} height={iconPx} style={{ display: 'block', borderRadius: 2 }} />}
      </span>
      <span style={nameStyle}>{combo.b.displayName}</span>
      <span style={{ color: '#3ddc84', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {(combo.comboWinrate * 100).toFixed(1)}%
      </span>
    </div>
  )
}

export function TopCombosPanel({ data, scaleFactor }: TopCombosPanelProps): JSX.Element | null {
  if (!data || data.combos.length === 0) return null

  const style: CSSProperties = {
    position: 'absolute',
    left: data.x / scaleFactor,
    top: data.y / scaleFactor,
    width: data.width / scaleFactor,
    background: 'rgba(20,20,20,0.85)',
    color: '#fff',
    borderRadius: 6,
    padding: '6px 8px',
    boxSizing: 'border-box',
    fontFamily: 'sans-serif',
    fontSize: FONT_SIZE,
    lineHeight: 1.4,
    pointerEvents: 'none',
  }
  return (
    <div style={style}>
      <div style={{ fontWeight: 'bold', marginBottom: 4, opacity: 0.8 }}>Top Combos</div>
      {data.combos.map((combo) => (
        <ComboRow key={`${combo.a.name}-${combo.b.name}`} combo={combo} />
      ))}
    </div>
  )
}
