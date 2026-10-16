import type { DraftSnapshot } from './draft-tracker'
import type { ScoreItem, ScoreState } from '@core/scoring/pick-score'

// @DEV-GUIDE: Turns a reconstructed draft (draft-tracker.ts) into the state the pick
// scoring consumes, attaching each item's win rate / pick position from the data files.
// Pure logic, no Electron imports.

export interface AbilityStats {
  isUltimate: boolean
  winrateHigh: number | null
  pickPositionHigh: number | null
}

export interface ModelStats {
  winrateHigh: number | null
  /** Raw pick position, used as is (the simulator no longer transforms it). */
  pickPositionHigh: number | null
}

export interface ScoringData {
  ability(name: string): AbilityStats | undefined
  model(heroName: string): ModelStats | undefined
}

export function buildScoreState(snapshot: DraftSnapshot, data: ScoringData): ScoreState {
  const available: ScoreItem[] = []

  for (const a of snapshot.poolAbilities) {
    if (a.picked) continue
    const stats = data.ability(a.name)
    available.push({
      name: a.name,
      kind: 'ability',
      isUlt: a.isUltimate,
      winrateHigh: stats?.winrateHigh ?? null,
      pickPositionHigh: stats?.pickPositionHigh ?? null,
    })
  }

  for (const m of snapshot.models) {
    if (m.picked) continue
    const stats = data.model(m.heroName)
    available.push({
      name: m.heroName,
      kind: 'model',
      isUlt: false,
      winrateHigh: stats?.winrateHigh ?? null,
      pickPositionHigh: stats?.pickPositionHigh ?? null,
    })
  }

  const picks: ScoreItem[][] = snapshot.seats.map((entries) =>
    entries.map((e) => {
      if (e.kind === 'model') {
        const stats = data.model(e.name)
        return {
          name: e.name,
          kind: 'model' as const,
          isUlt: false,
          winrateHigh: stats?.winrateHigh ?? null,
          pickPositionHigh: stats?.pickPositionHigh ?? null,
        }
      }
      const stats = data.ability(e.name)
      return {
        name: e.name,
        kind: 'ability' as const,
        isUlt: e.isUlt,
        winrateHigh: stats?.winrateHigh ?? null,
        pickPositionHigh: stats?.pickPositionHigh ?? null,
      }
    }),
  )

  return { available, picks, pickIndex: snapshot.pickIndex }
}
