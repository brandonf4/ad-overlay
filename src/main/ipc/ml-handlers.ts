import { ipcMain } from 'electron'
import log from 'electron-log/main'
import type { MlService } from '../services/ml-service'
import type { ScanTriggerService } from '../services/scan-trigger-service'
import type { AppStore } from '../store/app-store'

// @DEV-GUIDE: ML domain IPC handlers, Phase 1 (initial-scan-only — see scan-trigger-service.ts).
// The upstream version this replaces also had ml:getModelGaps/ml:exportModelGaps (DB-dependent
// staleness reporting) — dropped along with the DB layer; reintroduce once there's a real data
// layer to check the model's class list against.
// - ml:init (handle): Explicit re-init from UI retry button. Sets mlStatus in AppStore.
// - ml:startLive / ml:stopLive (on/fire-and-forget): Start/stop the repeating scan loop in
//   ScanTriggerService. Also stopped when the overlay closes (see ipc/index.ts).

const logger = log.scope('ipc-ml')

export function registerMlHandlers(
  mlService: MlService,
  scanTrigger: ScanTriggerService,
  appStore: AppStore,
): void {
  ipcMain.handle('ml:init', async () => {
    try {
      appStore.setState({ mlStatus: 'initializing', mlError: null })
      await mlService.initialize()
      appStore.setState({ mlStatus: 'ready', mlError: null })
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('ML init failed', { error: message })
      appStore.setState({ mlStatus: 'error', mlError: message })
      return { success: false, error: message }
    }
  })

  ipcMain.on('ml:startLive', () => scanTrigger.startLive())
  ipcMain.on('ml:stopLive', () => scanTrigger.stopLive())
}
