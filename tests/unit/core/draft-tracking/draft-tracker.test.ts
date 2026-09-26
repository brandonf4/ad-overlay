import { describe, it, expect } from 'vitest'
import { createDraftTracker, type PoolSlotInput } from '@core/draft-tracking/draft-tracker'
import { buildScoreState } from '@core/draft-tracking/score-state'
import { PICK_ORDER } from '@core/scoring/pick-score'
import type { SeatSlotRead } from '@core/draft-tracking/seat-pick-tracker'
import { picture, dimmed, tooltip } from './thumb-fixtures'

// A fake 12-hero draft: hero h has basics h_b1..h_b3 (pool ability_order 1-3; order 2 is
// the "defining" one) and ultimate h_ult. The tests play a full snake draft and feed the
// tracker the scans the real pipeline would produce after every pick.

const HEROES = Array.from({ length: 12 }, (_, i) => `hero${i}`)
const heroOfAbility = (name: string): string | null => {
  const m = /^(hero\d+)_/.exec(name)
  return m ? m[1] : null
}

interface Item {
  kind: 'ability' | 'model'
  name: string
  isUlt: boolean
  heroOrder: number
  abilityOrder: number
}

function buildPool(): Item[] {
  const items: Item[] = []
  HEROES.forEach((h, heroOrder) => {
    items.push({ kind: 'model', name: h, isUlt: false, heroOrder, abilityOrder: 0 })
    for (const k of [1, 2, 3])
      items.push({ kind: 'ability', name: `${h}_b${k}`, isUlt: false, heroOrder, abilityOrder: k })
    items.push({ kind: 'ability', name: `${h}_ult`, isUlt: true, heroOrder, abilityOrder: 0 })
  })
  return items
}

const tile = (changed: boolean): Uint8Array => new Uint8Array(200).fill(changed ? 200 : 20)

class FakeGame {
  pool = buildPool()
  taken = new Set<string>()
  seatItems: Item[][] = Array.from({ length: 10 }, () => [])
  picksMade = 0

  // Pool boxes covered by a hover tooltip: they read Unknown and show unrelated content.
  covered = new Set<string>()
  // Drafted abilities whose DIMMED box the scanner still names as themselves (the Atrophy
  // Aura case); every other drafted box reads Unknown.
  dimmedStillNamed = new Set<string>()

  poolSlots(): PoolSlotInput[] {
    return this.pool
      .filter((i) => i.kind === 'ability')
      .map((i) => {
        const base = { hero_order: i.heroOrder, ability_order: i.abilityOrder, is_ultimate: i.isUlt }
        // a drafted ability's box stays in the grid as a dimmed copy of its icon
        if (this.taken.has(i.name))
          return { ...base, name: this.dimmedStillNamed.has(i.name) ? i.name : null, thumb: dimmed(picture(i.name)) }
        if (this.covered.has(i.name)) return { ...base, name: null, thumb: tooltip(i.name) }
        return { ...base, name: i.name, thumb: picture(i.name) }
      })
  }
  seatSlots(): SeatSlotRead[] {
    const reads: SeatSlotRead[] = []
    for (let seat = 0; seat < 10; seat++) {
      const abilities = this.seatItems[seat].filter((i) => i.kind === 'ability')
      const basics = abilities.filter((a) => !a.isUlt)
      const ult = abilities.find((a) => a.isUlt)
      for (let slot = 0; slot < 3; slot++) reads.push({ seat, slot, name: basics[slot]?.name ?? null })
      reads.push({ seat, slot: 3, name: ult?.name ?? null })
    }
    return reads
  }
  tiles() {
    return HEROES.map((h, heroOrder) => ({ heroOrder, tile: tile(this.taken.has(h)) }))
  }
  canTake(seat: number, item: Item): boolean {
    const held = this.seatItems[seat]
    if (item.kind === 'model') return !held.some((x) => x.kind === 'model')
    const abilities = held.filter((x) => x.kind === 'ability')
    if (item.isUlt) return !abilities.some((a) => a.isUlt)
    return abilities.filter((a) => !a.isUlt).length < 3
  }
  pick(seat: number, item: Item): void {
    this.taken.add(item.name)
    this.seatItems[seat].push(item)
    this.picksMade++
  }
}

