export interface Hero {
  heroId: number
  name: string
  displayName: string
  winrate: number | null
  highSkillWinrate: number | null
  pickRate: number | null
  hsPickRate: number | null
  windrunId: number | null
}

export interface AbilityDetail {
  abilityId: number
  name: string
  displayName: string
  heroId: number
  winrate: number | null
  highSkillWinrate: number | null
  pickRate: number | null
  hsPickRate: number | null
  isUltimate: boolean
  abilityOrder: number
}

export interface AbilitySynergy {
  synergyId: number
  baseAbilityId: number
  synergyAbilityId: number
  synergyWinrate: number
  synergyIncrease: number | null
  isOp: boolean
}

export interface HeroAbilitySynergy {
  synergyId: number
  heroId: number
  abilityId: number
  synergyWinrate: number
  synergyIncrease: number | null
  isOp: boolean
}

/** Personal (per linked Windrun profile) stats for one ability. */
export interface PersonalAbilityStats {
  games: number
  wins: number
  winrate: number
  avgPickPosition: number | null
}

/** Personal (per linked Windrun profile) stats for one hero model. */
export interface PersonalHeroStats {
  games: number
  wins: number
  winrate: number
}

/** Linked Windrun player profile shown in settings (cached in Metadata). */
export interface PlayerProfileInfo {
  playerId: number
  nickname: string | null
  avatarUrl: string | null
  /** ISO timestamp of the last successful stats fetch, null if never fetched. */
  lastFetchedAt: string | null
}

export interface SystemDisplayInfo {
  width: number
  height: number
  scaleFactor: number
  resolutionString: string
}

export interface AppSettings {
  opThreshold: number
  trapThreshold: number
  language: string
  themeMode: 'light' | 'dark' | 'system'
  overlayOpacity: number
  overlayAnchor: 'left' | 'right'
  streamPort: number
  streamAutostart: boolean
  /** GSI-driven automatic draft tracking (auto initial scan, auto spot/model,
   * turn-driven rescans + pick attribution). Default off. */
  experimentalAutoDraftTracking: boolean
  /** With auto draft tracking on: close the overlay when GSI reports the
   * draft is over, and reopen it at match end or when a new draft starts.
   * Default on (only ever acts while experimentalAutoDraftTracking is on). */
  overlayAutoCloseEnabled: boolean
  /** Seconds to wait after the draft clock is identified before the automatic
   * initial scan (slower PCs need the draft screen fully rendered). */
  autoInitialScanDelayS: number
  /** Role-aware suggestions mode. 'off' (default) keeps scoring bit-identical
   * to the role-less path; 'fixed' scores against roleFixedPositions; 'dynamic'
   * infers the vacant position(s) from teammates' build trajectories. */
  roleMode: 'off' | 'fixed' | 'dynamic'
  /** Fixed-mode position multi-select (values 1-5). Ignored unless roleMode==='fixed'. */
  roleFixedPositions: number[]
  /** Overlay: mark EVERY unpicked ability with a strong Aghanim's Shard /
   * Scepter upgrade (good_shard / good_aghanims tags) with a corner marker +
   * tooltip note. The stacking boost for your own picks is independent of
   * this — it only controls the always-on markers. Applies on the next scan. */
  aghsMarkersEnabled: boolean
}

export interface SlotCoordinate {
  x: number
  y: number
  width: number
  height: number
  hero_order: number
  ability_order?: number
  is_ultimate?: boolean
}

export interface ResolutionLayout {
  heroes_params: { width: number; height: number }
  selected_abilities_params: { width: number; height: number }
  ultimate_slots_coords: SlotCoordinate[]
  standard_slots_coords: SlotCoordinate[]
  selected_abilities_coords?: SlotCoordinate[]
  models_coords?: SlotCoordinate[]
  heroes_coords?: SlotCoordinate[]
}

export interface LayoutCoordinatesConfig {
  resolutions: Record<string, ResolutionLayout>
}

export interface ScanResult {
  name: string | null
  confidence: number
  hero_order: number
  ability_order: number
  is_ultimate: boolean
  coord: SlotCoordinate
  /**
   * Present only when pick-slot template matching REJECTED its best candidate
   * (name === null on a non-empty pick box) — carries what would have matched
   * (and who ran it closest, for margin failures) so the miss is diagnosable
   * from main-process logs.
   */
  rejectedMatch?: {
    bestName: string | null
    secondName: string | null
    margin: number | null
  }
}


// --- Phase 1 (placeholder) overlay payload -----------------------------
// The original upstream types this replaces (EnrichedScanSlot,
// OverlayDataPayload, SynergyPairDisplay, HeroSynergyDisplay,
// HeroModelDisplay, HeroSpotDisplay, RoleContextDisplay, ThirdAbilitySuggestion)
// carried the old scoring/role/personalization system's output shape. This
// fork's own scoring module (Phase 2+) will grow this payload back out as
// needed — for now it's just enough to prove the scan pipeline end-to-end.

export interface DisplayScanSlot extends ScanResult {
  displayName: string
  /** High-skill win rate [0, 1] from ad-simulator's Windrun-sourced data, or
   * null when the slot is unrecognized or missing from that dataset. */
  winrateHigh: number | null
  /** True once the ability has been drafted (its pool box no longer holds it).
   * `name` stays the ability's baseline identity even when picked. */
  picked: boolean
}

/**
 * A hero identified for one of the 12 draft-board model slots — via its
 * hero-defining ability (ability_order === 2), not image recognition. Every
 * hero's abilities are already being classified as part of the normal pool
 * scan, and ability internal names encode their owning hero (e.g.
 * "night_stalker_void" -> hero "night_stalker"), so a plain data lookup is
 * enough. See scan-processing-service.ts.
 */
export interface IdentifiedHeroModel {
  heroOrder: number
  name: string | null
  displayName: string
  winrateHigh: number | null
  confidence: number
  coord: SlotCoordinate
}

export interface OverlayDataPayload {
  scanData: {
    ultimates: DisplayScanSlot[]
    standard: DisplayScanSlot[]
  } | null
  /** Recognized pool slots (ultimates + standard combined), highest win rate
   * first, capped to a fixed list length — see scan-processing-service.ts. */
  topWinratePicks: DisplayScanSlot[]
  /** The 12 draft-board hero models, identified via their defining ability. */
  identifiedHeroModels: IdentifiedHeroModel[]
  targetResolution: string
  scaleFactor: number
}
