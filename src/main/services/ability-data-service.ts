import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import log from 'electron-log/main'

// @DEV-GUIDE: Phase-2-lite data layer — just enough to attach real winrates to scan
// results (see docs/plan.md). Loads ad-simulator's own Windrun-sourced
// heroes_abilities.json (shipped as a plain resource file, same pattern as the ONNX
// model in ml-service.ts) into an in-memory Map at startup. No SQLite, no scraper —
// the full data layer (synergy lookups, etc.) is still a separate follow-up.

const logger = log.scope('ability-data')

interface RawAbility {
  name: string
  display_name: string
  is_ultimate: boolean
  winrate_high: number | null
}

interface RawHero {
  name: string
  display_name: string
  abilities: RawAbility[]
  model_winrate_high: number | null
}

export interface AbilityDataEntry {
  name: string
  displayName: string
  isUltimate: boolean
  winrateHigh: number | null
}

export interface HeroModelDataEntry {
  name: string
  displayName: string
  winrateHigh: number | null
}

export interface AbilityDataService {
  getAbility(name: string): AbilityDataEntry | undefined
  getHeroModel(name: string): HeroModelDataEntry | undefined
  /** Owning hero of an ability, by the ability's internal name (e.g.
   * "night_stalker_void" -> hero "night_stalker"). Used to identify a
   * draft-board hero model from its already-classified defining ability,
   * with no image recognition needed. */
  getHeroByAbility(abilityName: string): HeroModelDataEntry | undefined
}

function getDataPath(): string {
  const basePath = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(basePath, 'data', 'heroes_abilities.json')
}

export function createAbilityDataService(): AbilityDataService {
  const abilities = new Map<string, AbilityDataEntry>()
  const heroModels = new Map<string, HeroModelDataEntry>()
  const abilityToHero = new Map<string, HeroModelDataEntry>()

  try {
    const raw: RawHero[] = JSON.parse(readFileSync(getDataPath(), 'utf-8'))
    for (const hero of raw) {
      const heroEntry: HeroModelDataEntry = {
        name: hero.name,
        displayName: hero.display_name,
        winrateHigh: hero.model_winrate_high,
      }
      heroModels.set(hero.name, heroEntry)
      for (const ability of hero.abilities) {
        abilities.set(ability.name, {
          name: ability.name,
          displayName: ability.display_name,
          isUltimate: ability.is_ultimate,
          winrateHigh: ability.winrate_high,
        })
        abilityToHero.set(ability.name, heroEntry)
      }
    }
    logger.info('Ability data loaded', {
      abilities: abilities.size,
      heroes: heroModels.size,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Failed to load ability data — winrates will be unavailable', { error: message })
  }

  return {
    getAbility: (name) => abilities.get(name),
    getHeroModel: (name) => heroModels.get(name),
    getHeroByAbility: (abilityName) => abilityToHero.get(abilityName),
  }
}
