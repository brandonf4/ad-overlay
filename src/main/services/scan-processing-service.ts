import log from 'electron-log/main'
import type { WindowManager } from './window-manager'
import type { AbilityDataService } from './ability-data-service'
import {
  createPoolTracker,
  poolSlotKey,
  type TrackedPoolSlot,
} from '@core/draft-tracking/pool-tracker'
import type {
  ScanResult,
  SlotCoordinate,
  DisplayScanSlot,
  IdentifiedHeroModel,
  OverlayDataPayload,
} from '@shared/types'
import type { InitialScanResults } from '@shared/types/ml'

// @DEV-GUIDE: Phase-1 placeholder — bridges raw ML scan results to the overlay UI
// (see the fork's plan doc). The upstream version this replaces read DraftStore + DB
// repositories and delegated to a pure domain scoring function; this one attaches a
// real winrate per slot via AbilityDataService (ad-simulator's own Windrun-sourced
// data — see ability-data-service.ts) and ranks by it, but does none of the
// synergy/role/personalization scoring the old system did. That's still Phase 2+.

const logger = log.scope('scan-processing')

// How many recognized slots to surface in the "highest winrate" list.
const TOP_WINRATE_PICKS_COUNT = 8

// "night_stalker_void" -> "Night Stalker Void". Fallback for anything the data
// file doesn't have an entry for (recognized by the classifier but not in
// ad-simulator's dataset yet — e.g. a very new patch).
function prettifyName(name: string | null): string {
  if (!name) return 'Unknown'
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// The slot's identity comes from the tracker (its baseline read), not this scan's read:
// once an ability is picked its pool box is empty and would otherwise read Unknown.
function toDisplaySlot(
  result: ScanResult,
  tracked: TrackedPoolSlot | undefined,
  abilityData: AbilityDataService,
): DisplayScanSlot {
  const name = tracked ? tracked.name : result.name
  const entry = name ? abilityData.getAbility(name) : undefined
  return {
    ...result,
    name,
    displayName: entry?.displayName ?? prettifyName(name),
    winrateHigh: entry?.winrateHigh ?? null,
    picked: tracked?.picked ?? false,
  }
}

function topWinratePicks(slots: DisplayScanSlot[]): DisplayScanSlot[] {
  return slots
    .filter((s) => !s.picked && s.name !== null && s.winrateHigh !== null)
    .sort((a, b) => (b.winrateHigh as number) - (a.winrateHigh as number))
    .slice(0, TOP_WINRATE_PICKS_COUNT)
}

// Each hero's ability at ability_order === 2 is already classified as part of the normal
// pool scan; its internal name encodes the owning hero, so identifying the hero model in
// the same column (hero_order) is a plain lookup — no image recognition of the model tile.
function identifyHeroModels(
  heroDefiningAbilities: ScanResult[],
  modelCoords: SlotCoordinate[],
  abilityData: AbilityDataService,
): IdentifiedHeroModel[] {
  const byHeroOrder = new Map<number, ScanResult>()
  for (const ability of heroDefiningAbilities) {
    if (ability.name) byHeroOrder.set(ability.hero_order, ability)
  }

  return modelCoords.map((coord) => {
    const ability = byHeroOrder.get(coord.hero_order)
    const hero = ability?.name ? abilityData.getHeroByAbility(ability.name) : undefined
    return {
      heroOrder: coord.hero_order,
      name: hero?.name ?? null,
      displayName: hero?.displayName ?? 'Unknown Hero',
      winrateHigh: hero?.winrateHigh ?? null,
      confidence: hero && ability ? ability.confidence : 0,
      coord,
    }
  })
}

export interface ScanProcessingService {
  handleScanResults(
    results: InitialScanResults,
    resolution: string,
    scaleFactor: number,
    modelCoords: SlotCoordinate[],
  ): void
  /** Forget which abilities were seen/picked — call when a new live scan begins. */
  reset(): void
}

export function createScanProcessingService(
  windowManager: WindowManager,
  abilityData: AbilityDataService,
): ScanProcessingService {
  function broadcastError(message: string): void {
    const payload = { error: message }
    const overlay = windowManager.getOverlayWindow()
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('ml:scanResults', payload)
    }
    const cp = windowManager.getControlPanelWindow()
    if (cp && !cp.isDestroyed()) {
      cp.webContents.send('ml:scanResults', payload)
    }
  }

  const poolTracker = createPoolTracker()

  return {
    reset() {
      poolTracker.reset()
    },
    handleScanResults(results, resolution, scaleFactor, modelCoords) {
      const start = performance.now()
      try {
        const tracked = poolTracker.update(
          [...results.ultimates, ...results.standard].map((r) => ({
            key: poolSlotKey(r),
            name: r.name,
          })),
        )
        const ultimates = results.ultimates.map((r) =>
          toDisplaySlot(r, tracked.get(poolSlotKey(r)), abilityData),
        )
        const standard = results.standard.map((r) =>
          toDisplaySlot(r, tracked.get(poolSlotKey(r)), abilityData),
        )
        // Hero identity must survive the defining ability being picked, so it is
        // read from the tracked baseline rather than this scan's (possibly empty) box.
        const heroDefiningAbilities = results.heroDefiningAbilities.map((r) => ({
          ...r,
          name: tracked.has(poolSlotKey(r)) ? (tracked.get(poolSlotKey(r))?.name ?? null) : r.name,
        }))

        const payload: OverlayDataPayload = {
          scanData: { ultimates, standard },
          topWinratePicks: topWinratePicks([...ultimates, ...standard]),
          identifiedHeroModels: identifyHeroModels(heroDefiningAbilities, modelCoords, abilityData),
          targetResolution: resolution,
          scaleFactor,
        }

        const overlay = windowManager.getOverlayWindow()
        if (overlay && !overlay.isDestroyed()) {
          overlay.webContents.send('overlay:data', payload)
          windowManager.refreshOverlayMouseEvents()
        }

        const cp = windowManager.getControlPanelWindow()
        if (cp && !cp.isDestroyed()) {
          cp.webContents.send('overlay:data', payload)
        }

        const durationMs = Math.round(performance.now() - start)
        logger.info('Scan processing complete', { durationMs })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Scan processing failed', { error: message })
        broadcastError(`Scan processing failed: ${message}`)
      }
    },
  }
}
