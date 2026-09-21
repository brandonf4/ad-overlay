import { useEffect } from 'react'
import type { JSX } from 'react'
import { useOverlayData } from './hooks/use-overlay-data'
import { ControlsPanel } from './components/ControlsPanel'
import { TopPicksPanel } from './components/TopPicksPanel'

// @DEV-GUIDE: Root component for the overlay renderer, Phase 1 (see the fork's plan
// doc). Renders on a transparent, click-through window on top of the Dota 2 game.
// Body has pointer-events: none; interactive elements opt in via useMousePassthrough.
//
// Deliberately minimal: the scan controls plus the highest-winrate panel. No
// per-ability borders/labels are drawn over the board (the scan's results are still in
// the overlay:data payload). No scoring yet (Phase 2) and no real visual design
// (Phase 3) — see ControlsPanel.tsx / TopPicksPanel.tsx.

function App(): JSX.Element {
  const { overlayData, scanState, scanError, live, startLive, stopLive } = useOverlayData()

  const closeOverlay = (): void => window.electronApi.send('overlay:close')

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
  const poolSlots = overlayData?.scanData
    ? [...overlayData.scanData.ultimates, ...overlayData.scanData.standard]
    : []
  const pickedCount = poolSlots.filter((s) => s.picked).length

  return (
    <div className="overlay-root" style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
      {overlayData && (
        <TopPicksPanel
          picks={overlayData.topWinratePicks}
          ultimateSlots={overlayData.scanData?.ultimates ?? []}
          scaleFactor={scaleFactor}
        />
      )}

      <ControlsPanel
        scanState={scanState}
        scanError={scanError}
        live={live}
        pickedCount={pickedCount}
        onStartLive={startLive}
        onStopLive={stopLive}
        onClose={closeOverlay}
      />
    </div>
  )
}

export default App
