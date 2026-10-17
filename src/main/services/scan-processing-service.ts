import log from 'electron-log/main'
import type { WindowManager } from './window-manager'
import type { AbilityDataService } from './ability-data-service'
import { createDraftTracker } from '@core/draft-tracking/draft-tracker'
import { buildScoreState } from '@core/draft-tracking/score-state'
import type { SeatSlotRead } from '@core/draft-tracking/seat-pick-tracker'
import { rankPicksForSeat, pickBlockedFor, SEAT_COUNT } from '@core/scoring/pick-score'
import { DraftScorer } from '@core/scoring/bot-engine'
import { rankTopCombos, type ComboItem } from '@core/scoring/top-combos'
import { seatMenuBox } from '@core/resolution/seat-menu-box'
import { topCombosBox } from '@core/resolution/top-combos-box'
import type {
  ScanResult,
  ResolutionLayout,
  OverlayDataPayload,
  SeatMenu,
  ComboSuggestion,
} from '@shared/types'
import type { InitialScanResults, PickCandidates } from '@shared/types/ml'

// @DEV-GUIDE: Bridges live ML scans to the overlay. Each scan is folded into a
// reconstruction of the draft (core/draft-tracking: what every seat holds, what is left
// in the pool, how many picks were made), then every seat's best remaining abilities
// are ranked with the ad-simulator's bot scoring (core/scoring/bot-engine) and sent to
// the overlay as one menu per seat. The upstream version this replaces read a DraftStore + DB
// repositories and applied a different scoring system.

const logger = log.scope('scan-processing')

const SUGGESTIONS_PER_SEAT = 5
const TOP_COMBOS_COUNT = 15

function displayNameOf(item: { name: string; kind: 'ability' | 'model' }, abilityData: AbilityDataService): string {
  return (
    (item.kind === 'model'
      ? abilityData.getHeroModel(item.name)?.displayName
      : abilityData.getAbility(item.name)?.displayName) ?? prettifyName(item.name)
  )
}

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

function poolInput(r: ScanResult): {
  hero_order: number
  ability_order: number
  name: string | null
  thumb: Uint8Array | undefined
} {
  return { hero_order: r.hero_order, ability_order: r.ability_order, name: r.name, thumb: r.thumb }
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
  let lastSummaryKey = ''
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
      lastSummaryKey = ''
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
        // Pool boxes judged drafted (or restored) by how they LOOK — logged with the numbers
        // behind the call, since that judgement is the thing to check when a pick is missed.
        for (const event of tracker.drainPoolEvents()) {
          logger.info(`Pool box: ${event.kind}`, {
            name: event.name,
            brightness: event.mean === undefined ? undefined : Math.round(event.mean),
            normalBrightness: event.refMean === undefined ? undefined : Math.round(event.refMean),
            correlation: event.ncc === undefined ? undefined : Number(event.ncc.toFixed(2)),
            boxesDimmedAtOnce: event.count,
          })
        }
        const state = buildScoreState(snapshot, abilityData.scoringData)
        const screenWidth = Number(resolution.split('x')[0])

        const scorer = new DraftScorer(abilityData.engineData, state)
        const seatMenus: SeatMenu[] = []
        for (let seat = 0; seat < SEAT_COUNT; seat++) {
          const box = seatMenuBox(layout, seat, screenWidth)
          if (!box) continue
          // Models and abilities compete directly, exactly as in the simulator.
          const suggestions = rankPicksForSeat(seat, scorer, SUGGESTIONS_PER_SEAT).map((r) => ({
            name: r.item.name,
            displayName: displayNameOf(r.item, abilityData),
            kind: r.item.kind,
            score: r.score,
          }))
          seatMenus.push({ seat, suggestions, ...box })
        }

        // Combos still worth chasing: both halves in the pool, or one half already drafted
        // by a player who has room to take the other.
        const comboItems: ComboItem[] = [
          ...state.available.map((item) => ({
            name: item.name,
            kind: item.kind,
            winrateHigh: item.winrateHigh,
            heldBy: null,
          })),
          ...state.picks.flatMap((items, seat) =>
            items.map((item) => ({
              name: item.name,
              kind: item.kind,
              winrateHigh: item.winrateHigh,
              heldBy: seat,
            })),
          ),
        ]
        const availableByName = new Map(state.available.map((item) => [item.name, item]))
        const canComplete = (seat: number, item: ComboItem): boolean => {
          const scoreItem = availableByName.get(item.name)
          return scoreItem !== undefined && !pickBlockedFor(state.picks, seat, scoreItem)
        }
        const combosBox = topCombosBox(layout, screenWidth)
        const topCombos: OverlayDataPayload['topCombos'] = combosBox
          ? {
              ...combosBox,
              combos: rankTopCombos(comboItems, abilityData.synergy, TOP_COMBOS_COUNT, canComplete).map(
                (r): ComboSuggestion => ({
                  a: {
                    name: r.a.name,
                    kind: r.a.kind,
                    displayName: displayNameOf(r.a, abilityData),
                    heldBy: r.a.heldBy,
                  },
                  b: {
                    name: r.b.name,
                    kind: r.b.kind,
                    displayName: displayNameOf(r.b, abilityData),
                    heldBy: r.b.heldBy,
                  },
                  comboWinrate: r.comboWinrate,
                }),
              ),
            }
          : null

        const payload: OverlayDataPayload = {
          scanned: true,
          seatMenus,
          topCombos,
          pickCount: snapshot.pickIndex,
          modelStatus: {
            read: snapshot.models.length,
            picked: snapshot.models.filter((m) => m.picked).length,
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

        // One info line whenever the reconstructed draft changes (not every scan) — the
        // log is how a live problem like "models aren't being read" gets diagnosed.
        const summary = {
          pickIndex: snapshot.pickIndex,
          modelTiles: scan.modelTiles?.length ?? 0,
          modelsRead: payload.modelStatus.read,
          modelsPicked: payload.modelStatus.picked,
          heldPerSeat: snapshot.seats.map((e) => e.length).join(''),
          seatsWithModel: snapshot.seats
            .map((e, i) => (e.some((x) => x.kind === 'model') ? i : -1))
            .filter((i) => i >= 0)
            .join(','),
        }
        const summaryKey = JSON.stringify(summary)
        if (summaryKey !== lastSummaryKey) {
          lastSummaryKey = summaryKey
          logger.info('Draft state', { ...summary, durationMs: Math.round(performance.now() - start) })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Scan processing failed', { error: message })
        broadcastError(`Scan processing failed: ${message}`)
      }
    },
  }
}
