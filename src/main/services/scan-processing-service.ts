import log from 'electron-log/main'
import type { WindowManager } from './window-manager'
import type { ScanResult, DisplayScanSlot, OverlayDataPayload } from '@shared/types'
import type { InitialScanResults } from '@shared/types/ml'

// @DEV-GUIDE: Phase-1 placeholder — bridges raw ML scan results to the overlay UI
// with NO scoring applied yet (see the fork's plan doc). The upstream version this
// replaces read DraftStore + DB repositories and delegated to a pure domain
// scoring function; this one just prettifies names and passes coordinates through,
// so the kept scanning/overlay pipeline can be proven end-to-end before the new
// scoring module (Phase 2) and real UI (Phase 3) exist.

const logger = log.scope('scan-processing')

export interface ScanProcessingService {
  handleScanResults(
    results: InitialScanResults,
    resolution: string,
    scaleFactor: number,
  ): void
}

// "night_stalker_void" -> "Night Stalker Void". Good enough for a placeholder
// label; a real ability/hero name lookup arrives with the Phase 2 data layer.
function prettifyName(name: string | null): string {
  if (!name) return 'Unknown'
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function toDisplaySlot(result: ScanResult): DisplayScanSlot {
  return { ...result, displayName: prettifyName(result.name) }
}

export function createScanProcessingService(
  windowManager: WindowManager,
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
        const payload: OverlayDataPayload = {
          scanData: {
            ultimates: results.ultimates.map(toDisplaySlot),
            standard: results.standard.map(toDisplaySlot),
          },
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
