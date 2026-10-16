import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import log from 'electron-log/main'
import type { SynergyLookup } from '@core/scoring/pick-score'
import type { EngineData } from '@core/scoring/bot-engine'
import { buildEngineData, type RawEngineFiles } from '@core/scoring/engine-data'
import type { ScoringData } from '@core/draft-tracking/score-state'

// @DEV-GUIDE: In-memory data layer for the pick scoring. Loads ad-simulator's own
// data files, shipped as plain resources (same pattern as the ONNX model in
// ml-service.ts): heroes_abilities.json (per-ability and per-hero-model win rate and
// average pick position), ability_synergies.json (pairwise synergy values, keyed by
// ability or hero-model internal name) and the bot engine's tuning data
// (synergy_overrides, model_ability_shifts, ability_strength, role_skew, aghs_upgrades;
// see core/scoring/engine-data.ts). Refresh all of them from the simulator's public/
// folder together. No SQLite, no scraper.

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
  readonly engineData: EngineData
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

  // A missing optional file just leaves that term out, like the simulator's fetch fallbacks.
  const readOptional = <T>(file: string): T | undefined => {
    try {
      return JSON.parse(readFileSync(resourcePath(file), 'utf-8')) as T
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to load ${file} — scores will leave out what it feeds`, {
        error: message,
      })
      return undefined
    }
  }
  const engineData = buildEngineData({
    synergies: readOptional<RawEngineFiles['synergies']>('ability_synergies.json') ?? [],
    overrides: readOptional('synergy_overrides.json'),
    shifts: readOptional('model_ability_shifts.json'),
    strength: readOptional('ability_strength.json'),
    roles: readOptional('role_skew.json'),
    upgrades: readOptional('aghs_upgrades.json'),
  })
  logger.info('Scoring data loaded', { pairs: engineData.synergy.size })

  // Known pair data (windrun with the site's baked edits), for the top-combos list.
  // Blanket model estimates are left out, as the simulator doesn't treat them as known.
  const known = (a: string, b: string): boolean => {
    const key = synergyKey(a, b)
    return a !== b && engineData.synergy.has(key) && !engineData.bakedEstimated.has(key)
  }
  const synergy: SynergyLookup = {
    between: (a, b) => (known(a, b) ? (engineData.synergy.get(synergyKey(a, b)) as number) : 0),
    has: known,
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
    engineData,
    scoringData,
  }
}
