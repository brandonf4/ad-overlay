import { useState, useEffect, useRef } from 'react'
import type { OverlayDataPayload } from '@shared/types'

// Safety net: if main never responds (hung ML init, dead worker), unstick the UI.
const SCAN_TIMEOUT_MS = 30_000

// @DEV-GUIDE: Phase-1 overlay state hook — trimmed to just what a placeholder
// scan-and-show-borders UI needs. The upstream version this replaces also tracked
// My Spot / My Model selection and screenshot-feedback status; reintroduce those
// once the corresponding IPC channels/services come back (Phase 2+).

export type ScanState = 'idle' | 'scanning' | 'scanned' | 'error'

export interface OverlayState {
  overlayData: OverlayDataPayload | null
  scanState: ScanState
  scanError: string | null
}

export function useOverlayData(): OverlayState & { triggerScan: () => void } {
  const [overlayData, setOverlayData] = useState<OverlayDataPayload | null>(null)
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [scanError, setScanError] = useState<string | null>(null)
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearScanTimeout = (): void => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current)
      scanTimeoutRef.current = null
    }
  }

  useEffect(() => {
    window.electronApi.invoke('overlay:getInitialData').then((data) => {
      if (data) setOverlayData(data)
    })

    const unsubOverlayData = window.electronApi.on('overlay:data', (data) => {
      setOverlayData(data)
      if (data.scanData) {
        clearScanTimeout()
        setScanState('scanned')
        setScanError(null)
      }
    })

    const unsubScanResults = window.electronApi.on('ml:scanResults', (data) => {
      if (data.error) {
        clearScanTimeout()
        setScanState('error')
        setScanError(data.error)
      }
    })

    return () => {
      clearScanTimeout()
      unsubOverlayData()
      unsubScanResults()
    }
  }, [])

  const triggerScan = (): void => {
    if (!overlayData) {
      console.warn('[overlay] triggerScan called but overlayData is null — initial data not received yet')
      return
    }
    setScanState('scanning')
    setScanError(null)
    clearScanTimeout()
    scanTimeoutRef.current = setTimeout(() => {
      scanTimeoutRef.current = null
      setScanState('error')
      setScanError('Scan timed out')
    }, SCAN_TIMEOUT_MS)
    // CRITICAL: the scanning state hides overlay decorations (capture-mode CSS) so
    // this window's own borders don't get captured inside the ability crops. Wait
    // two frames for the compositor to actually paint their removal first.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.electronApi.send('ml:scan')
      })
    })
  }

  return { overlayData, scanState, scanError, triggerScan }
}
