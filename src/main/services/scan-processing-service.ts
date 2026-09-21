import log from 'electron-log/main'
import type { WindowManager } from './window-manager'
import type { AbilityDataService } from './ability-data-service'
import { createDraftTracker } from '@core/draft-tracking/draft-tracker'
import { buildScoreState } from '@core/draft-tracking/score-state'
import type { SeatSlotRead } from '@core/draft-tracking/seat-pick-tracker'
import { rankPicksForSeat, SEAT_COUNT } from '@core/scoring/pick-score'
import { seatMenuBox } from '@core/resolution/seat-menu-box'
import type { ScanResult, ResolutionLayout, OverlayDataPayload, SeatMenu } from '@shared/types'
import type { InitialScanResults, PickCandidates } from '@shared/types/ml'

// @DEV-GUIDE: Bridges live ML scans to the overlay. Each scan is folded into a
// reconstruction of the draft (core/draft-tracking: what every seat holds, what is left
// in the pool, how many picks were made), then every seat's best remaining abilities
// are ranked with the ad-simulator's pick score (core/scoring) and sent to the overlay
// as one menu per seat. The upstream version this replaces read a DraftStore + DB
// repositories and applied a different scoring system.

const logger = log.scope('scan-processing')

const SUGGESTIONS_PER_SEAT = 5

// "night_stalker_void" -> "Night Stalker Void". Fallback for anything the data file
// doesn't have an entry for (e.g. a very new patch).
function prettifyName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** One live scan: the pool grid, the 10 player rows' pick boxes, and the model tiles. */
export interface LiveScan {
  pool: InitialScanResults
  rows: ScanResult[]
  modelTiles?: { heroOrder: number; tile: ArrayBuffer }[]
}

function poolInput(r: ScanResult): { hero_order: number; ability_order: number; name: string | null } {
  return { hero_order: r.hero_order, ability_order: r.ability_order, name: r.name }
}

// Pick boxes come back as flat results; a row's boxes read left to right as
// 3 basics then the ultimate, so the slot index is the box's order within its row.
function toSeatSlotReads(rows: ScanResult[]): SeatSlotRead[] {
  const bySeat = new Map<number, ScanResult[]>()
  for (const r of rows) {
    if (r.hero_order < 0 || r.hero_order >= SEAT_COUNT) continue
    const list = bySeat.get(r.hero_order) ?? []
    list.push(r)
    bySeat.set(r.hero_order, list)
  }
  const reads: SeatSlotRead[] = []
  for (const [seat, list] of bySeat) {
    list.sort((a, b) => a.coord.x - b.coord.x)
    list.forEach((r, slot) => reads.push({ seat, slot, name: r.name }))
  }
  return reads
}

export interface ScanProcessingService {
  handleScan(
    scan: LiveScan,
    resolution: string,
    scaleFactor: number,
    layout: ResolutionLayout,
  ): void
  /** Names each pick box can hold, for scoping the next player-rows scan. */
  pickCandidates(): PickCandidates
  /** Forget the draft — call when a new live scan begins. */
  reset(): void
}

export function createScanProcessingService(
  windowManager: WindowManager,
  abilityData: AbilityDataService,
): ScanProcessingService {
  const tracker = createDraftTracker((abilityName) => abilityData.getHeroByAbility(abilityName)?.name ?? null)

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
    reset() {
      tracker.reset()
    },
    pickCandidates() {
      return tracker.pickCandidates()
    },
    handleScan(scan, resolution, scaleFactor, layout) {
      const start = performance.now()
      try {
        const snapshot = tracker.update({
          // Which list a box came from is authoritative for ultimate vs. basic — the
          // layout's ultimate boxes don't reliably carry an is_ultimate flag.
          pool: [
            ...scan.pool.ultimates.map((r) => ({ ...poolInput(r), is_ultimate: true })),
            ...scan.pool.standard.map((r) => ({ ...poolInput(r), is_ultimate: false })),
          ],
          seatSlots: toSeatSlotReads(scan.rows),
          modelTiles: scan.modelTiles
            ? scan.modelTiles.map((t) => ({ heroOrder: t.heroOrder, tile: new Uint8Array(t.tile) }))
            : null,
        })
        const state = buildScoreState(snapshot, abilityData.scoringData)
        const screenWidth = Number(resolution.split('x')[0])

        const seatMenus: SeatMenu[] = []
        for (let seat = 0; seat < SEAT_COUNT; seat++) {
          const box = seatMenuBox(layout, seat, screenWidth)
          if (!box) continue
          const suggestions = rankPicksForSeat(
            seat,
            state,
            abilityData.synergy,
            SUGGESTIONS_PER_SEAT,
            'ability',
          ).map((r) => ({
            name: r.item.name,
            displayName: abilityData.getAbility(r.item.name)?.displayName ?? prettifyName(r.item.name),
            score: r.score,
          }))
          seatMenus.push({ seat, suggestions, ...box })
        }

        const payload: OverlayDataPayload = {
          scanned: true,
          seatMenus,
          pickCount: snapshot.pickIndex,
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

        logger.debug('Scan processed', {
          pickIndex: snapshot.pickIndex,
          durationMs: Math.round(performance.now() - start),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Scan processing failed', { error: message })
        broadcastError(`Scan processing failed: ${message}`)
      }
    },
  }
}
