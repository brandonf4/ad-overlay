import { synergyKeyFor, type EngineData, type Role, type UpgradeEntry } from './bot-engine'

// @DEV-GUIDE: Builds the bot engine's data from ad-simulator's own data files, the same
// way the simulator's loadData() does. The files ship in resources/data (copied from the
// simulator's public/ folder; refresh them together when the site's data changes).
// Pure logic, no Electron or fs imports: callers read and JSON.parse the files.

export interface RawEngineFiles {
  /** ability_synergies.json: [nameA, nameB, synergy] triples from windrun. */
  synergies: [string, string, number][]
  /** synergy_overrides.json. */
  overrides?: { overrides?: Record<string, number>; estimated?: Record<string, number> }
  /** model_ability_shifts.json. */
  shifts?: {
    heroes?: Record<string, [string, string]>
    abilities?: Record<string, Record<string, number>>
  }
  /** ability_strength.json. */
  strength?: { value?: Record<string, number> }
  /** role_skew.json. */
  roles?: { abilities?: Record<string, Partial<Record<Role, number>>> }
  /** aghs_upgrades.json. */
  upgrades?: { scepter?: Record<string, UpgradeEntry>; shard?: Record<string, UpgradeEntry> }
}

export function buildEngineData(files: RawEngineFiles): EngineData {
  const synergy = new Map(files.synergies.map(([a, b, s]) => [synergyKeyFor(a, b), s]))
  // Edits baked into the site replace windrun's values (simulator loadData()).
  for (const [key, v] of Object.entries(files.overrides?.overrides ?? {})) synergy.set(key, v)
  return {
    synergy,
    bakedEstimated: new Map(Object.entries(files.overrides?.estimated ?? {})),
    modelTypes: new Map(Object.entries(files.shifts?.heroes ?? {})),
    modelShifts: files.shifts?.abilities ?? {},
    value: files.strength?.value ?? {},
    role: files.roles?.abilities ?? {},
    upgrades: { scepter: files.upgrades?.scepter ?? {}, shard: files.upgrades?.shard ?? {} },
  }
}
