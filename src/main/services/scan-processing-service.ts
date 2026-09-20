import log from 'electron-log/main'
import type { WindowManager } from './window-manager'
import type { AbilityDataService } from './ability-data-service'
import type { ScanResult, DisplayScanSlot, OverlayDataPayload } from '@shared/types'
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

function toDisplaySlot(result: ScanResult, abilityData: AbilityDataService): DisplayScanSlot {
  const entry = result.name ? abilityData.getAbility(result.name) : undefined
  return {
    ...result,
    displayName: entry?.displayName ?? prettifyName(result.name),
    winrateHigh: entry?.winrateHigh ?? null,
  }
}

function topWinratePicks(slots: DisplayScanSlot[]): DisplayScanSlot[] {
  return slots
    .filter((s) => s.name !== null && s.winrateHigh !== null)
    .sort((a, b) => (b.winrateHigh as number) - (a.winrateHigh as number))
    .slice(0, TOP_WINRATE_PICKS_COUNT)
}

export interface ScanProcessingService {
  handleScanResults(
    results: InitialScanResults,
    resolution: string,
    scaleFactor: number,
  ): void
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

  return {
    handleScanResults(results, resolution, scaleFactor) {
      const start = performance.now()
      try {
        const ultimates = results.ultimates.map((r) => toDisplaySlot(r, abilityData))
        const standard = results.standard.map((r) => toDisplaySlot(r, abilityData))

        const payload: OverlayDataPayload = {
          scanData: { ultimates, standard },
          topWinratePicks: topWinratePicks([...ultimates, ...standard]),
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