function rng(seed: number): () => number {
  let s = seed
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
}

function scan(tracker: ReturnType<typeof createDraftTracker>, game: FakeGame) {
  return tracker.update({ pool: game.poolSlots(), seatSlots: game.seatSlots(), modelTiles: game.tiles() })
}

describe('draft tracker', () => {
  it('follows a whole draft pick by pick and attributes abilities and models to the right seats', () => {
    const rand = rng(7)
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game) // baseline

    for (let k = 0; k < PICK_ORDER.length; k++) {
      const seat = PICK_ORDER[k]
      const options = game.pool.filter((i) => !game.taken.has(i.name) && game.canTake(seat, i))
      game.pick(seat, options[Math.floor(rand() * options.length)])
      scan(tracker, game)
      scan(tracker, game)
      const snap = scan(tracker, game) // three scans per pick: model changes must persist to commit

      expect(snap.pickIndex).toBe(k + 1)
      for (let s = 0; s < 10; s++) {
        const truth = game.seatItems[s].map((i) => i.name).sort()
        expect(snap.seats[s].map((e) => e.name).sort()).toEqual(truth)
      }
    }
  })

  it('counts a model pick immediately as a pick but only attributes it when unambiguous', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    game.pick(PICK_ORDER[0], game.pool.find((i) => i.name === 'hero4')!)
    scan(tracker, game)
    scan(tracker, game)
    const snap = scan(tracker, game)
    expect(snap.pickIndex).toBe(1)
    expect(snap.models.find((m) => m.heroName === 'hero4')?.picked).toBe(true)
    expect(snap.seats[PICK_ORDER[0]]).toEqual([{ name: 'hero4', kind: 'model', isUlt: false }])
  })

  it('drops a one-scan blip (tooltip) instead of committing a pick', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    const blip = game.tiles().map((t) => (t.heroOrder === 3 ? { ...t, tile: tile(true) } : t))
    tracker.update({ pool: game.poolSlots(), seatSlots: game.seatSlots(), modelTiles: blip })
    tracker.update({ pool: game.poolSlots(), seatSlots: game.seatSlots(), modelTiles: blip })
    const snap = scan(tracker, game)
    expect(snap.pickIndex).toBe(0)
    expect(snap.models.every((m) => !m.picked)).toBe(true)
  })

  it('keeps hero identity for a picked model even though its defining ability was drafted', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    game.pick(0, game.pool.find((i) => i.name === 'hero2_b2')!) // the defining ability
    game.pick(5, game.pool.find((i) => i.name === 'hero2')!)
    scan(tracker, game)
    scan(tracker, game)
    const snap = scan(tracker, game)
    const model = snap.models.find((m) => m.heroName === 'hero2')
    expect(model).toBeDefined()
    expect(model?.picked).toBe(true)
  })

  it('pickCandidates leaves a box type unrestricted while any pool slot of it is unknown', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    expect(tracker.pickCandidates().standard).toHaveLength(36)
    expect(tracker.pickCandidates().ultimates).toHaveLength(12)

    const pool = game.poolSlots().map((s, i) => (i === 0 ? { ...s, name: null } : s))
    const t2 = createDraftTracker(heroOfAbility)
    t2.update({ pool, seatSlots: [], modelTiles: null })
    expect(t2.pickCandidates().standard).toEqual([])
    expect(t2.pickCandidates().ultimates).toHaveLength(12)
  })

  it('builds a score state whose pool excludes everything already drafted', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    game.pick(0, game.pool.find((i) => i.name === 'hero1_ult')!)
    scan(tracker, game)
    const snap = scan(tracker, game)
    const state = buildScoreState(snap, {
      ability: () => ({ isUltimate: false, winrateHigh: 0.5, pickPositionHigh: 10 }),
      model: () => ({ winrateHigh: 0.5, pickPositionHigh: 10 }),
    })
    expect(state.available.find((i) => i.name === 'hero1_ult')).toBeUndefined()
    expect(state.available).toHaveLength(60 - 1)
    expect(state.picks[0]).toHaveLength(1)
    expect(state.picks[0][0]).toMatchObject({ name: 'hero1_ult', kind: 'ability', isUlt: true })
    expect(state.pickIndex).toBe(1)
  })
})

