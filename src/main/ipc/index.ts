import { ipcMain, nativeTheme, screen, app, shell } from 'electron'
import log from 'electron-log/main'
import type { WindowManager } from '../services/window-manager'
import type { MlService } from '../services/ml-service'
import type { LayoutService } from '../services/layout-service'
import type { ScreenshotService } from '../services/screenshot-service'
import type { WindowTrackerService } from '../services/window-tracker-service'
import type { AppStore } from '../store/app-store'
import type { ZustandBridge } from '@zubridge/electron/main'
import { registerMlHandlers } from './ml-handlers'
import { registerResolutionHandlers } from './resolution-handlers'
import { loadApiConfig } from '../services/api-config'
import type { ScanTriggerService } from '../services/scan-trigger-service'
import type { OverlayDataPayload, LayoutSource } from '@shared/types'

// @DEV-GUIDE: Central IPC handler registration, Phase 1. The upstream version this
// replaces also wired in database/player/scraper/stream/feedback/dev-control/draft
// (My Spot/My Model) handlers and GSI-driven overlay auto-close/open — all dropped
// along with the services they depended on (see the fork's plan doc). What's left:
// app info, theme, manual overlay activate/close/mouse-passthrough, ML scan trigger,
// and the resolution/calibration domain (kept pipeline infrastructure).

const logger = log.scope('ipc')

export function registerIpcHandlers(
  windowManager: WindowManager,
  mlService: MlService,
  layoutService: LayoutService,
  screenshotService: ScreenshotService,
  appStore: AppStore,
  bridge: ZustandBridge,
  windowTracker: WindowTrackerService,
  scanTrigger: ScanTriggerService,
): void {
  logger.info('Registering IPC handlers...')

  // App domain
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:isPackaged', () => app.isPackaged)
  ipcMain.handle('app:getSystemInfo', () => {
    const primaryDisplay = screen.getPrimaryDisplay()
    return {
      width: primaryDisplay.size.width,
      height: primaryDisplay.size.height,
      scaleFactor: primaryDisplay.scaleFactor,
      resolutionString: `${primaryDisplay.size.width}x${primaryDisplay.size.height}`,
    }
  })
  ipcMain.handle('theme:get', () => ({
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  }))
  ipcMain.on('app:openExternal', (_event, data: { url: string }) => {
    try {
      const url = new URL(data.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        shell.openExternal(data.url)
      } else {
        logger.warn('Blocked opening non-HTTP URL', { url: data.url })
      }
    } catch {
      logger.warn('Invalid URL', { url: data.url })
    }
  })

  // Overlay domain
  let pendingOverlayData: OverlayDataPayload | null = null

  ipcMain.handle('overlay:getInitialData', () => pendingOverlayData)

  function activateOverlay(): {
    success: boolean
    resolution?: string
    source?: LayoutSource
    error?: string
  } {
    const primaryDisplay = screen.getPrimaryDisplay()
    const gameBounds = windowTracker.getGameWindowPhysicalBounds()
    const resolution = gameBounds
      ? `${gameBounds.width}x${gameBounds.height}`
      : `${Math.round(primaryDisplay.size.width * primaryDisplay.scaleFactor)}x${Math.round(primaryDisplay.size.height * primaryDisplay.scaleFactor)}`

    const source = layoutService.getLayoutSource(resolution)
    const coords = layoutService.getLayout(resolution)

    if (!coords) {
      logger.warn('No layout coordinates for auto-detected resolution', { resolution, source })
      return {
        success: false,
        error: `Unsupported resolution: ${resolution}. No layout coordinates available.`,
      }
    }

    const controlPanel = windowManager.getControlPanelWindow()
    if (controlPanel && !controlPanel.isDestroyed()) {
      controlPanel.minimize()
    }

    const overlayWin = windowManager.createOverlayWindow()
    bridge.subscribe([overlayWin])
    appStore.setState({
      overlayActive: true,
      activeResolution: resolution,
      activeResolutionSource: source,
    })

    const scaleFactor = layoutService.getScaleFactor()
    pendingOverlayData = {
      scanData: null,
      targetResolution: resolution,
      scaleFactor,
    }

    const displayBounds = primaryDisplay.bounds
    windowTracker.startTracking((trackBounds) => {
      if (
        trackBounds &&
        (trackBounds.width < displayBounds.width || trackBounds.height < displayBounds.height)
      ) {
        windowManager.repositionOverlay(trackBounds)
      } else {
        windowManager.repositionOverlay(displayBounds)
      }
    })

    overlayWin.on('closed', () => {
      windowTracker.stopTracking()
      appStore.setState({
        overlayActive: false,
        activeResolution: null,
        activeResolutionSource: null,
      })
      pendingOverlayData = null

      const cp = windowManager.getControlPanelWindow()
      if (cp && !cp.isDestroyed()) {
        cp.restore()
        cp.focus()
      }
    })

    logger.info('Overlay activated with auto-detected resolution', { resolution, source })
    return { success: true, resolution, source }
  }

  ipcMain.handle('overlay:activate', () => activateOverlay())

  ipcMain.on('overlay:close', () => {
    windowTracker.stopTracking()
    windowManager.closeOverlay()
    appStore.setState({ overlayActive: false, activeResolution: null, activeResolutionSource: null })
  })

  ipcMain.on(
    'overlay:setMouseIgnore',
    (_event, data: { ignore: boolean; forward?: boolean }) => {
      windowManager.setOverlayMouseEvents(data.ignore, data.forward ?? true)
    },
  )

  const apiConfig = loadApiConfig()

  // ML domain
  registerMlHandlers(mlService, scanTrigger, appStore)

  // Resolution domain
  registerResolutionHandlers(layoutService, screenshotService, windowTracker, windowManager, apiConfig)

  logger.info('IPC handlers registered')
}
