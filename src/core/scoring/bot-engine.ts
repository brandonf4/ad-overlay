// @DEV-GUIDE: Port of ad-simulator's bot pick scoring (testing branch,
// public/simulator.html: botDecision and every term it sums). Kept as a close
// function-for-function port, same names and constants, so the two stay comparable;
// tests/unit/core/scoring/bot-engine.test.ts checks it against golden values produced
// by the simulator's own code. If the simulator's logic or tuning changes, port it
// here too and regenerate the golden file (see tests/unit/core/scoring/README.md).
//
// Internal scores are "lower = picked first", exactly as in the simulator. The
// simulator shows DISPLAY_SCALE × that (higher = better); shown() does the same here.
//
// The simulator only scores the seat whose turn it is. The overlay asks for every
// seat, so decide(seat) scores "this seat picking right now" with the draft's
// current pick index, the same way the old pick-score port did.
// Pure logic, no Electron imports.

import {
  PICK_ORDER,
  enemiesOf,
  alliesOf,
  nextPickIndexFor,
  pickBlockedFor,
  type ScoreItem,
  type ScoreState,
} from './pick-score'

export type Role = 'pos1' | 'mid' | 'offlane' | 'support'
export type Category = 'model' | 'ult' | 'basic'
type UpgradeKind = 'scepter' | 'shard'

export interface UpgradeEntry {
  excess: number
  needs?: string[]
}

/** Every data file the simulator loads for scoring, already parsed. */
export interface EngineData {
  /** Windrun pair synergy with synergy_overrides.json "overrides" applied on top. */
  synergy: Map<string, number>
  /** synergy_overrides.json "estimated": blanket model rules, treated as estimated. */
  bakedEstimated: Map<string, number>
  /** model_ability_shifts.json heroes: hero name -> [primary attribute, attack type]. */
  modelTypes: Map<string, [string, string]>
  /** model_ability_shifts.json abilities: ability -> attribute/attack type -> shift. */
  modelShifts: Record<string, Record<string, number>>
  /** ability_strength.json value: windrun Value (mispricing) per ability / model. */
  value: Record<string, number>
  /** role_skew.json abilities: ability -> z per role. */
  role: Record<string, Partial<Record<Role, number>>>
  /** aghs_upgrades.json. */
  upgrades: Record<UpgradeKind, Record<string, UpgradeEntry>>
}

export interface ScoreRow {
  item: ScoreItem
  base: number
  ownSynergy: number
  combo: number
  scepter: number
  shard: number
  pool: number
  getBack: number
  personal: number
  enemy: number
  ally: number
  scarcity: number
  role: number
  roleScarcity: number
  total: number
}

export interface Decision {
  seat: number
  /** Every option the seat can legally take, best (lowest total) first. */
  rows: ScoreRow[]
  /** Categories the hard override defers this pick (see decide()). */
  deferredCats: Category[]
  chosen: ScoreItem | null
}

// ---- Tuning constants (simulator values) ----
const MODEL_SHIFT_WEIGHT = 2
const SYNERGY_MULTIPLIER_BASE = 1.2
const SYNERGY_MULTIPLIER_INCREMENT = 0.08
const KNOWN_COMBO_BONUS_COEFFICIENT = 0.006
const SYNERGY_ORDER_WEIGHTS = [1.4, 1, 0.8, 0.6]
const POOL_SYNERGY_WEIGHTS_BY_PICKS_MADE = [0.35, 0.105, 0.07, 0.07, 0]
const GET_BACK_WEIGHT = 1
const UPGRADE_RULES: Record<UpgradeKind, { coef: number; cap: number }> = {
  scepter: { coef: 0.02, cap: Infinity },
  shard: { coef: 0.055, cap: 4 },
}
export const DISPLAY_SCALE = -1
const BASE_PICK_OFFSET = 100
const BASE_PICK_WEIGHT = 2
const VALUE_DIVISOR = 25
const ESTIMATED_MODEL_PENALTY_BY_ROLE: Record<Role, number> = {
  pos1: 1.5,
  offlane: 1.25,
  mid: 1.1,
  support: 1,
}
const MODEL_SCARCITY_BY_ROLE: Record<Role, number> = {
  pos1: 1.5,
  mid: 1.2,
  offlane: 1.2,
  support: 0.75,
}
const TEAM_PLAY_BY_ROLE: Record<Role, number> = { pos1: 1, mid: 1.1, offlane: 1.1, support: 1.4 }
const SCARCITY_WEIGHT = 0.5
const SCARCITY_CAP = 30
const ROLES: Role[] = ['pos1', 'mid', 'offlane', 'support']
const TEAM_ROLES: Role[] = ['pos1', 'mid', 'offlane', 'support', 'support']
const ROLE_Z_CAP = 3
const ROLE_FIT_Z = 1
const ROLE_FIT_SPREAD = 1
const OFF_ROLE_CUT = 0.6
const ROLE_FIT_FLOOR = 1
const OFFLANE_SUPPORT_DISCOUNT = 0.5
const ROLE_KEEP_Z: Record<Role, number> = { pos1: 0, mid: 0, offlane: 1, support: 1 }
const ROLE_KEEP_SPAN = 3
const CATEGORIES: Category[] = ['model', 'ult', 'basic']

