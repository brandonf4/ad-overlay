import type { CSSProperties, JSX } from 'react'
import type { SeatMenu } from '@shared/types'

// @DEV-GUIDE: Phase-1 placeholder menu — one per player on the chosen team, listing that
// player's best remaining picks (abilities and hero models together, models tagged HERO)
// by the simulator's pick score (lower = better). Sits
// in the strip between the screen edge and the player's outer pick box (positioned by
// core/resolution/seat-menu-box.ts). Same coordinate-driven positioning as the rest of
// the overlay: layout pixels divided by scaleFactor. Replace the chrome in Phase 3.

interface SeatMenuBoxProps {
  menu: SeatMenu
  scaleFactor: number
}

export function SeatMenuBox({ menu, scaleFactor }: SeatMenuBoxProps): JSX.Element {
  const height = menu.height / scaleFactor
  // Six lines (heading + 5 picks) have to fit the player card's height.
  const fontSize = Math.max(8, Math.min(12, height / 8.5))
  const style: CSSProperties = {
    position: 'absolute',
    left: menu.x / scaleFactor,
    top: menu.y / scaleFactor,
    width: menu.width / scaleFactor,
    height,
    boxSizing: 'border-box',
    padding: '3px 5px',
    overflow: 'hidden',
    background: 'rgba(20,20,20,0.85)',
    color: '#fff',
    borderRadius: 4,
    fontFamily: 'sans-serif',
    fontSize,
    lineHeight: 1.25,
    pointerEvents: 'none',
  }
  return (
    <div style={style}>
      <div style={{ opacity: 0.6, marginBottom: 2 }}>Top picks</div>
      {menu.suggestions.length === 0 ? (
        <div style={{ opacity: 0.6 }}>–</div>
      ) : (
        menu.suggestions.map((s, i) => (
          <div key={s.name} style={{ display: 'flex', gap: 4 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {i + 1}. {s.displayName}
            </span>
            {s.kind === 'model' && (
              <span style={{ color: '#f0b429', fontSize: Math.max(7, fontSize - 3), alignSelf: 'center' }}>HERO</span>
            )}
            <span style={{ color: '#3ddc84', fontVariantNumeric: 'tabular-nums' }}>{s.score.toFixed(1)}</span>
          </div>
        ))
      )}
    </div>
  )
}