describe('hero identification robustness', () => {
  it('still reads a model when its defining ability box did not read, if two other abilities agree', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    const pool = game.poolSlots().map((s) =>
      // hero 5's middle basic (the defining ability) reads Unknown
      s.hero_order === 5 && s.ability_order === 2 && !s.is_ultimate ? { ...s, name: null } : s,
    )
    const snap = tracker.update({ pool, seatSlots: [], modelTiles: game.tiles() })
    expect(snap.models.find((m) => m.heroOrder === 5)?.heroName).toBe('hero5')
    expect(snap.models).toHaveLength(12)
  })

  it('does not guess a hero from a single agreeing ability', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    const pool = game.poolSlots().map((s) =>
      s.hero_order === 5 && !(s.ability_order === 1 && !s.is_ultimate) ? { ...s, name: null } : s,
    )
    const snap = tracker.update({ pool, seatSlots: [], modelTiles: game.tiles() })
    expect(snap.models.find((m) => m.heroOrder === 5)).toBeUndefined()
  })
})

describe('does not forget things that are still there', () => {
  it('a hover tooltip over a cluster of pool boxes for a long time does not drop those abilities', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    // the tooltip covers nine boxes for a long think (20 scans = 30 seconds)
    for (const name of ['hero0_b1', 'hero0_b2', 'hero0_b3', 'hero1_b1', 'hero1_b2', 'hero1_b3', 'hero2_b1', 'hero2_b2', 'hero2_b3'])
      game.covered.add(name)
    let snap
    for (let i = 0; i < 20; i++) snap = scan(tracker, game)
    expect(snap!.pickIndex).toBe(0)
    expect(snap!.poolAbilities.filter((a) => a.picked)).toHaveLength(0)
    const state = buildScoreState(snap!, {
      ability: () => ({ isUltimate: false, winrateHigh: 0.5, pickPositionHigh: 10 }),
      model: () => ({ winrateHigh: 0.5, pickPositionHigh: 10 }),
    })
    expect(state.available.filter((i) => i.kind === 'ability')).toHaveLength(48)
  })

  it('an ability that really was drafted is still dropped from the pool', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    game.pick(0, game.pool.find((i) => i.name === 'hero3_b1')!)
    scan(tracker, game)
    const snap = scan(tracker, game)
    expect(snap.poolAbilities.find((a) => a.name === 'hero3_b1')?.picked).toBe(true)
  })

  it('an ability held in a player row is drafted even if its pool box never goes blank', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    game.pick(0, game.pool.find((i) => i.name === 'hero3_b1')!)
    game.covered.add('hero3_b1') // box unreadable AND (say) not blank — only the row proves it
    // the box never dims (say) — it just reads Unknown under something; only the row proves it
    const pool = () => game.poolSlots().map((s) => ({ ...s, name: null, thumb: tooltip('cover') }))
    let snap
    for (let i = 0; i < 3; i++) snap = tracker.update({ pool: pool(), seatSlots: game.seatSlots(), modelTiles: game.tiles() })
    expect(snap!.poolAbilities.find((a) => a.name === 'hero3_b1')?.picked).toBe(true)
  })

  it('a pool ability marked drafted comes back if it reads normally again', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    // two blank frames (say, a transition), then the real box reads again
    const ability = game.pool.find((i) => i.name === 'hero6_b2')!
    game.taken.add(ability.name)
    scan(tracker, game)
    expect(scan(tracker, game).poolAbilities.find((a) => a.name === 'hero6_b2')?.picked).toBe(true)
    game.taken.delete(ability.name)
    scan(tracker, game)
    expect(scan(tracker, game).poolAbilities.find((a) => a.name === 'hero6_b2')?.picked).toBe(false)
  })

  it('a model tile change from a tooltip that lasts several scans is undone once it clears', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    const covered = game.tiles().map((t) => (t.heroOrder === 3 ? { ...t, tile: tile(true) } : t))
    let snap
    for (let i = 0; i < 4; i++)
      snap = tracker.update({ pool: game.poolSlots(), seatSlots: game.seatSlots(), modelTiles: covered })
    expect(snap!.models.find((m) => m.heroOrder === 3)?.picked).toBe(true) // it looked picked for a while
    scan(tracker, game)
    snap = scan(tracker, game)
    expect(snap.models.find((m) => m.heroOrder === 3)?.picked).toBe(false)
    expect(snap.pickIndex).toBe(0)
    expect(snap.seats.every((e) => e.length === 0)).toBe(true) // and no seat is left holding it
  })

  it('a burst of model tiles changing at once for less than the commit window commits nothing', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    const burst = game.tiles().map((t) => (t.heroOrder < 3 ? { ...t, tile: tile(true) } : t))
    tracker.update({ pool: game.poolSlots(), seatSlots: game.seatSlots(), modelTiles: burst })
    tracker.update({ pool: game.poolSlots(), seatSlots: game.seatSlots(), modelTiles: burst })
    const snap = scan(tracker, game)
    expect(snap.models.every((m) => !m.picked)).toBe(true)
  })
})

