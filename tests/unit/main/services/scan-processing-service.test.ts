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
import { picture, dimmed } from '../../core/draft-tracking/thumb-fixtures'

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
let poolHeroes = usable.slice(0, 12)

// The 12 heroes whose MODELS the simulator's data rates best — a pool where hero models
// are attractive picks, so they must show up among the suggestions.
const modelStrong = (
  usable as (RawHero & { model_avg_pick_position_high: number | null })[]
)
  .filter((h) => h.model_avg_pick_position_high != null)
  .sort((a, b) => (a.model_avg_pick_position_high as number) - (b.model_avg_pick_position_high as number))
  .slice(0, 12)

// Earthshaker + Storm Spirit: a real cross-hero pair with recorded synergy data, used to
// check the combo-winrate reconstruction end-to-end against real numbers.
const COMBO_A = 'earthshaker_aftershock'
const COMBO_B = 'storm_spirit_static_remnant'
const comboPool = [
  usable.find((h) => h.name === 'earthshaker')!,
  usable.find((h) => h.name === 'storm_spirit')!,
  ...usable.filter((h) => h.name !== 'earthshaker' && h.name !== 'storm_spirit').slice(0, 10),
]

// One 12-tile model capture: a drafted model's tile looks nothing like its baseline.
function modelTiles(picked: number[] = []): { heroOrder: number; tile: ArrayBuffer }[] {
  return Array.from({ length: 12 }, (_, heroOrder) => ({
    heroOrder,
    tile: new Uint8Array(200).fill(picked.includes(heroOrder) ? 200 : 20).buffer,
  }))
}

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

// A drafted ability's pool box stays in the grid as a dimmed copy of its icon (and, for most
// abilities, reads Unknown).
function poolBox(coord: ResolutionLayout['standard_slots_coords'][number], name: string, taken: Set<string>): ScanResult {
  return taken.has(name)
    ? { ...scanResult(coord, null), thumb: dimmed(picture(name)) }
    : { ...scanResult(coord, name), thumb: picture(name) }
}

