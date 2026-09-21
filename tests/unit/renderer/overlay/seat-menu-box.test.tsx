// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import type { SeatMenu } from '@shared/types'

const mockInvoke = vi.fn()
Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true })
;(globalThis as Record<string, unknown>).electronApi = { invoke: mockInvoke, send: vi.fn(), on: vi.fn() }

import { SeatMenuBox } from '../../../../src/renderer/overlay/src/components/SeatMenuBox'
import { clearIconCache } from '../../../../src/renderer/overlay/src/hooks/use-icon'

const menu: SeatMenu = {
  seat: 0,
  x: 4,
  y: 146,
  width: 200,
  height: 146,
  suggestions: [
    { name: 'axe_berserkers_call', displayName: 'Berserkers Call', kind: 'ability', score: 12.3 },
    { name: 'antimage', displayName: 'Anti-Mage', kind: 'model', score: 14.8 },
  ],
}

const urlFor = (kind: string, name: string): string => `data:image/png;base64,${kind}-${name}`

describe('SeatMenuBox icons', () => {
  beforeEach(() => {
    clearIconCache()
    mockInvoke.mockReset()
    mockInvoke.mockImplementation(async (_c: string, req: { kind: string; name: string }) =>
      urlFor(req.kind, req.name),
    )
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows a mini icon beside each ability and model name, asking main for the right one', async () => {
    const { container } = render(<SeatMenuBox menu={menu} scaleFactor={1} />)
    await act(async () => {})
    const imgs = [...container.querySelectorAll('img')]
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
      urlFor('ability', 'axe_berserkers_call'),
      urlFor('model', 'antimage'),
    ])
    expect(mockInvoke).toHaveBeenCalledWith('icon:get', { kind: 'ability', name: 'axe_berserkers_call' })
    expect(mockInvoke).toHaveBeenCalledWith('icon:get', { kind: 'model', name: 'antimage' })
    expect(screen.getByText(/Anti-Mage/)).toBeTruthy()
    expect(screen.getByText('HERO')).toBeTruthy()
  })

  it('keeps the name (and reserves the icon slot) while an icon is not available', async () => {
    mockInvoke.mockResolvedValue(null)
    const { container } = render(<SeatMenuBox menu={menu} scaleFactor={1} />)
    await act(async () => {})
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByText(/Berserkers Call/)).toBeTruthy()
  })

  it('retries a missing icon later and shows it once it arrives', async () => {
    vi.useFakeTimers()
    mockInvoke.mockResolvedValueOnce(null).mockResolvedValue(urlFor('ability', 'late'))
    const single: SeatMenu = { ...menu, suggestions: [menu.suggestions[0]] }
    const { container } = render(<SeatMenuBox menu={single} scaleFactor={1} />)
    await act(async () => {})
    expect(container.querySelectorAll('img')).toHaveLength(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100)
    })
    expect(container.querySelector('img')?.getAttribute('src')).toBe(urlFor('ability', 'late'))
  })

  it('does not ask main again for an icon it already has', async () => {
    const { rerender } = render(<SeatMenuBox menu={menu} scaleFactor={1} />)
    await act(async () => {})
    const calls = mockInvoke.mock.calls.length
    rerender(<SeatMenuBox menu={{ ...menu, suggestions: [...menu.suggestions].reverse() }} scaleFactor={1} />)
    await act(async () => {})
    expect(mockInvoke.mock.calls.length).toBe(calls)
  })
})
