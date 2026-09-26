import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useOverlayData } from './hooks/use-overlay-data'
import { ControlsPanel, type Side } from './components/ControlsPanel'
import { SeatMenuBox } from './components/SeatMenuBox'
import { TopCombosPanel } from './components/TopCombosPanel'

// @DEV-GUIDE: Root component for the overlay renderer, Phase 1 (see the fork's plan
// doc). Renders on a transparent, click-through window on top of the Dota 2 game.
// Body has pointer-events: none; interactive elements opt in via useMousePassthrough.
//
// Deliberately minimal: the scan controls, a side picker, and — once a side is picked —
// one suggestion menu per player on that team. Left column (seats 0-4) is Radiant, right
// column (5-9) is Dire. No real visual design yet (Phase 3).

const SIDE_STORAGE_KEY = 'ad-overlay-side'

function loadSavedSide(): Side | null {
  try {
    const saved = localStorage.getItem(SIDE_STORAGE_KEY)
    return saved === 'radiant' || saved === 'dire' ? saved : null
  } catch {
    return null
  }
}

function App(): JSX.Element {
  const { overlayData, scanState, scanError, live, startLive, stopLive } = useOverlayData()
  const [side, setSide] = useState<Side | null>(loadSavedSide)

  const closeOverlay = (): void => window.electronApi.send('overlay:close')

  const changeSide = (next: Side): void => {
    setSide(next)
    try {
      localStorage.setItem(SIDE_STORAGE_KEY, next)
    } catch {
      // remembering the side is a convenience only
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        window.electronApi.send('overlay:close')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const scaleFactor = overlayData?.scaleFactor ?? 1
  const menus = (overlayData?.seatMenus ?? []).filter((m) =>
    side === 'radiant' ? m.seat < 5 : side === 'dire' ? m.seat >= 5 : false,
  )

  return (
    <div className="overlay-root" style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
      {menus.map((menu) => (
        <SeatMenuBox key={menu.seat} menu={menu} scaleFactor={scaleFactor} />
      ))}

      <TopCombosPanel data={overlayData?.topCombos ?? null} scaleFactor={scaleFactor} side={side} />

      <ControlsPanel
        scanState={scanState}
        scanError={scanError}
        live={live}
        pickCount={overlayData?.pickCount ?? 0}
        modelStatus={overlayData?.modelStatus ?? { read: 0, picked: 0 }}
        side={side}
        onSideChange={changeSide}
        onStartLive={startLive}
        onStopLive={stopLive}
        onClose={closeOverlay}
      />
    </div>
  )
}

export default App