describe('a drafted ability is dropped even when nothing else identifies it', () => {
  it('Atrophy Aura case: dimmed box still named as itself, and the row read failed', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    // seat 5 drafts hero3_b2; its pool box dims but the scanner still names it, and the
    // player-row scan never manages to read it (rows are left empty here)
    game.dimmedStillNamed.add('hero3_b2')
    game.taken.add('hero3_b2')
    const emptyRows = (): SeatSlotRead[] => []
    let snap
    for (let i = 0; i < 3; i++)
      snap = tracker.update({ pool: game.poolSlots(), seatSlots: emptyRows(), modelTiles: game.tiles() })
    expect(snap!.poolAbilities.find((a) => a.name === 'hero3_b2')?.picked).toBe(true)
    const state = buildScoreState(snap!, {
      ability: () => ({ isUltimate: false, winrateHigh: 0.5, pickPositionHigh: 10 }),
      model: () => ({ winrateHigh: 0.5, pickPositionHigh: 10 }),
    })
    expect(state.available.find((i) => i.name === 'hero3_b2')).toBeUndefined() // no longer suggested
    expect(snap!.pickIndex).toBe(1) // and it counts as a pick
  })

  it('a whole-screen dim (a dialog over the draft) does not drop the pool', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    let snap
    for (let i = 0; i < 6; i++)
      snap = tracker.update({
        pool: game.poolSlots().map((s) => ({ ...s, thumb: dimmed(s.thumb!, 0.35) })),
        seatSlots: game.seatSlots(),
        modelTiles: game.tiles(),
      })
    expect(snap!.poolAbilities.filter((a) => a.picked)).toHaveLength(0)
    expect(snap!.pickIndex).toBe(0)
  })

  it('a black transition screen at the end of the draft does not mark the pool as drafted', () => {
    const game = new FakeGame()
    const tracker = createDraftTracker(heroOfAbility)
    scan(tracker, game)
    let snap
    for (let i = 0; i < 6; i++)
      snap = tracker.update({
        pool: game.poolSlots().map((s) => ({ ...s, name: null, thumb: new Uint8Array(576) })),
        seatSlots: game.seatSlots(),
        modelTiles: game.tiles(),
      })
    expect(snap!.poolAbilities.filter((a) => a.picked)).toHaveLength(0)
  })
})
