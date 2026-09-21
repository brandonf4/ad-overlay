// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { OverlayDataPayload } from '@shared/types'

// --- Mock window.electronApi ---

type Listener = (data: unknown) => void
const channelListeners: Record<string, Listener[]> = {}

function mockOn(channel: string, cb: Listener): () => void {
  if (!channelListeners[channel]) channelListeners[channel] = []
  channelListeners[channel].push(cb)
  return () => {
    const arr = channelListeners[channel]
    const idx = arr.indexOf(cb)
    if (idx >= 0) arr.splice(idx, 1)
  }
}

const mockSend = vi.fn()
const mockInvoke = vi.fn()

Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true })
;(globalThis as Record<string, unknown>).electronApi = {
  on: mockOn,
  send: mockSend,
  invoke: mockInvoke,
}

// Import the hook AFTER mocking window.electronApi
let useOverlayData: typeof import('../../../../src/renderer/overlay/src/hooks/use-overlay-data').useOverlayData

function emit(channel: string, data: unknown): void {
  for (const cb of channelListeners[channel] ?? []) cb(data)
}

function payload(overrides: Partial<OverlayDataPayload> = {}): OverlayDataPayload {
  return {
    scanned: false,
    seatMenus: [],
    pickCount: 0,
    modelStatus: { read: 0, picked: 0 },
    targetResolution: '1920x1080',
    scaleFactor: 1,
    ...overrides,
  }
}

// The hook is the renderer's side of the live scan: it starts/stops the loop that runs
// in the main process and reflects the overlay:data / ml:scanResults pushes it receives.
describe('useOverlayData', () => {
  beforeEach(async () => {
    for (const key of Object.keys(channelListeners)) channelListeners[key] = []
    mockSend.mockClear()
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(payload())
    ;({ useOverlayData } = await import('../../../../src/renderer/overlay/src/hooks/use-overlay-data'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function mounted() {
    const hook = renderHook(() => useOverlayData())
    await act(async () => {}) // let overlay:getInitialData resolve
    return hook
  }

  it('loads the initial overlay data', async () => {
    const { result } = await mounted()
    expect(mockInvoke).toHaveBeenCalledWith('overlay:getInitialData')
    expect(result.current.overlayData).toEqual(payload())
    expect(result.current.scanState).toBe('idle')
    expect(result.current.live).toBe(false)
  })

  it('startLive asks main to begin the live scan loop and shows scanning', async () => {
    const { result } = await mounted()
    act(() => result.current.startLive())
    expect(mockSend).toHaveBeenCalledWith('ml:startLive')
    expect(result.current.live).toBe(true)
    expect(result.current.scanState).toBe('scanning')
  })

  it('startLive does nothing until the initial overlay data has arrived', async () => {
    mockInvoke.mockResolvedValue(null)
    const { result } = await mounted()
    act(() => result.current.startLive())
    expect(mockSend).not.toHaveBeenCalled()
    expect(result.current.live).toBe(false)
  })

  it('a scanned overlay:data push updates the data and marks the scan done', async () => {
    const { result } = await mounted()
    act(() => result.current.startLive())
    act(() => emit('overlay:data', payload({ scanned: true, pickCount: 7 })))
    expect(result.current.scanState).toBe('scanned')
    expect(result.current.overlayData?.pickCount).toBe(7)
    expect(result.current.live).toBe(true) // still polling
  })

  it('an unscanned overlay:data push does not claim a scan finished', async () => {
    const { result } = await mounted()
    act(() => emit('overlay:data', payload({ scanned: false })))
    expect(result.current.scanState).toBe('idle')
  })

  it('shows a scan error and recovers on the next good scan (the loop keeps running)', async () => {
    const { result } = await mounted()
    act(() => result.current.startLive())
    act(() => emit('ml:scanResults', { error: 'No Dota window' }))
    expect(result.current.scanState).toBe('error')
    expect(result.current.scanError).toBe('No Dota window')
    expect(result.current.live).toBe(true)
    act(() => emit('overlay:data', payload({ scanned: true })))
    expect(result.current.scanState).toBe('scanned')
    expect(result.current.scanError).toBeNull()
  })

  it('stopLive tells main to stop and leaves the last results showing', async () => {
    const { result } = await mounted()
    act(() => result.current.startLive())
    act(() => emit('overlay:data', payload({ scanned: true, pickCount: 3 })))
    act(() => result.current.stopLive())
    expect(mockSend).toHaveBeenCalledWith('ml:stopLive')
    expect(result.current.live).toBe(false)
    expect(result.current.scanState).toBe('scanned')
    expect(result.current.overlayData?.pickCount).toBe(3)
  })

  it('stopping before any result returns to idle', async () => {
    const { result } = await mounted()
    act(() => result.current.startLive())
    act(() => result.current.stopLive())
    expect(result.current.scanState).toBe('idle')
  })

  it('gives up with an error if main never produces a first result', async () => {
    vi.useFakeTimers()
    const { result } = await mounted()
    act(() => result.current.startLive())
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(result.current.scanState).toBe('error')
    expect(result.current.scanError).toBe('Scan timed out')
  })

  it('does not time out once a result has arrived', async () => {
    vi.useFakeTimers()
    const { result } = await mounted()
    act(() => result.current.startLive())
    act(() => emit('overlay:data', payload({ scanned: true })))
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current.scanState).toBe('scanned')
  })
})
