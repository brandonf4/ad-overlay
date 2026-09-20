import { app, nativeTheme } from 'electron'
import log from 'electron-log/main'
import { createZustandBridge } from '@zubridge/electron/main'
import { createWindowManager } from './services/window-manager'
import { createMlService } from './services/ml-service'
import { createLayoutService } from './services/layout-service'
import { createScreenshotService } from './services/screenshot-service'
import { createCachedWindowCaptureService } from './services/cached-window-capture-service'
import { createScanProcessingService } from './services/scan-processing-service'
import { createAbilityDataService } from './services/ability-data-service'
import { createScanTriggerService } from './services/scan-trigger-service'
import { createWindowTrackerService } from './services/window-tracker-service'
import { createAppStore, createAppStoreHandlers } from './store/app-store'
import { registerIpcHandlers } from './ipc'
import { APP_ID } from '@shared/constants/defaults'

// @DEV-GUIDE: Electron main process entry point — Phase 1 (see the fork's plan doc).
// The upstream version this replaces also initialized a sql.js database, a backup
// service, a Windrun/Liquipedia scraper, a stream server (OBS view + GSI receiver),
// Sentry, an auto-updater, and GSI-driven auto-rescan/spot-detection/slot-mapping.
// All of that is dropped for now: no persisted settings (AppStore just starts at
// its defaults every launch), no personalization, manual scan trigger only.
//
// What's left is the scanning/overlay core: window tracking, screenshot capture,
// the ONNX ability classifier, resolution/layout calibration, and the click-through
// overlay window — proven end-to-end by a manual "Scan" action producing raw
// ability/hero detections in the overlay, with no scoring applied yet.

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.transports.file.maxSize = 10 * 1024 * 1024 // 10MB

const logger = log.scope('main')

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack })
})

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason))
  logger.error('Unhandled rejection', { message: error.message, stack: error.stack })
})

app.whenReady().then(async () => {
  logger.info('=== Ability Draft Overlay (fork) Starting ===')
  logger.info(`Version: ${app.getVersion()}`)
  logger.info(`Platform: ${process.platform} ${process.arch}`)
  logger.info(`Packaged: ${app.isPackaged}`)
  logger.info(`User data: ${app.getPath('userData')}`)

  app.setAppUserModelId(APP_ID)

  if (!app.isPackaged) {
    app.on('browser-window-created', (_, window) => {
      window.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') {
          if (window.webContents.isDevToolsOpened()) {
            window.webContents.closeDevTools()
          } else {
            window.webContents.openDevTools()
          }
          event.preventDefault()
        }
      })
    })
  }

  const windowManager = createWindowManager()
  const mlService = createMlService()
  const layoutService = createLayoutService()
  const screenshotService = createScreenshotService()
  const cachedWindowCapture = createCachedWindowCaptureService(windowManager)
  const windowTracker = createWindowTrackerService()

  const appStore = createAppStore()
  appStore.setState({
    themeMode: 'system',
    resolvedDarkMode: nativeTheme.shouldUseDarkColors,
  })
  nativeTheme.themeSource = 'system'
  nativeTheme.on('updated', () => {
    appStore.setState({ resolvedDarkMode: nativeTheme.shouldUseDarkColors })
  })

  const appHandlers = createAppStoreHandlers(appStore)
  const bridge = createZustandBridge(appStore, { handlers: appHandlers })

  const abilityData = createAbilityDataService()
  const scanProcessingService = createScanProcessingService(windowManager, abilityData)
  const scanTrigger = createScanTriggerService(
    mlService,
    layoutService,
    screenshotService,
    cachedWindowCapture,
    windowManager,
    scanProcessingService,
    appStore,
    windowTracker,
  )

  registerIpcHandlers(
    windowManager,
    mlService,
    layoutService,
    screenshotService,
    appStore,
    bridge,
    windowTracker,
    scanTrigger,
  )

  app.on('before-quit', async () => {
    windowTracker.stopTracking()
    cachedWindowCapture.dispose()
    bridge.destroy()
    await mlService.terminate()
  })

  const cpWin = windowManager.createControlPanelWindow()
  bridge.subscribe([cpWin])

  appStore.setState({ mlStatus: 'initializing', mlError: null })
  mlService
    .initialize()
    .then(() => {
      appStore.setState({ mlStatus: 'ready', mlError: null })
      logger.info('ML Worker initialized successfully')
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('ML auto-init failed', { error: message })
      appStore.setState({ mlStatus: 'error', mlError: message })
    })

  logger.info('Application ready')
})

app.on('window-all-closed', () => {
  logger.info('All windows closed, quitting')
  app.quit()
})