function poolScan(taken: Set<string>): LiveScan['pool'] {
  const standard = layout.standard_slots_coords.map((c) => {
    const basics = poolHeroes[c.hero_order].abilities.filter((a) => !a.is_ultimate)
    const name = basics[(c.ability_order as number) - 1].name
    return poolBox(c, name, taken)
  })
  const ultimates = layout.ultimate_slots_coords.map((c) => {
    const name = poolHeroes[c.hero_order].abilities.find((a) => a.is_ultimate)!.name
    // the layout's ultimate boxes carry no is_ultimate flag, so the worker reports false
    return poolBox(c, name, taken)
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
  const run = (
    pool: LiveScan['pool'],
    rows: ScanResult[],
    tiles?: LiveScan['modelTiles'],
  ): OverlayDataPayload => {
    service.handleScan({ pool, rows, modelTiles: tiles }, '1920x1080', 1, layout)
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
      // Shown score, higher = better (no category is deferred on the first pick).
      expect(scores).toEqual([...scores].sort((a, b) => b - a))
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
    const pickName = before.seatMenus.find((m) => m.seat === 5)!.suggestions.find((s) => s.kind === 'ability')!.name
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

describe('hero models take part in the suggestions', () => {
  it('ranks models together with abilities, tagged as models, with their hero name', () => {
    poolHeroes = modelStrong
    try {
      const { run } = setup()
      const payload = run(poolScan(new Set()), rowsScan({}), modelTiles())
      const all = payload.seatMenus.flatMap((m) => m.suggestions)
      expect(all.every((s) => s.kind === 'ability' || s.kind === 'model')).toBe(true)
      const models = all.filter((s) => s.kind === 'model')
      expect(models.length).toBeGreaterThan(0)
      for (const m of models) {
        expect(m.displayName.length).toBeGreaterThan(0)
        expect(poolHeroes.map((h) => h.name)).toContain(m.name) // model item = the hero's name
      }
      expect(payload.modelStatus).toEqual({ read: 12, picked: 0 })
    } finally {
      poolHeroes = usable.slice(0, 12)
    }
  })

  it('notices a drafted model from its tile, stops offering it, and gives that seat its model', () => {
    poolHeroes = modelStrong
    try {
      const { run } = setup()
      run(poolScan(new Set()), rowsScan({}), modelTiles()) // baseline
      const takenHero = 2
      run(poolScan(new Set()), rowsScan({}), modelTiles([takenHero])) // first sighting
      run(poolScan(new Set()), rowsScan({}), modelTiles([takenHero])) // still changed
      const after = run(poolScan(new Set()), rowsScan({}), modelTiles([takenHero])) // committed
      expect(after.modelStatus).toEqual({ read: 12, picked: 1 })
      expect(after.pickCount).toBe(1)
      const heroName = poolHeroes[takenHero].name
      for (const menu of after.seatMenus) {
        expect(menu.suggestions.map((s) => s.name)).not.toContain(heroName)
      }
      // seat 0 made the first pick, so it is the one holding a model: none offered again
      const seat0 = after.seatMenus.find((m) => m.seat === 0)!
      expect(seat0.suggestions.some((s) => s.kind === 'model')).toBe(false)
    } finally {
      poolHeroes = usable.slice(0, 12)
    }
  })

  it('reports no models read when the scan returned no model tiles', () => {
    const { run } = setup()
    expect(run(poolScan(new Set()), rowsScan({})).modelStatus).toEqual({ read: 0, picked: 0 })
  })
})

describe('top combos panel', () => {
  it('lists up to 15 combos, best first', () => {
    poolHeroes = modelStrong
    try {
      const { run } = setup()
      const combos = run(poolScan(new Set()), rowsScan({}), modelTiles()).topCombos!.combos
      // a full pool of real heroes has far more than 15 pairs with synergy data
      expect(combos).toHaveLength(15)
      const rates = combos.map((c) => c.comboWinrate)
      expect(rates).toEqual([...rates].sort((a, b) => b - a))
    } finally {
      poolHeroes = usable.slice(0, 12)
    }
  })

  it('reconstructs the real combo win rate for a known pair, positioned right of the ultimates', () => {
    poolHeroes = comboPool
    try {
      const { run } = setup()
      const payload = run(poolScan(new Set()), rowsScan({}))
      expect(payload.topCombos).not.toBeNull()
      const box = payload.topCombos!
      const rightEdge = Math.max(...layout.ultimate_slots_coords.map((s) => s.x + s.width))
      expect(box.x).toBeGreaterThan(rightEdge)
      expect(box.y).toBe(Math.min(...layout.ultimate_slots_coords.map((s) => s.y)))

      const combo = box.combos.find(
        (c) =>
          (c.a.name === COMBO_A && c.b.name === COMBO_B) || (c.a.name === COMBO_B && c.b.name === COMBO_A),
      )
      expect(combo).toBeDefined()
      // synergy lift 14.49 percentage points + average(0.6488, 0.5294) solo win rates
      expect(combo!.comboWinrate).toBeCloseTo(14.49 / 100 + (0.6488 + 0.5294) / 2, 6)
      expect(combo!.a.displayName.length).toBeGreaterThan(0)

      const scores = box.combos.map((c) => c.comboWinrate)
      expect(scores).toEqual([...scores].sort((a, b) => b - a))
      expect(box.combos.every((c) => !(c.a.kind === 'model' && c.b.kind === 'model'))).toBe(true)
    } finally {
      poolHeroes = usable.slice(0, 12)
    }
  })

  const findCombo = (p: OverlayDataPayload) =>
    p.topCombos?.combos.find(
      (c) =>
        (c.a.name === COMBO_A && c.b.name === COMBO_B) || (c.a.name === COMBO_B && c.b.name === COMBO_A),
    )

  it('keeps a combo open when only one half is drafted, marked with who holds it', () => {
    poolHeroes = comboPool
    try {
      const { run } = setup()
      const taken = new Set([COMBO_A])
      const held = { 0: [COMBO_A, null, null, null] }
      run(poolScan(taken), rowsScan(held))
      const after = run(poolScan(taken), rowsScan(held))
      const combo = findCombo(after)
      expect(combo).toBeDefined()
      const drafted = combo!.a.name === COMBO_A ? combo!.a : combo!.b
      const open = combo!.a.name === COMBO_A ? combo!.b : combo!.a
      expect(drafted.heldBy).toBe(0)
      expect(open.name).toBe(COMBO_B)
      expect(open.heldBy).toBeNull()
      // same real win rate as when both were in the pool
      expect(combo!.comboWinrate).toBeCloseTo(14.49 / 100 + (0.6488 + 0.5294) / 2, 6)
    } finally {
      poolHeroes = usable.slice(0, 12)
    }
  })

  it('drops the combo when the player holding one half has no room left for the other', () => {
    poolHeroes = comboPool
    try {
      const { run } = setup()
      // seat 0 holds three basics (COMBO_A among them) — it cannot take COMBO_B, also a basic
      const three = [COMBO_A, 'earthshaker_enchant_totem', 'earthshaker_fissure']
      const taken = new Set(three)
      const held = { 0: [...three, null] }
      run(poolScan(taken), rowsScan(held))
      const after = run(poolScan(taken), rowsScan(held))
      expect(findCombo(after)).toBeUndefined()
    } finally {
      poolHeroes = usable.slice(0, 12)
    }
  })

  it('drops the combo once both halves are drafted, by different players', () => {
    poolHeroes = comboPool
    try {
      const { run } = setup()
      const taken = new Set([COMBO_A, COMBO_B])
      const held = { 0: [COMBO_A, null, null, null], 5: [COMBO_B, null, null, null] }
      run(poolScan(taken), rowsScan(held))
      const after = run(poolScan(taken), rowsScan(held))
      expect(findCombo(after)).toBeUndefined()
    } finally {
      poolHeroes = usable.slice(0, 12)
    }
  })
})
