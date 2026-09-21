import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import log from 'electron-log/main'
import type { SynergyLookup } from '@core/scoring/pick-score'
import type { ScoringData } from '@core/draft-tracking/score-state'

// @DEV-GUIDE: In-memory data layer for the pick scoring. Loads ad-simulator's own
// Windrun-sourced files, shipped as plain resources (same pattern as the ONNX model in
// ml-service.ts): heroes_abilities.json (per-ability and per-hero-model win rate and
// average pick position) and ability_synergies.json (pairwise synergy values, keyed by
// ability or hero-model internal name). No SQLite, no scraper.

const logger = log.scope('ability-data')

interface RawAbility {
  name: string
  display_name: string
  is_ultimate: boolean
  winrate_high: number | null
  avg_pick_position_high: number | null
}

interface RawHero {
  name: string
  display_name: string
  abilities: RawAbility[]
  model_winrate_high: number | null
  model_avg_pick_position_high: number | null
}

export interface AbilityDataEntry {
  name: string
  displayName: string
  isUltimate: boolean
  winrateHigh: number | null
  pickPositionHigh: number | null
}

export interface HeroModelDataEntry {
  name: string
  displayName: string
  winrateHigh: number | null
  pickPositionHigh: number | null
}

export interface AbilityDataService {
  getAbility(name: string): AbilityDataEntry | undefined
  getHeroModel(name: string): HeroModelDataEntry | undefined
  /** Owning hero of an ability, by internal name (e.g. "night_stalker_void" -> hero
   * "night_stalker"). Identifies a draft-board hero model from its defining ability. */
  getHeroByAbility(abilityName: string): HeroModelDataEntry | undefined
  readonly synergy: SynergyLookup
  readonly scoringData: ScoringData
}

function resourcePath(file: string): string {
  const basePath = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(basePath, 'data', file)
}

function synergyKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function createAbilityDataService(): AbilityDataService {
  const abilities = new Map<string, AbilityDataEntry>()
  const heroModels = new Map<string, HeroModelDataEntry>()
  const abilityToHero = new Map<string, HeroModelDataEntry>()
  const synergies = new Map<string, number>()

  try {
    const raw: RawHero[] = JSON.parse(readFileSync(resourcePath('heroes_abilities.json'), 'utf-8'))
    for (const hero of raw) {
      const heroEntry: HeroModelDataEntry = {
        name: hero.name,
        displayName: hero.display_name,
        winrateHigh: hero.model_winrate_high,
        pickPositionHigh: hero.model_avg_pick_position_high ?? null,
      }
      heroModels.set(hero.name, heroEntry)
      for (const ability of hero.abilities) {
        abilities.set(ability.name, {
          name: ability.name,
          displayName: ability.display_name,
          isUltimate: ability.is_ultimate,
          winrateHigh: ability.winrate_high,
          pickPositionHigh: ability.avg_pick_position_high ?? null,
        })
        abilityToHero.set(ability.name, heroEntry)
      }
    }
    logger.info('Ability data loaded', { abilities: abilities.size, heroes: heroModels.size })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Failed to load ability data — suggestions will be unavailable', { error: message })
  }

  try {
    const pairs: [string, string, number][] = JSON.parse(
      readFileSync(resourcePath('ability_synergies.json'), 'utf-8'),
    )
    for (const [a, b, value] of pairs) synergies.set(synergyKey(a, b), value)
    logger.info('Synergy data loaded', { pairs: synergies.size })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Failed to load synergy data — scores will ignore synergy', { error: message })
  }

  const synergy: SynergyLookup = {
    between: (a, b) => (a === b ? 0 : (synergies.get(synergyKey(a, b)) ?? 0)),
    has: (a, b) => a !== b && synergies.has(synergyKey(a, b)),
  }

  const scoringData: ScoringData = {
    ability: (name) => abilities.get(name),
    model: (heroName) => heroModels.get(heroName),
  }

  return {
    getAbility: (name) => abilities.get(name),
    getHeroModel: (name) => heroModels.get(name),
    getHeroByAbility: (abilityName) => abilityToHero.get(abilityName),
    synergy,
    scoringData,
  }
}