/** Shown value (higher = better), like the simulator's bot panel. */
export const shown = (v: number): number => v * DISPLAY_SCALE

export function synergyKeyFor(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}
export function categoryOf(item: ScoreItem): Category {
  if (item.kind === 'model') return 'model'
  return item.isUlt ? 'ult' : 'basic'
}
function deniedCount(chances: number): number {
  return chances <= 2 ? chances : Math.ceil(chances / 2)
}
function teamSeats(seat: number): number[] {
  return seat < 5 ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9]
}
function sameTeam(a: number, b: number): boolean {
  return a < 5 === b < 5
}
// Every distinct way to hand the 5 team roles to 5 seats (60 of them).
const ROLE_PERMUTATIONS: Role[][] = (() => {
  const out = new Set<string>()
  const go = (left: Role[], acc: Role[]): void => {
    if (!left.length) {
      out.add(acc.join(','))
      return
    }
    left.forEach((r, i) => go([...left.slice(0, i), ...left.slice(i + 1)], [...acc, r]))
  }
  go(TEAM_ROLES, [])
  return [...out].map((x) => x.split(',') as Role[])
})()

type RoleProfile = Record<Role, number>
interface Assignment {
  roles: Record<number, Role>
  lost: number
  total: number
}
interface Outlook {
  seat: number
  cat: Category
  chances: number
  denied: number
  slots: number
  opts: { item: ScoreItem; p: number }[]
  keepIdx: number
}
interface PersonalParts {
  base: number
  ownSynergy: number
  combo: number
  scepter: number
  shard: number
  pool: number
  getBack: number
  personal: number
}
interface UpgradeUnit {
  id: string
  members: string[]
  excess: number
}
type CategoryBonuses = Record<Category, number> & { modelGroup?: Set<ScoreItem> }

/**
 * One draft state, scored the simulator's way. Build one per scan and call decide()
 * for each seat; role/seat caches are shared between those calls.
 */
export class DraftScorer {
  private readonly picks: readonly (readonly ScoreItem[])[]
  private readonly pickIndex: number
  /** Unpicked items (the simulator's pool.filter(a => !a.picked)). */
  private readonly unpicked: readonly ScoreItem[]
  /** Unpicked + picked: the whole draft pool, for tentative model roles. */
  private readonly pool: readonly ScoreItem[]
  private modelRoles: Map<string, RoleProfile | null> | null = null
  private readonly seatRoles = new Map<number, Role | null>()

  constructor(
    private readonly data: EngineData,
    state: ScoreState,
  ) {
    this.picks = state.picks
    this.pickIndex = state.pickIndex
    this.unpicked = state.available
    this.pool = [...state.available, ...state.picks.flat()]
  }

  // ---- Synergy ----
  private isModelName(name: string): boolean {
    return this.data.modelTypes.has(name)
  }
  estimatedModelSynergy(nameA: string, nameB: string): number {
    const [model, ability] = this.isModelName(nameA) ? [nameA, nameB] : [nameB, nameA]
    if (!this.isModelName(model) || this.isModelName(ability)) return 0
    const bakedKey = synergyKeyFor(nameA, nameB)
    const baked = this.data.bakedEstimated.get(bakedKey)
    if (baked !== undefined) return baked
    const shifts = this.data.modelShifts[ability]
    if (!shifts) return 0
    const [attr, attackType] = this.data.modelTypes.get(model) as [string, string]
    return (MODEL_SHIFT_WEIGHT * ((shifts[attr] || 0) + (shifts[attackType] || 0))) / 2
  }
  synergyIsEstimated(nameA: string, nameB: string): boolean {
    const key = synergyKeyFor(nameA, nameB)
    return (
      nameA !== nameB &&
      (this.data.bakedEstimated.has(key) ||
        (!this.data.synergy.has(key) && this.estimatedModelSynergy(nameA, nameB) !== 0))
    )
  }
  synergyBetween(nameA: string, nameB: string): number {
    if (nameA === nameB) return 0
    const key = synergyKeyFor(nameA, nameB)
    const baked = this.data.bakedEstimated.get(key)
    if (baked !== undefined) return baked
    const known = this.data.synergy.get(key)
    if (known !== undefined) return known
    return this.estimatedModelSynergy(nameA, nameB)
  }
  hasSynergyData(nameA: string, nameB: string): boolean {
    if (nameA === nameB) return false
    const key = synergyKeyFor(nameA, nameB)
    return this.data.synergy.has(key) && !this.data.bakedEstimated.has(key)
  }
  private knownComboApplies(nameA: string, nameB: string): boolean {
    return this.hasSynergyData(nameA, nameB)
  }

