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
  limitY: 343,
  maxGrowUp: 97,
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

describe('TopCombosPanel placement', () => {
  // jsdom has no layout engine, so give the panel a measured height by hand.
  const withHeight = (px: number, run: () => void): void => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => px })
    try {
      run()
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight
    }
  }
  const topOf = (container: HTMLElement): number =>
    parseFloat((container.firstElementChild as HTMLElement).style.top)

  beforeEach(() => {
    clearIconCache()
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(null)
  })
  afterEach(() => cleanup())

  it('stays at the anchor when its measured height fits above the board below', () => {
    withHeight(150, () => {
      const { container } = render(<TopCombosPanel data={data} scaleFactor={1} side={null} />)
      expect(topOf(container)).toBe(166)
    })
  })

  it('climbs by just enough to end above the Dire models (a 262px list at 1080p)', () => {
    withHeight(262, () => {
      const { container } = render(<TopCombosPanel data={data} scaleFactor={1} side={null} />)
      const top = topOf(container)
      expect(top).toBe(343 - 262 - 4) // 77
      expect(top).toBeLessThan(166)
    })
  })

  it('does not climb past the allowed amount for a list that is too tall anyway', () => {
    withHeight(500, () => {
      const { container } = render(<TopCombosPanel data={data} scaleFactor={1} side={null} />)
      expect(topOf(container)).toBe(166 - 97)
    })
  })

  it('works in CSS pixels under display scaling (layout px / scaleFactor)', () => {
    // 1.25x scaling: a 210 CSS px panel is 262.5 layout px, so the same 77.5 layout px top
    withHeight(210, () => {
      const { container } = render(<TopCombosPanel data={data} scaleFactor={1.25} side={null} />)
      expect(topOf(container)).toBeCloseTo((343 - 210 * 1.25 - 4) / 1.25, 5)
    })
  })

  it('uses the anchor until it has been measured', () => {
    withHeight(0, () => {
      const { container } = render(<TopCombosPanel data={data} scaleFactor={1} side={null} />)
      expect(topOf(container)).toBe(166)
    })
  })
})
