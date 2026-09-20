import type { CSSProperties, JSX } from 'react'
import type { IdentifiedHeroModel } from '@shared/types'

// @DEV-GUIDE: Phase-1-lite label over each draft-board hero model tile. The hero is
// identified from its defining ability (see scan-processing-service.ts), not from the
// model image. Same coordinate-driven positioning as AbilityHotspot.

interface HeroModelLabelProps {
  model: IdentifiedHeroModel
  scaleFactor: number
}

export function HeroModelLabel({ model, scaleFactor }: HeroModelLabelProps): JSX.Element {
  const recognized = model.name !== null
  const style: CSSProperties = {
    position: 'absolute',
    left: model.coord.x / scaleFactor,
    top: model.coord.y / scaleFactor,
    width: model.coord.width / scaleFactor,
    height: model.coord.height / scaleFactor,
    border: `2px solid ${recognized ? '#3ddc84' : '#ff5c5c'}`,
    borderRadius: 4,
    boxSizing: 'border-box',
    pointerEvents: 'none',
  }
  return (
    <div style={style} title={`${model.displayName} (${model.confidence.toFixed(2)})`}>
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
        {model.displayName}
        {model.winrateHigh !== null && ` ${(model.winrateHigh * 100).toFixed(1)}%`}
      </span>
    </div>
  )
}