  // ---- Scepter / shard estimate ----
  private upgradeUnits(names: string[], kind: UpgradeKind): UpgradeUnit[] {
    const set = new Set(names)
    const units = new Map<string, UpgradeUnit>()
    for (const n of names) {
      const u = this.data.upgrades[kind][n]
      if (!u || !(u.needs || []).every((x) => set.has(x))) continue
      const members = [n, ...(u.needs || [])].sort()
      const id = members.join('+')
      const prev = units.get(id)
      if (!prev || u.excess > prev.excess) units.set(id, { id, members, excess: u.excess })
    }
    return [...units.values()]
  }
  private unitsHavePairData(a: UpgradeUnit, b: UpgradeUnit): boolean {
    return a.members.some((x) => b.members.some((y) => this.hasSynergyData(x, y)))
  }
  private upgradeTerm(item: ScoreItem, seat: number, kind: UpgradeKind): number {
    const heldNames = this.picks[seat].map((h) => h.name)
    const before = new Set(this.upgradeUnits(heldNames, kind).map((u) => u.id))
    const units = this.upgradeUnits([...heldNames, item.name], kind)
    const weightOf = (u: UpgradeUnit): number => {
      if (u.members.includes(item.name)) return Infinity
      const idx = Math.max(...u.members.map((m) => heldNames.indexOf(m)))
      return SYNERGY_ORDER_WEIGHTS[idx]
    }
    const M = this.synergyMultiplier()
    const rule = UPGRADE_RULES[kind]
    let value = 0
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i]
        const b = units[j]
        if (before.has(a.id) && before.has(b.id)) continue
        if (this.unitsHavePairData(a, b)) continue
        const m = Math.max(0, Math.min(a.excess, b.excess))
        const raw = Math.min(rule.cap, rule.coef * m * m)
        value += raw * M * Math.min(weightOf(a), weightOf(b))
      }
    }
    return -value
  }

  private sumPositiveSynergy(itemName: string, others: readonly ScoreItem[]): number {
    return others.reduce((sum, o) => {
      const s = this.synergyBetween(itemName, o.name)
      return s > 0 ? sum + s : sum
    }, 0)
  }
  private synergyMultiplier(): number {
    return SYNERGY_MULTIPLIER_BASE + this.pickIndex * SYNERGY_MULTIPLIER_INCREMENT
  }
  private knownComboBonus(): number {
    return this.pickIndex * this.pickIndex * KNOWN_COMBO_BONUS_COEFFICIENT
  }

  // ---- Pool upside ----
  private poolPartnersFor(item: ScoreItem, seat: number): ScoreItem[] {
    const own = categoryOf(item)
    return this.unpicked.filter(
      (o) =>
        o !== item && this.slotsLeftFor(seat, categoryOf(o)) - (categoryOf(o) === own ? 1 : 0) > 0,
    )
  }
  private poolSynergyTerm(item: ScoreItem, seat: number): number {
    const weight = POOL_SYNERGY_WEIGHTS_BY_PICKS_MADE[this.picks[seat].length]
    return this.sumPositiveSynergy(item.name, this.poolPartnersFor(item, seat)) * weight
  }

  // ---- Get-back ----
  private getBackTerms(
    seat: number,
    available: readonly ScoreItem[],
    pre: Map<ScoreItem, number>,
    roleAfter: Map<ScoreItem, Role | null>,
  ): Map<ScoreItem, number> {
    const out = new Map(available.map((a) => [a, 0]))
    if (nextPickIndexFor(seat, this.pickIndex) == null) return out
    const M = this.synergyMultiplier()
    const B = this.knownComboBonus()
    const W = SYNERGY_ORDER_WEIGHTS[this.picks[seat].length] ?? 0
    const cats: { cat: Category; taken: number; opts: ScoreItem[] }[] = []
    for (const cat of CATEGORIES) {
      if (!this.slotsLeftFor(seat, cat)) continue
      const enemyPicks = this.opposingPicksBefore(seat, cat) as number
      const taken = deniedCount(enemyPicks)
      const opts = available
        .filter((a) => categoryOf(a) === cat && Number.isFinite(pre.get(a)))
        .sort((a, b) => (pre.get(a) as number) - (pre.get(b) as number))
      cats.push({ cat, taken, opts })
    }
    for (const x of available) {
      const own = categoryOf(x)
      const role = roleAfter.get(x) || null
      const estW = role ? ESTIMATED_MODEL_PENALTY_BY_ROLE[role] : 1
      let total = 0
      for (const c of cats) {
        if (this.slotsLeftFor(seat, c.cat) - (c.cat === own ? 1 : 0) <= 0) continue
        const group = c.cat === 'model' && role ? role : null
        const left = c.opts
          .filter((o) => o !== x && (!group || this.fitsRole(o, group)))
          .slice(c.taken)
        if (!left.length) continue
        const without = left[0]
        let withV: number | null = null
        for (const y of left) {
          const raw = this.synergyBetween(x.name, y.name)
          const syn = this.synergyIsEstimated(x.name, y.name) ? raw * estW : raw
          const v =
            (pre.get(y) as number) -
            syn * M * W -
            (this.knownComboApplies(x.name, y.name) ? B * W : 0)
          if (withV === null || v < withV) withV = v
        }
        total += (withV as number) - (pre.get(without) as number)
      }
      out.set(x, total * GET_BACK_WEIGHT)
    }
    return out
  }

  // ---- Draft order helpers ----
  private opposingPicksBefore(seat: number, cat: Category): number | null {
    const next = nextPickIndexFor(seat, this.pickIndex)
    if (next == null) return null
    const turns = new Map<number, number>()
    for (let i = this.pickIndex + 1; i < next; i++) {
      const s = PICK_ORDER[i]
      if (sameTeam(s, seat)) continue
      turns.set(s, (turns.get(s) || 0) + 1)
    }
    let n = 0
    for (const [s, t] of turns) n += Math.min(t, this.slotsLeftFor(s, cat))
    return n
  }
  slotsLeftFor(seat: number, cat: Category): number {
    const held = this.picks[seat]
    if (cat === 'model') return held.some((x) => x.kind === 'model') ? 0 : 1
    const abilities = held.filter((x) => x.kind === 'ability')
    if (cat === 'ult') return abilities.some((a) => a.isUlt) ? 0 : 1
    return 3 - abilities.filter((a) => !a.isUlt).length
  }

  // ---- Enemy denial / ally avoid ----
  private seatOutlook(
    seat: number,
    cat: Category,
    cache: Map<string, Outlook | null>,
  ): Outlook | null {
    const key = `${seat}|${cat}`
    if (cache.has(key)) return cache.get(key) as Outlook | null
    let out: Outlook | null = null
    const slots = this.slotsLeftFor(seat, cat)
    const chances = slots ? this.opposingPicksBefore(seat, cat) : null
    if (chances != null) {
      const opts = this.unpicked
        .filter((o) => categoryOf(o) === cat)
        .map((o) => ({ item: o, p: this.buildFitScore(o, seat) }))
        .sort((a, b) => a.p - b.p)
      const denied = deniedCount(chances)
      out = { seat, cat, chances, denied, slots, opts, keepIdx: denied }
    }
    cache.set(key, out)
    return out
  }
  private buildFitScore(item: ScoreItem, seat: number): number {
    const pp = this.personalParts(item, seat)
    return pp.ownSynergy + pp.combo + pp.scepter + pp.shard
  }
  private denialLoss(out: Outlook | null, item: ScoreItem): number {
    if (!out) return 0
    const rank = out.opts.findIndex((x) => x.item === item)
    if (rank !== 0) return 0
    const best = out.opts[0].p
    const next = out.opts.length > 1 ? out.opts[1].p : Infinity
    return Math.min(Math.max(next - best, 0), SCARCITY_CAP) * SCARCITY_WEIGHT
  }
  private clearBestTaker(
    item: ScoreItem,
    seats: number[],
    beforeIdx: number,
    cache: Map<string, Outlook | null>,
  ): number | null {
    const cat = categoryOf(item)
    for (const s of seats) {
      const sNext = nextPickIndexFor(s, this.pickIndex)
      if (sNext == null || sNext > beforeIdx || !this.picks[s].length) continue
      const out = this.seatOutlook(s, cat, cache)
      if (!out || !out.opts.length || out.opts[0].item !== item) continue
      const best = out.opts[0].p
      const next = out.opts.length > 1 ? out.opts[1].p : Infinity
      if (best < 0 && best < next) return s
    }
    return null
  }
  private teammateTakesFirst(
    item: ScoreItem,
    seat: number,
    enemy: number,
    cache: Map<string, Outlook | null>,
  ): number | null {
    const enemyNext = nextPickIndexFor(enemy, this.pickIndex)
    if (enemyNext == null) return null
    return this.clearBestTaker(item, alliesOf(seat), enemyNext, cache)
  }
  private enemySynergyTerm(
    item: ScoreItem,
    seat: number,
    cache: Map<string, Outlook | null>,
  ): number {
    const cat = categoryOf(item)
    return enemiesOf(seat).reduce((t, e) => {
      const loss = this.denialLoss(this.seatOutlook(e, cat, cache), item)
      return t + (loss && this.teammateTakesFirst(item, seat, e, cache) != null ? 0 : loss)
    }, 0)
  }
  private enemyTakesFirst(
    item: ScoreItem,
    ally: number,
    cache: Map<string, Outlook | null>,
  ): number | null {
    const allyNext = nextPickIndexFor(ally, this.pickIndex)
    if (allyNext == null) return null
    return this.clearBestTaker(item, enemiesOf(ally), allyNext, cache)
  }
  private allyLoss(
    out: Outlook | null,
    item: ScoreItem,
    ally: number,
    cache: Map<string, Outlook | null>,
  ): number {
    if (!out) return 0
    const rank = out.opts.findIndex((x) => x.item === item)
    if (rank < 0 || rank > out.keepIdx) return 0
    const at = (i: number): number => (i < out.opts.length ? out.opts[i].p : Infinity)
    const raw =
      Math.min(Math.max(at(out.keepIdx + 1) - at(rank), 0), SCARCITY_CAP) * SCARCITY_WEIGHT
    const enemy = raw ? this.enemyTakesFirst(item, ally, cache) : null
    return enemy != null ? 0 : raw
  }
  private allySynergyTerm(
    item: ScoreItem,
    seat: number,
    cache: Map<string, Outlook | null>,
  ): number {
    const cat = categoryOf(item)
    return alliesOf(seat).reduce(
      (t, a) => t + this.allyLoss(this.seatOutlook(a, cat, cache), item, a, cache),
      0,
    )
  }

  // ---- Personal score ----
  private shownBase(item: ScoreItem): number {
    return (
      BASE_PICK_OFFSET -
      BASE_PICK_WEIGHT * (item.pickPositionHigh as number) +
      (this.data.value[item.name] || 0) / VALUE_DIVISOR
    )
  }
  seatRole(seat: number): Role | null {
    if (!this.picks[seat].some((x) => this.roleData(x))) return null
    if (!this.seatRoles.has(seat)) this.seatRoles.set(seat, this.teamAssignment(seat).roles[seat])
    return this.seatRoles.get(seat) as Role
  }
  private teamPlayWeight(seat: number): number {
    const r = this.seatRole(seat)
    return r ? TEAM_PLAY_BY_ROLE[r] : 1
  }
  private estimatedPenaltyWeight(seat: number): number {
    const r = this.seatRole(seat)
    return r ? ESTIMATED_MODEL_PENALTY_BY_ROLE[r] : 1
  }
  private modelScarcityWeight(seat: number): number {
    const r = this.seatRole(seat)
    return r ? MODEL_SCARCITY_BY_ROLE[r] : 1
  }
  private botSynergy(nameA: string, nameB: string, seat: number): number {
    const syn = this.synergyBetween(nameA, nameB)
    return this.synergyIsEstimated(nameA, nameB) ? syn * this.estimatedPenaltyWeight(seat) : syn
  }
  private personalParts(item: ScoreItem, seat: number, getBack = 0): PersonalParts {
    const base = item.pickPositionHigh == null ? Infinity : this.shownBase(item) / DISPLAY_SCALE
    const multiplier = this.synergyMultiplier()
    const bonus = this.knownComboBonus()
    let ownSynergy = 0
    let combo = 0
    this.picks[seat].forEach((held, i) => {
      const orderWeight = SYNERGY_ORDER_WEIGHTS[i]
      ownSynergy -= this.botSynergy(item.name, held.name, seat) * multiplier * orderWeight
      if (this.knownComboApplies(item.name, held.name)) combo -= bonus * orderWeight
    })
    const pool = -this.poolSynergyTerm(item, seat)
    const scepter = this.upgradeTerm(item, seat, 'scepter')
    const shard = this.upgradeTerm(item, seat, 'shard')
    return {
      base,
      ownSynergy,
      combo,
      scepter,
      shard,
      pool,
      getBack,
      personal: base + ownSynergy + combo + scepter + shard + pool + getBack,
    }
  }

  // ---- Category scarcity ----
  private categoryScarcityBonuses(
    seat: number,
    available: readonly ScoreItem[],
    personal: Map<ScoreItem, number>,
  ): CategoryBonuses {
    const bonuses: CategoryBonuses = { model: 0, ult: 0, basic: 0 }
    const next = nextPickIndexFor(seat, this.pickIndex)
    if (next == null) return bonuses
    const myRole = this.seatRole(seat)
    const group = myRole
      ? available.filter((a) => a.kind === 'model' && this.fitsRole(a, myRole))
      : null
    for (const cat of CATEGORIES) {
      const options =
        cat === 'model' && group ? group : available.filter((a) => categoryOf(a) === cat)
      if (!options.length) continue
      const enemyPicks = this.opposingPicksBefore(seat, cat) as number
      const taken = deniedCount(enemyPicks)
      const scores = options.map((a) => personal.get(a) as number).sort((a, b) => a - b)
      const best = scores[0]
      if (!Number.isFinite(best)) continue
      const idx = taken + this.slotsLeftFor(seat, cat) - 1
      const fallback = idx < scores.length ? scores[idx] : Infinity
      const urgency = Math.min(Math.max(fallback - best, 0), SCARCITY_CAP)
      const roleMult = cat === 'model' ? this.modelScarcityWeight(seat) : 1
      bonuses[cat] = urgency * SCARCITY_WEIGHT * roleMult
    }
    if (group) bonuses.modelGroup = new Set(group)
    return bonuses
  }

  // ---- Roles ----
  private buildModelRoles(): Map<string, RoleProfile | null> {
    const map = new Map<string, RoleProfile | null>()
    const raws = new Map<string, RoleProfile>()
    const models = this.pool.filter((m) => m.kind === 'model')
    for (const m of models) {
      const partners = this.pool.filter(
        (a) =>
          a.kind === 'ability' && this.data.role[a.name] && this.hasSynergyData(m.name, a.name),
      )
      if (!partners.length) {
        map.set(m.name, null)
        continue
      }
      const raw = {} as RoleProfile
      ROLES.forEach((r) => {
        raw[r] =
          partners.reduce(
            (t, a) =>
              t + Math.max(-ROLE_Z_CAP, Math.min(ROLE_Z_CAP, this.data.role[a.name][r] || 0)),
            0,
          ) / partners.length
      })
      raws.set(m.name, raw)
      map.set(m.name, raw)
    }
    const vals = [...raws.values()].flatMap((d) => ROLES.map((r) => d[r]))
    const mean = vals.reduce((t, v) => t + v, 0) / (vals.length || 1)
    const sd = Math.sqrt(vals.reduce((t, v) => t + (v - mean) ** 2, 0) / (vals.length || 1)) || 1
    for (const [name, raw] of raws) {
      const scaled = {} as RoleProfile
      ROLES.forEach((r) => {
        scaled[r] = raw[r] / sd
      })
      map.set(name, scaled)
    }
    return map
  }
  private modelRoleData(model: ScoreItem): RoleProfile | null {
    if (!this.modelRoles) this.modelRoles = this.buildModelRoles()
    return this.modelRoles.get(model.name) || null
  }
  private roleData(item: ScoreItem): Partial<RoleProfile> | null {
    if (item.kind === 'model') return this.modelRoleData(item)
    return this.data.role[item.name] || null
  }
  private roleZ(item: ScoreItem, r: Role): number {
    const d = this.roleData(item)
    return d ? Math.max(-ROLE_Z_CAP, Math.min(ROLE_Z_CAP, d[r] || 0)) : 0
  }
  itemRoles(item: ScoreItem): Role[] | null {
    const d = this.roleData(item)
    if (!d) return null
    const best = Math.max(...ROLES.map((r) => this.roleZ(item, r)))
    return ROLES.filter(
      (r) => this.roleZ(item, r) >= ROLE_FIT_Z || this.roleZ(item, r) >= best - ROLE_FIT_SPREAD,
    )
  }
  private seatRoleZ(item: ScoreItem, r: Role): number {
    const z = this.roleZ(item, r)
    return r === 'offlane' ? Math.max(z, this.roleZ(item, 'support') - OFFLANE_SUPPORT_DISCOUNT) : z
  }
  private roleFit(item: ScoreItem, r: Role): number {
    if (!this.roleData(item)) return 1
    const best = Math.max(...ROLES.map((x) => this.roleZ(item, x)))
    return Math.max(
      0,
      Math.min(1, 1 - (best - this.seatRoleZ(item, r)) / Math.max(best, ROLE_FIT_FLOOR)),
    )
  }
  private fitsRole(item: ScoreItem, r: Role): boolean {
    const rs = this.itemRoles(item)
    return !rs || rs.includes(r)
  }
  private teamAssignment(seat: number, extra?: { seat: number; item: ScoreItem }): Assignment {
    const seats = teamSeats(seat)
    const held = seats.map((s) =>
      [...this.picks[s], ...(extra && extra.seat === s ? [extra.item] : [])].filter((x) =>
        this.roleData(x),
      ),
    )
    const prof = held.map(
      (h) =>
        Object.fromEntries(
          ROLES.map((r) => [r, h.reduce((t, x) => t + this.roleZ(x, r), 0)]),
        ) as RoleProfile,
    )
    let best: { perm: Role[]; total: number; lost: number } | null = null
    for (const perm of ROLE_PERMUTATIONS) {
      let total = 0
      let lost = 0
      perm.forEach((r, i) => {
        total += prof[i][r]
        held[i].forEach((x) => {
          lost += 1 - this.roleFit(x, r)
        })
      })
      if (
        !best ||
        lost < best.lost - 1e-9 ||
        (Math.abs(lost - best.lost) <= 1e-9 && total > best.total)
      ) {
        best = { perm, total, lost }
      }
    }
    const b = best as { perm: Role[]; total: number; lost: number }
    const roles: Record<number, Role> = {}
    seats.forEach((s, i) => {
      roles[s] = b.perm[i]
    })
    return { roles, lost: b.lost, total: b.total }
  }
  private roleAlignmentTerm(
    item: ScoreItem,
    seat: number,
    before: Assignment,
    baseInternal: number,
  ): { cost: number; after?: Assignment } {
    if (!this.roleData(item) || !Number.isFinite(baseInternal)) return { cost: 0 }
    const full = Math.max(0, -baseInternal) * OFF_ROLE_CUT
    const after = this.teamAssignment(seat, { seat, item })
    const shiftLost = Math.min(1, Math.max(0, after.lost - before.lost))
    const hasRole = this.picks[seat].some((x) => this.roleData(x))
    const keepRole = hasRole ? before.roles[seat] : null
    const keepLost = keepRole
      ? Math.min(
          1,
          Math.max(0, (ROLE_KEEP_Z[keepRole] - this.seatRoleZ(item, keepRole)) / ROLE_KEEP_SPAN),
        )
      : Infinity
    const keep = keepLost <= shiftLost
    const lost = keep ? keepLost : shiftLost
    return { cost: full * lost, after: keep ? before : after }
  }
  private teamOpposingPicksBefore(seat: number, cat: Category): number | null {
    let next: number | null = null
    for (let i = this.pickIndex + 1; i < PICK_ORDER.length; i++) {
      if (teamSeats(seat).includes(PICK_ORDER[i])) {
        next = i
        break
      }
    }
    if (next == null) return null
    const turns = new Map<number, number>()
    for (let i = this.pickIndex + 1; i < next; i++)
      turns.set(PICK_ORDER[i], (turns.get(PICK_ORDER[i]) || 0) + 1)
    let n = 0
    for (const [s, t] of turns) n += Math.min(t, this.slotsLeftFor(s, cat))
    return n
  }
  private roleScarcityBonuses(
    seat: number,
    available: readonly ScoreItem[],
    personal: Map<ScoreItem, number>,
    assignment: Assignment,
  ): Record<string, number> {
    const out: Record<string, number> = {}
    for (const cat of CATEGORIES) {
      const enemyPicks = this.teamOpposingPicksBefore(seat, cat)
      if (enemyPicks == null) continue
      const taken = deniedCount(enemyPicks)
      for (const r of ROLES) {
        const open = teamSeats(seat).some(
          (s) => assignment.roles[s] === r && this.slotsLeftFor(s, cat) > 0,
        )
        const opts = available
          .filter((a) => categoryOf(a) === cat && this.roleData(a) && this.fitsRole(a, r))
          .map((a) => ({ item: a, p: personal.get(a) as number }))
          .sort((a, b) => a.p - b.p)
        if (!opts.length || !Number.isFinite(opts[0].p)) continue
        const best = opts[0].p
        const fallback = taken < opts.length ? opts[taken].p : Infinity
        out[`${cat}|${r}`] = open
          ? Math.min(Math.max(fallback - best, 0), SCARCITY_CAP) * SCARCITY_WEIGHT
          : 0
      }
    }
    return out
  }
  private roleScarcityFor(
    item: ScoreItem,
    bonuses: Record<string, number> | null,
    roleAfter: Role | null,
  ): number {
    if (!bonuses || !this.roleData(item)) return 0
    let best = 0
    for (const r of this.itemRoles(item) as Role[]) {
      if (roleAfter && r !== roleAfter) continue
      const b = bonuses[`${categoryOf(item)}|${r}`] || 0
      if (b > best) best = b
    }
    return best
  }

  private scoreParts(
    item: ScoreItem,
    seat: number,
    pp: PersonalParts,
    scarcity: CategoryBonuses,
    outlooks: Map<string, Outlook | null>,
    assignment: Assignment,
    roleBonuses: Record<string, number>,
  ): ScoreRow {
    const tw = this.teamPlayWeight(seat)
    const enemy = -this.enemySynergyTerm(item, seat, outlooks) * tw
    const ally = this.allySynergyTerm(item, seat, outlooks) * tw
    const scarcityPart =
      item.kind === 'model' && scarcity.modelGroup && !scarcity.modelGroup.has(item)
        ? 0
        : -scarcity[categoryOf(item)]
    const align = this.roleAlignmentTerm(item, seat, assignment, pp.base)
    const roleScarcity = -this.roleScarcityFor(
      item,
      roleBonuses,
      align.after ? align.after.roles[seat] : null,
    )
    const role = align.cost
    return {
      item,
      ...pp,
      enemy,
      ally,
      scarcity: scarcityPart,
      role,
      roleScarcity,
      total: pp.personal + enemy + ally + scarcityPart + role + roleScarcity,
    }
  }

  /**
   * The simulator's botDecision for `seat` picking now: every legal option with its
   * score parts (best first), plus the hard-override deferral and the chosen pick.
   */
  decide(seat: number): Decision {
    const p = seat
    const available = this.unpicked.filter((a) => !pickBlockedFor(this.picks, p, a))
    const decision: Decision = { seat: p, rows: [], deferredCats: [], chosen: null }
    if (!available.length) return decision

    const assignment = this.teamAssignment(p)
    const curRole = this.seatRole(p)
    const roleAfter = new Map<ScoreItem, Role | null>()
    const pre = new Map(
      available.map((a) => {
        const pp = this.personalParts(a, p)
        const align =
          a.kind === 'ability' ? this.roleAlignmentTerm(a, p, assignment, pp.base) : { cost: 0 }
        roleAfter.set(a, align.after ? align.after.roles[p] : curRole)
        return [a, pp.base + pp.ownSynergy + pp.combo + pp.scepter + pp.shard + align.cost]
      }),
    )
    const getBack = this.getBackTerms(p, available, pre, roleAfter)
    const parts = new Map(available.map((a) => [a, this.personalParts(a, p, getBack.get(a))]))
    const personal = new Map(
      available.map((a) => {
        const pp = parts.get(a) as PersonalParts
        return [a, pp.personal - pp.getBack]
      }),
    )
    const bonuses = this.categoryScarcityBonuses(p, available, personal)
    const outlooks = new Map<string, Outlook | null>()
    const roleScarcityOff = !!this.seatRole(p)
    const roleBonuses = roleScarcityOff
      ? {}
      : this.roleScarcityBonuses(p, available, personal, assignment)
    if (!roleScarcityOff) {
      bonuses.model = bonuses.ult = bonuses.basic = 0
      delete bonuses.modelGroup
    }
    decision.rows = available
      .map((a) =>
        this.scoreParts(
          a,
          p,
          parts.get(a) as PersonalParts,
          bonuses,
          outlooks,
          assignment,
          roleBonuses,
        ),
      )
      .sort((x, y) => x.total - y.total)

    // Hard override (see the simulator's botDecision): categories no enemy can take
    // from before this seat's next turn are deferred while another is open.
    const next = nextPickIndexFor(p, this.pickIndex)
    const enemiesBefore =
      next == null
        ? null
        : [...new Set(PICK_ORDER.slice(this.pickIndex + 1, next))].filter((s) =>
            enemiesOf(p).includes(s),
          )
    const openCats = [...new Set(decision.rows.map((r) => categoryOf(r.item)))]
    const allEnemiesFull = openCats.filter((cat) =>
      enemiesOf(p).every((e) => this.slotsLeftFor(e, cat) === 0),
    )
    const safeBeforeNext =
      enemiesBefore == null
        ? []
        : openCats.filter(
            (cat) =>
              !allEnemiesFull.includes(cat) &&
              enemiesBefore.every((e) => this.slotsLeftFor(e, cat) === 0),
          )
    const enemyFull =
      enemiesBefore == null
        ? []
        : [...allEnemiesFull, ...(safeBeforeNext.length >= 2 ? [] : safeBeforeNext)]
    const deferrable = decision.rows.filter((r) => enemyFull.includes(categoryOf(r.item)))
    decision.deferredCats =
      deferrable.length < decision.rows.length
        ? [...new Set(deferrable.map((r) => categoryOf(r.item)))]
        : []
    const chosen = decision.rows.find((r) => !decision.deferredCats.includes(categoryOf(r.item)))
    decision.chosen = chosen ? chosen.item : null
    return decision
  }
}
