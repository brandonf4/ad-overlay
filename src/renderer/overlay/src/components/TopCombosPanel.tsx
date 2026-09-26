import type { CSSProperties, JSX } from 'react'
import type { ComboHalf, ComboSuggestion, TopCombosPanelData } from '@shared/types'
import type { Side } from './ControlsPanel'
import { useIcon } from '../hooks/use-icon'

// @DEV-GUIDE: Panel of the best available ability/model pairs by estimated combo win rate
// (see core/scoring/top-combos.ts) — sits where the old single-item highest-winrate panel
// used to, right of the ultimates row (core/resolution/top-combos-box.ts computes the
// position server-side, same coordinate-driven approach as everywhere else in the
// overlay). A pair may have one half already drafted: that half is dimmed and tagged with
// who holds it (R1-R5 = Radiant rows top to bottom, D1-D5 = Dire), colored blue for your
// team and red for the other once you've picked a side. Replace the chrome in Phase 3.

interface TopCombosPanelProps {
  data: TopCombosPanelData | null
  scaleFactor: number
  /** Your team, so a drafted half can be marked as a teammate's or an enemy's. */
  side: Side | null
}

const FONT_SIZE = 11
const ICON_PX = Math.round(FONT_SIZE * 1.2)

/** "R2" = second Radiant row from the top; "D4" = fourth Dire row. */
export function seatTag(seat: number): string {
  return seat < 5 ? `R${seat + 1}` : `D${seat - 4}`
}

function holderColor(seat: number, side: Side | null): string {
  if (side === null) return '#b0b0b0'
  const mine = (seat < 5) === (side === 'radiant')
  return mine ? '#5aa9ff' : '#ff6b6b'
}

interface ComboHalfViewProps {
  half: ComboHalf
  side: Side | null
}

function ComboHalfView({ half, side }: ComboHalfViewProps): JSX.Element {
  const iconUrl = useIcon(half.kind, half.name)
  const drafted = half.heldBy !== null
  return (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        opacity: drafted ? 0.65 : 1,
      }}
    >
      <span style={{ width: ICON_PX, height: ICON_PX, flexShrink: 0, display: 'inline-block' }}>
        {iconUrl && (
          <img
            src={iconUrl}
            alt=""
            width={ICON_PX}
            height={ICON_PX}
            style={{ display: 'block', borderRadius: 2 }}
          />
        )}
      </span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {half.displayName}
      </span>
      {half.heldBy !== null && (
        <span
          title="Already drafted by this player"
          style={{
            flexShrink: 0,
            fontSize: FONT_SIZE - 2,
            fontWeight: 'bold',
            color: holderColor(half.heldBy, side),
          }}
        >
          {seatTag(half.heldBy)}
        </span>
      )}
    </span>
  )
}

interface ComboRowProps {
  combo: ComboSuggestion
  side: Side | null
}

function ComboRow({ combo, side }: ComboRowProps): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      <ComboHalfView half={combo.a} side={side} />
      <span style={{ opacity: 0.6, flexShrink: 0 }}>+</span>
      <ComboHalfView half={combo.b} side={side} />
      <span style={{ color: '#3ddc84', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {(combo.comboWinrate * 100).toFixed(1)}%
      </span>
    </div>
  )
}

export function TopCombosPanel({ data, scaleFactor, side }: TopCombosPanelProps): JSX.Element | null {
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
        <ComboRow key={`${combo.a.name}-${combo.b.name}`} combo={combo} side={side} />
      ))}
    </div>
  )
}
