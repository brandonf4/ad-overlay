import { useState, useEffect, useRef } from 'react'
import type { OverlayDataPayload } from '@shared/types'

// Safety net: if main never delivers the first result (hung ML init, dead worker),
// unstick the UI. Only armed until the first result of a live session arrives.
const SCAN_TIMEOUT_MS = 30_000

// @DEV-GUIDE: Phase-1 overlay state hook — trimmed to just what the scan controls and
// the winrate panel need. The upstream version this replaces also tracked My Spot /
// My Model selection and screenshot-feedback status; reintroduce those once the
// corresponding IPC channels/services come back (Phase 2+).
//
// Scanning is a live loop owned by the main process (scan-trigger-service.ts): the
// renderer only starts/stops it and receives an overlay:data push after every scan.

export type ScanState = 'idle' | 'scanning' | 'scanned' | 'error'

export interface OverlayState {
  overlayData: OverlayDataPayload | null
  scanState: ScanState
  scanError: string | null
  live: boolean
}

export function useOverlayData(): OverlayState & { startLive: () => void; stopLive: () => void } {
  const [overlayData, setOverlayData] = useState<OverlayDataPayload | null>(null)
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [scanError, setScanError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
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

  const startLive = (): void => {
    if (!overlayData) {
      console.warn('[overlay] startLive called but overlayData is null — initial data not received yet')
      return
    }
    setLive(true)
    setScanState('scanning')
    setScanError(null)
    clearScanTimeout()
    scanTimeoutRef.current = setTimeout(() => {
      scanTimeoutRef.current = null
      setScanState('error')
      setScanError('Scan timed out')
    }, SCAN_TIMEOUT_MS)
    window.electronApi.send('ml:startLive')
  }

  const stopLive = (): void => {
    clearScanTimeout()
    setLive(false)
    setScanState((s) => (s === 'scanning' ? 'idle' : s))
    window.electronApi.send('ml:stopLive')
  }

  return { overlayData, scanState, scanError, live, startLive, stopLive }
}
