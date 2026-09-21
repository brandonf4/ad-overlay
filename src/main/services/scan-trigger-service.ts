import { screen } from 'electron'
import sharp from 'sharp'
import log from 'electron-log/main'
import { GAME_WINDOW_TITLE } from './window-tracker-service'
import type { MlService } from './ml-service'
import type { LayoutService } from './layout-service'
import type { ScreenshotService } from './screenshot-service'
import type { CachedWindowCaptureService } from './cached-window-capture-service'
import type { DecodedScreenshot } from '@core/ml/preprocessing'
import type { WindowManager } from './window-manager'
import type { ScanProcessingService } from './scan-processing-service'
import type { WindowTrackerService } from './window-tracker-service'
import type { AppStore } from '../store/app-store'
import type { InitialScanResults } from '@shared/types/ml'
import type { ScanResult } from '@shared/types'

// @DEV-GUIDE: Live scan pipeline. Every scan captures ONE screenshot and reads it twice:
// the pool grid (ultimates + standard, an "initial"-type scan: also yields the model
// tiles) and the 10 player rows' pick boxes (a rescan-type scan: template-matched
// against the cached official icons). ScanProcessingService folds both into the draft
// state. The original upstream service also did pool retries, OCR, GSI-driven rescans
// and feedback snapshots — dropped; this fork just polls (see startLive).
// Pipeline: capture (raw RGB, no PNG round-trip) -> (lazy ML init) -> layout ->
// crop to game window -> pool scan + rows scan -> broadcast raw results ->
// ScanProcessingService.

const logger = log.scope('scan-trigger')

// Pause between the end of one live scan and the start of the next. A pick shows up on
// the board within a couple of seconds either way; this keeps CPU use low.
const LIVE_SCAN_INTERVAL_MS = 1500

export interface ScanTriggerService {
  performScan(): Promise<void>
  /** Scan repeatedly (and reset pick tracking) until stopLive() or the overlay closes. */
  startLive(): void
  stopLive(): void
}

export function createScanTriggerService(
  mlService: MlService,
  layoutService: LayoutService,
  screenshotService: ScreenshotService,
  cachedWindowCapture: CachedWindowCaptureService,
  windowManager: WindowManager,
  scanProcessingService: ScanProcessingService,
  appStore: AppStore,
  windowTracker: WindowTrackerService,
): ScanTriggerService {
  // Bumped on every start/stop so a scan still in flight from an earlier loop can't
  // schedule another iteration after it was stopped or restarted.
  let liveGeneration = 0
  let liveTimer: ReturnType<typeof setTimeout> | null = null

  function stopLive(): void {
    liveGeneration += 1
    if (liveTimer) {
      clearTimeout(liveTimer)
      liveTimer = null
    }
  }

  const service: ScanTriggerService = {
    startLive(): void {
      stopLive()
      scanProcessingService.reset()
      const generation = liveGeneration
      const tick = async (): Promise<void> => {
        if (generation !== liveGeneration) return
        if (!appStore.getState().activeResolution) {
          stopLive()
          return
        }
        await service.performScan()
        if (generation !== liveGeneration) return
        liveTimer = setTimeout(() => void tick(), LIVE_SCAN_INTERVAL_MS)
      }
      void tick()
    },
    stopLive,
    async performScan(): Promise<void> {
      try {
        const resolution = appStore.getState().activeResolution
        if (!resolution) {
          sendScanResults(windowManager, {
            error: 'No active resolution — overlay may not be activated',
          })
          return
        }

        if (!mlService.isReady()) {
          try {
            appStore.setState({ mlStatus: 'initializing', mlError: null })
            await mlService.initialize()
            appStore.setState({ mlStatus: 'ready', mlError: null })
          } catch (initError) {
            const msg = initError instanceof Error ? initError.message : String(initError)
            logger.error('ML lazy init failed', { error: msg })
            appStore.setState({ mlStatus: 'error', mlError: msg })
            sendScanResults(windowManager, {
              error: 'ML Worker failed to initialize: ' + msg,
            })
            return
          }
        }

        appStore.setState({ mlStatus: 'scanning' })

        const primary = screen.getPrimaryDisplay()
        const physicalScreen = {
          width: Math.round(primary.size.width * primary.scaleFactor),
          height: Math.round(primary.size.height * primary.scaleFactor),
        }
        const gameBounds = windowTracker.getGameWindowPhysicalBounds()
        const isFullscreen =
          !gameBounds ||
          (gameBounds.width >= physicalScreen.width &&
            gameBounds.height >= physicalScreen.height)

        let screenshot: DecodedScreenshot | null = null
        if (isFullscreen) {
          screenshot = await cachedWindowCapture.captureFrame(
            GAME_WINDOW_TITLE,
            physicalScreen,
          )
          screenshot ??= await screenshotService.captureWindow(
            GAME_WINDOW_TITLE,
            physicalScreen,
          )
        }
        screenshot ??= await screenshotService.capture()

        const layout = layoutService.getLayout(resolution)
        if (!layout) {
          sendScanResults(windowManager, {
            error: `No layout coordinates for resolution: ${resolution}`,
          })
          appStore.setState({ mlStatus: 'ready' })
          return
        }

        if (
          gameBounds &&
          (gameBounds.width < screenshot.width ||
            gameBounds.height < screenshot.height)
        ) {
          const cropped = await sharp(screenshot.data, {
            raw: {
              width: screenshot.width,
              height: screenshot.height,
              channels: 3,
            },
          })
            .extract({
              left: gameBounds.x,
              top: gameBounds.y,
              width: gameBounds.width,
              height: gameBounds.height,
            })
            .raw()
            .toBuffer()
          screenshot = {
            data: cropped,
            width: gameBounds.width,
            height: gameBounds.height,
          }
        }

        // The worker handles one request at a time, so these run back to back on the
        // same screenshot (its buffer is copied per call).
        const poolScan = await mlService.scan(screenshot, layout, true)
        const rowsScan = await mlService.scan(
          screenshot,
          layout,
          false,
          undefined,
          undefined,
          scanProcessingService.pickCandidates(),
        )

        appStore.setState({ mlStatus: 'ready' })

        sendScanResults(windowManager, {
          results: poolScan.results,
          isInitialScan: poolScan.isInitialScan,
        })

        // poolScan is an initial-type scan and rowsScan a rescan-type one, so the
        // result unions on MlWorkerSuccessResponse narrow as below.
        scanProcessingService.handleScan(
          {
            pool: poolScan.results as InitialScanResults,
            rows: rowsScan.results as ScanResult[],
            modelTiles: poolScan.modelTiles,
          },
          resolution,
          layoutService.getScaleFactor(),
          layout,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Scan failed', { error: message })
        appStore.setState({ mlStatus: 'ready' })
        sendScanResults(windowManager, { error: message })
      }
    },
  }
  return service
}

// @DEV-GUIDE: Broadcasts raw ML results to both windows. Control panel uses this for status/debug
// display. Overlay uses it for scan-in-progress feedback. Separate from overlay:data (enriched).
function sendScanResults(
  windowManager: WindowManager,
  data: {
    error?: string
    results?: unknown
    isInitialScan?: boolean
  },
): void {
  const cp = windowManager.getControlPanelWindow()
  const overlay = windowManager.getOverlayWindow()
  if (cp && !cp.isDestroyed()) {
    cp.webContents.send('ml:scanResults', data)
  }
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('ml:scanResults', data)
  }
}
