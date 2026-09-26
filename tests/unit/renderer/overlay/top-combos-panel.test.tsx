// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import type { TopCombosPanelData } from '@shared/types'

const mockInvoke = vi.fn()
Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true })
;(globalThis as Record<string, unknown>).electronApi = { invoke: mockInvoke, send: vi.fn(), on: vi.fn() }

import { TopCombosPanel, seatTag } from '../../../../src/renderer/overlay/src/components/TopCombosPanel'
import { clearIconCache } from '../../../../src/renderer/overlay/src/hooks/use-icon'

const data: TopCombosPanelData = {
  x: 1240,
  y: 166,
  width: 240,
  combos: [
    {
      a: { name: 'a_one', displayName: 'Alpha', kind: 'ability', heldBy: null },
      b: { name: 'b_two', displayName: 'Beta', kind: 'ability', heldBy: null },
      comboWinrate: 0.7081,
    },
    {
      a: { name: 'c_three', displayName: 'Gamma', kind: 'ability', heldBy: 1 },
      b: { name: 'd_four', displayName: 'Delta', kind: 'ability', heldBy: null },
      comboWinrate: 0.65,
    },
    {
      a: { name: 'e_five', displayName: 'Epsilon', kind: 'ability', heldBy: null },
      b: { name: 'f_six', displayName: 'Zeta', kind: 'ability', heldBy: 7 },
      comboWinrate: 0.6,
    },
  ],
}

describe('seatTag', () => {
  it('names rows top to bottom within a team', () => {
    expect([0, 4, 5, 9].map(seatTag)).toEqual(['R1', 'R5', 'D1', 'D5'])
  })
})

describe('TopCombosPanel', () => {
  beforeEach(() => {
    clearIconCache()
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(null)
  })
  afterEach(() => cleanup())

  it('lists each pair with its combo win rate', async () => {
    render(<TopCombosPanel data={data} scaleFactor={1} side={null} />)
    await act(async () => {})
    expect(screen.getByText('70.8%')).toBeTruthy()
    expect(screen.getByText('65.0%')).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('tags only the drafted half with its holder', async () => {
    render(<TopCombosPanel data={data} scaleFactor={1} side={null} />)
    await act(async () => {})
    expect(screen.getByText('R2')).toBeTruthy()
    expect(screen.getByText('D3')).toBeTruthy()
    expect(screen.queryByText('R1')).toBeNull()
  })

  it('colours a drafted half blue for a teammate and red for an enemy once a side is picked', async () => {
    render(<TopCombosPanel data={data} scaleFactor={1} side="radiant" />)
    await act(async () => {})
    expect(screen.getByText('R2').style.color).toBe('rgb(90, 169, 255)') // Radiant row: teammate
    expect(screen.getByText('D3').style.color).toBe('rgb(255, 107, 107)') // Dire row: enemy
  })

  it('flips the colours when the other side is picked', async () => {
    render(<TopCombosPanel data={data} scaleFactor={1} side="dire" />)
    await act(async () => {})
    expect(screen.getByText('R2').style.color).toBe('rgb(255, 107, 107)')
    expect(screen.getByText('D3').style.color).toBe('rgb(90, 169, 255)')
  })

  it('draws nothing when there are no combos or no panel data', () => {
    const { container, rerender } = render(<TopCombosPanel data={null} scaleFactor={1} side={null} />)
    expect(container.firstChild).toBeNull()
    rerender(<TopCombosPanel data={{ ...data, combos: [] }} scaleFactor={1} side={null} />)
    expect(container.firstChild).toBeNull()
  })
})
