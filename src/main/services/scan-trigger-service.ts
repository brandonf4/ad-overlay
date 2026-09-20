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

// @DEV-GUIDE: Phase-1 scan pipeline — deliberately trimmed to an INITIAL-SCAN-ONLY
// flow while the suggestion/UI layers are being rebuilt (see the fork's plan doc).
// The original upstream service also supported rescans (pick-slot template
// matching, pool retry, OCR, feedback snapshots) — all of that depended on either
// the old DB/domain layer or state this fork doesn't track yet. Re-add rescanning
// once "my picks so far" is actually tracked (Phase 2+), following the same
// capture -> layout -> ml scan -> handoff shape as here.
// Pipeline: capture (raw RGB, no PNG round-trip) -> (lazy ML init) -> layout ->
// crop to game window -> inference -> broadcast raw results -> ScanProcessingService.

const logger = log.scope('scan-trigger')

export interface ScanTriggerService {
  performScan(): Promise<void>
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
  return {
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

        const result = await mlService.scan(screenshot, layout, true)

        appStore.setState({ mlStatus: 'ready' })

        sendScanResults(windowManager, {
          results: result.results,
          isInitialScan: result.isInitialScan,
        })

        const scaleFactor = layoutService.getScaleFactor()
        // Phase 1 only ever requests an initial scan (see the top-of-file note), so
        // result.results is always the InitialScanResults shape here — the union with
        // ScanResult[] on MlWorkerSuccessResponse only applies to the rescan path.
        scanProcessingService.handleScanResults(
          result.results as InitialScanResults,
          resolution,
          scaleFactor,
          layout.models_coords ?? [],
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Scan failed', { error: message })
        appStore.setState({ mlStatus: 'ready' })
        sendScanResults(windowManager, { error: message })
      }
    },
  }
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
