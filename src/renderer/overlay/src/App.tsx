import { useEffect } from 'react'
import type { JSX } from 'react'
import { useOverlayData } from './hooks/use-overlay-data'
import { ControlsPanel } from './components/ControlsPanel'
import { AbilityHotspot } from './components/AbilityHotspot'
import { TopPicksPanel } from './components/TopPicksPanel'
import { HeroModelLabel } from './components/HeroModelLabel'

// @DEV-GUIDE: Root component for the overlay renderer, Phase 1 (see the fork's plan
// doc). Renders on a transparent, click-through window on top of the Dota 2 game.
// Body has pointer-events: none; interactive elements opt in via useMousePassthrough.
//
// This is deliberately a placeholder: a Scan button plus a colored border + name
// label on every recognized pool slot, proving the scanning pipeline's coordinates
// line up with the real game screen. No suggestions/scoring yet (Phase 2) and no
// real visual design (Phase 3) — see ControlsPanel.tsx / AbilityHotspot.tsx.

function App(): JSX.Element {
  const { overlayData, scanState, scanError, triggerScan } = useOverlayData()

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

  return (
    <div
      className={`overlay-root${scanState === 'scanning' ? ' capture-mode' : ''}`}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
    >
      {poolSlots.map((slot) => (
        <AbilityHotspot
          key={`${slot.hero_order}-${slot.ability_order}-${slot.is_ultimate}`}
          slot={slot}
          scaleFactor={scaleFactor}
        />
      ))}

      {overlayData?.identifiedHeroModels.map((model) => (
        <HeroModelLabel key={model.heroOrder} model={model} scaleFactor={scaleFactor} />
      ))}

      {overlayData && (
        <TopPicksPanel
          picks={overlayData.topWinratePicks}
          ultimateSlots={overlayData.scanData?.ultimates ?? []}
          scaleFactor={scaleFactor}
        />
      )}

      <ControlsPanel scanState={scanState} scanError={scanError} onScan={triggerScan} />
    </div>
  )
}

export default App
