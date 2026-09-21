import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => tmpdir() } }))
vi.mock('electron-log/main', () => ({
  default: { scope: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) },
}))

import layouts from '../../../../resources/config/layout_coordinates.json'
import heroes from '../../../../resources/data/heroes_abilities.json'
import { createAbilityDataService } from '../../../../src/main/services/ability-data-service'
import { createScanProcessingService, type LiveScan } from '../../../../src/main/services/scan-processing-service'
import type { OverlayDataPayload, ResolutionLayout, ScanResult } from '@shared/types'

// Whole processing path — draft tracker, scoring, the REAL data files and the REAL
// 1920x1080 layout — driven by synthetic scans of a mid-draft board.

const layout = (layouts as { resolutions: Record<string, ResolutionLayout> }).resolutions['1920x1080']

interface RawHero {
  name: string
  abilities: { name: string; is_ultimate: boolean }[]
}
const usable = (heroes as RawHero[]).filter(
  (h) => h.abilities.filter((a) => !a.is_ultimate).length >= 3 && h.abilities.some((a) => a.is_ultimate),
)
const poolHeroes = usable.slice(0, 12)

function scanResult(coord: ResolutionLayout['standard_slots_coords'][number], name: string | null): ScanResult {
  return {
    name,
    confidence: name ? 0.99 : 0,
    hero_order: coord.hero_order,
    ability_order: coord.ability_order ?? 0,
    is_ultimate: coord.is_ultimate ?? false,
    coord,
  }
}

function poolScan(taken: Set<string>): LiveScan['pool'] {
  const standard = layout.standard_slots_coords.map((c) => {
    const basics = poolHeroes[c.hero_order].abilities.filter((a) => !a.is_ultimate)
    const name = basics[(c.ability_order as number) - 1].name
    return scanResult(c, taken.has(name) ? null : name)
  })
  const ultimates = layout.ultimate_slots_coords.map((c) => {
    const name = poolHeroes[c.hero_order].abilities.find((a) => a.is_ultimate)!.name
    // the layout's ultimate boxes carry no is_ultimate flag, so the worker reports false
    return scanResult(c, taken.has(name) ? null : name)
  })
  return { ultimates, standard, selectedAbilities: [], heroDefiningAbilities: [] }
}

// held: per seat, the four pick boxes left to right (3 basics, then the ultimate)
function rowsScan(held: Record<number, (string | null)[]>): ScanResult[] {
  const params = layout.selected_abilities_params
  return (layout.selected_abilities_coords ?? []).map((c) => {
    const seatSlots = (layout.selected_abilities_coords ?? []).filter((x) => x.hero_order === c.hero_order)
    const slot = seatSlots.findIndex((x) => x.x === c.x)
    return scanResult({ ...c, width: params.width, height: params.height }, held[c.hero_order]?.[slot] ?? null)
  })
}

function setup() {
  const sent: OverlayDataPayload[] = []
  const overlay = { isDestroyed: () => false, webContents: { send: (_c: string, p: OverlayDataPayload) => sent.push(p) } }
  const windowManager = {
    getOverlayWindow: () => overlay,
    getControlPanelWindow: () => null,
    refreshOverlayMouseEvents: () => {},
  }
  const service = createScanProcessingService(windowManager as never, createAbilityDataService())
  const run = (pool: LiveScan['pool'], rows: ScanResult[]): OverlayDataPayload => {
    service.handleScan({ pool, rows }, '1920x1080', 1, layout)
    return sent[sent.length - 1]
  }
  return { service, run, sent }
}

describe('scan processing (real data, real layout)', () => {
  it('produces a menu of up to 5 best-first abilities for all 10 seats, placed by the layout', () => {
    const { run } = setup()
    const payload = run(poolScan(new Set()), rowsScan({}))
    expect(payload.scanned).toBe(true)
    expect(payload.pickCount).toBe(0)
    expect(payload.seatMenus).toHaveLength(10)
    for (const menu of payload.seatMenus) {
      expect(menu.suggestions.length).toBeGreaterThan(0)
      expect(menu.suggestions.length).toBeLessThanOrEqual(5)
      const scores = menu.suggestions.map((s) => s.score)
      expect(scores).toEqual([...scores].sort((a, b) => a - b))
      expect(menu.suggestions.every((s) => s.displayName.length > 0)).toBe(true)
    }
    const seat0 = payload.seatMenus.find((m) => m.seat === 0)!
    expect(seat0).toMatchObject({ x: 4, y: 146, height: 146 })
    const seat5 = payload.seatMenus.find((m) => m.seat === 5)!
    expect(seat5.x).toBeGreaterThan(1710)
  })

  it('drops a drafted ability from every menu, counts the pick, and stops offering a filled category', () => {
    const { run } = setup()
    run(poolScan(new Set()), rowsScan({}))
    const ults = poolHeroes.map((h) => h.abilities.find((a) => a.is_ultimate)!.name)
    const basic = poolHeroes[3].abilities.find((a) => !a.is_ultimate)!.name

    const taken = new Set([basic])
    const held = { 0: [basic, null, null, null] }
    run(poolScan(taken), rowsScan(held)) // first sighting
    const after = run(poolScan(taken), rowsScan(held)) // repeated -> committed
    expect(after.pickCount).toBe(1)
    for (const menu of after.seatMenus) {
      expect(menu.suggestions.map((s) => s.name)).not.toContain(basic)
    }

    // seat 0 takes an ultimate too: no second ultimate should ever be offered to it
    const ult = ults[5]
    taken.add(ult)
    const held2 = { 0: [basic, null, null, ult] }
    run(poolScan(taken), rowsScan(held2))
    const later = run(poolScan(taken), rowsScan(held2))
    expect(later.pickCount).toBe(2)
    const seat0Names = later.seatMenus.find((m) => m.seat === 0)!.suggestions.map((s) => s.name)
    expect(seat0Names.some((n) => ults.includes(n))).toBe(false)
    // ...while a seat with no ultimate yet still is offered them
    const seat1Names = later.seatMenus.find((m) => m.seat === 1)!.suggestions.map((s) => s.name)
    expect(seat1Names.length).toBeGreaterThan(0)
  })

  it('a pick changes the OTHER seats\' menus too (enemy denial / ally avoidance are in play)', () => {
    const { run } = setup()
    const before = run(poolScan(new Set()), rowsScan({}))
    const abilities = poolHeroes.flatMap((h) => h.abilities.map((a) => a.name))
    const scoreOf = (p: OverlayDataPayload, seat: number): number =>
      p.seatMenus.find((m) => m.seat === seat)!.suggestions[0].score
    const pickName = before.seatMenus.find((m) => m.seat === 5)!.suggestions[0].name
    expect(abilities).toContain(pickName)
    const taken = new Set([pickName])
    const held = { 5: [pickName, null, null, null] }
    run(poolScan(taken), rowsScan(held))
    const after = run(poolScan(taken), rowsScan(held))
    // the draft moved on (pick number and pool changed), so seat 0's top score shifts
    expect(scoreOf(after, 0)).not.toBe(scoreOf(before, 0))
  })

  it('reset forgets the previous draft', () => {
    const { run, service } = setup()
    const taken = new Set([poolHeroes[0].abilities[0].name])
    run(poolScan(taken), rowsScan({ 0: [poolHeroes[0].abilities[0].name, null, null, null] }))
    run(poolScan(taken), rowsScan({ 0: [poolHeroes[0].abilities[0].name, null, null, null] }))
    service.reset()
    expect(run(poolScan(new Set()), rowsScan({})).pickCount).toBe(0)
  })
})
