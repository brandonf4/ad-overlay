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


// --- Overlay payload ----------------------------------------------------
// The upstream types this replaces (EnrichedScanSlot, the old OverlayDataPayload,
// SynergyPairDisplay, HeroSynergyDisplay, HeroModelDisplay, HeroSpotDisplay,
// RoleContextDisplay, ThirdAbilitySuggestion) carried the old scoring/role/
// personalization system's output. This fork's payload is just the per-seat pick
// suggestions produced by core/scoring (see scan-processing-service.ts).

/** One suggested ability for a seat. Lower score = better (see core/scoring). */
export interface SeatSuggestion {
  name: string
  displayName: string
  score: number
}

export interface SeatMenu {
  /** Player row 0-9: 0-4 the left (Radiant) column, 5-9 the right (Dire) column. */
  seat: number
  /** Best options for this seat right now, best first. */
  suggestions: SeatSuggestion[]
  /** Where the menu sits, in layout pixels (divide by scaleFactor at render). */
  x: number
  y: number
  width: number
  height: number
}

export interface OverlayDataPayload {
  /** False until the first live scan completes. */
  scanned: boolean
  seatMenus: SeatMenu[]
  /** Picks made so far in the draft (0-50), across both teams. */
  pickCount: number
  targetResolution: string
  scaleFactor: number
}
