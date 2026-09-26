import { describe, it, expect } from 'vitest'
import { createPoolTracker, DIM_BURST_LIMIT } from '@core/draft-tracking/pool-tracker'
import { picture, dimmed, brightened, tooltip, blackScreen } from './thumb-fixtures'

// A drafted ability's pool box stays in the grid as a dimmed copy of its icon. Whether the
// scanner still names the dimmed icon varies, so these tests cover both: some dimmed boxes
// read as themselves (the Atrophy Aura case from a real draft), most read as unknown.

const available = (key: string, name: string) => ({ key, name, thumb: picture(name) })
const draftedStillNamed = (key: string, name: string) => ({ key, name, thumb: dimmed(picture(name)) })
const draftedUnread = (key: string, name: string) => ({ key, name: null, thumb: dimmed(picture(name)) })
const underTooltip = (key: string) => ({ key, name: null as string | null, thumb: tooltip(key) })

describe('pool tracker: drafted = the box turns into a dimmed copy of its own icon', () => {
  it('keeps a slot available while it keeps reading normally', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    expect(t.update([available('a', 'x_one')]).get('a')).toEqual({ key: 'a', name: 'x_one', picked: false })
  })

  it('marks a drafted ability whose dimmed box the scanner still names (Atrophy Aura)', () => {
    const t = createPoolTracker()
    t.update([available('a', 'atrophy')])
    expect(t.update([draftedStillNamed('a', 'atrophy')]).get('a')?.picked).toBe(false) // one frame is not enough
    expect(t.update([draftedStillNamed('a', 'atrophy')]).get('a')?.picked).toBe(true)
  })

  it('marks a drafted ability whose dimmed box the scanner cannot name', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    t.update([draftedUnread('a', 'x_one')])
    expect(t.update([draftedUnread('a', 'x_one')]).get('a')?.picked).toBe(true)
  })

  it('a dimmed box the scanner names as something ELSE still counts, if it is the same picture', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    const misnamed = { key: 'a', name: 'other_thing', thumb: dimmed(picture('x_one')) }
    t.update([misnamed])
    expect(t.update([misnamed]).get('a')?.picked).toBe(true)
  })

  it('never treats a hover tooltip over the box as drafted, however long it lasts', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    let last
    for (let i = 0; i < 40; i++) last = t.update([underTooltip('a')])
    expect(last!.get('a')?.picked).toBe(false)
  })

  it('a tooltip covering a whole cluster of boxes does not make them vanish', () => {
    const t = createPoolTracker()
    const keys = Array.from({ length: 9 }, (_, i) => `s${i}`)
    t.update(keys.map((k) => available(k, `name_${k}`)))
    let last
    for (let i = 0; i < 10; i++) last = t.update(keys.map(underTooltip))
    expect([...last!.values()].filter((s) => s.picked)).toHaveLength(0)
  })

  it('a dark tooltip that happens to be as dim as a drafted box is still not the same picture', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    for (let i = 0; i < 5; i++) t.update([{ key: 'a', name: null, thumb: tooltip('a') }])
    expect(t.update([underTooltip('a')]).get('a')?.picked).toBe(false)
  })

  it('a black screen (a transition) says nothing — it has no picture to judge', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    let last
    for (let i = 0; i < 10; i++) last = t.update([{ key: 'a', name: null, thumb: blackScreen() }])
    expect(last!.get('a')?.picked).toBe(false)
  })

  it('the brighter gold hover highlight is not dim', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    let last
    for (let i = 0; i < 5; i++) last = t.update([{ key: 'a', name: 'x_one', thumb: brightened(picture('x_one')) }])
    expect(last!.get('a')?.picked).toBe(false)
  })

  it('a partly dim box (not dim enough) is not drafted', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    let last
    for (let i = 0; i < 5; i++) last = t.update([{ key: 'a', name: 'x_one', thumb: dimmed(picture('x_one'), 0.7) }])
    expect(last!.get('a')?.picked).toBe(false)
  })

  it('a normal read in between resets the dim count', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    t.update([draftedUnread('a', 'x_one')])
    t.update([available('a', 'x_one')])
    expect(t.update([draftedUnread('a', 'x_one')]).get('a')?.picked).toBe(false)
  })

  it('a tooltip frame in between does not reset the dim count', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    t.update([draftedUnread('a', 'x_one')])
    t.update([underTooltip('a')])
    expect(t.update([draftedUnread('a', 'x_one')]).get('a')?.picked).toBe(true)
  })

  it('stays drafted while the dimmed box keeps reading dim, whether or not it is named', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    t.update([draftedUnread('a', 'x_one')])
    t.update([draftedUnread('a', 'x_one')])
    for (let i = 0; i < 6; i++) t.update([draftedStillNamed('a', 'x_one')])
    expect(t.update([draftedUnread('a', 'x_one')]).get('a')?.picked).toBe(true)
  })

  it('takes the ability back if the box reads at normal brightness again — it never left', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    t.update([draftedUnread('a', 'x_one')])
    t.update([draftedUnread('a', 'x_one')])
    expect(t.update([available('a', 'x_one')]).get('a')?.picked).toBe(true) // one read: not yet
    expect(t.update([available('a', 'x_one')]).get('a')?.picked).toBe(false)
  })

  it('has no verdict without a normal look to compare against (a box that was never read)', () => {
    const t = createPoolTracker()
    t.update([{ key: 'a', name: 'x_one', thumb: undefined }])
    let last
    for (let i = 0; i < 5; i++) last = t.update([draftedUnread('a', 'x_one')])
    expect(last!.get('a')?.picked).toBe(false)
  })

  it('cannot judge a box whose normal look is already nearly black', () => {
    const t = createPoolTracker()
    const darkIcon = dimmed(picture('x_one'), 0.08) // mean ~9
    t.update([{ key: 'a', name: 'x_one', thumb: darkIcon }])
    let last
    for (let i = 0; i < 5; i++) last = t.update([{ key: 'a', name: null, thumb: dimmed(darkIcon, 0.3) }])
    expect(last!.get('a')?.picked).toBe(false)
  })

  it('many boxes dimming in one scan is a screen-wide effect, not picks', () => {
    const t = createPoolTracker()
    const keys = Array.from({ length: DIM_BURST_LIMIT + 3 }, (_, i) => `s${i}`)
    t.update(keys.map((k) => available(k, `name_${k}`)))
    let last
    for (let i = 0; i < 6; i++) last = t.update(keys.map((k) => draftedStillNamed(k, `name_${k}`)))
    expect([...last!.values()].filter((s) => s.picked)).toHaveLength(0)
    expect(t.drainEvents().some((e) => e.kind === 'burst-ignored')).toBe(true)
  })

  it('a couple of boxes dimming at once (a scan gap over two real picks) still counts', () => {
    const t = createPoolTracker()
    const keys = ['s0', 's1', 's2', 's3', 's4', 's5']
    t.update(keys.map((k) => available(k, `name_${k}`)))
    t.update(keys.map((k, i) => (i < 2 ? draftedUnread(k, `name_${k}`) : available(k, `name_${k}`))))
    const r = t.update(keys.map((k, i) => (i < 2 ? draftedUnread(k, `name_${k}`) : available(k, `name_${k}`))))
    expect([...r.values()].filter((s) => s.picked).map((s) => s.key)).toEqual(['s0', 's1'])
  })

  it('records why it decided, for the log', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    t.update([draftedUnread('a', 'x_one')])
    t.update([draftedUnread('a', 'x_one')])
    const [event] = t.drainEvents()
    expect(event).toMatchObject({ kind: 'drafted', name: 'x_one' })
    expect(event.mean).toBeLessThan(event.refMean! * 0.55)
    expect(event.ncc).toBeGreaterThan(0.9)
    expect(t.drainEvents()).toEqual([]) // drained
  })
})

describe('pool tracker: slots whose ability was not read at first', () => {
  it('adopts a name only after repeated identical reads', () => {
    const t = createPoolTracker()
    t.update([{ key: 'a', name: null }])
    expect(t.update([available('a', 'x_one')]).get('a')?.name).toBeNull()
    expect(t.update([available('a', 'x_one')]).get('a')?.name).toBe('x_one')
  })

  it('does not adopt a name already claimed by another slot', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one'), { key: 'b', name: null }])
    t.update([available('a', 'x_one'), available('b', 'x_one')])
    const r = t.update([available('a', 'x_one'), available('b', 'x_one')])
    expect(r.get('b')?.name).toBeNull()
  })

  it('an adopted slot can then be judged like any other', () => {
    const t = createPoolTracker()
    t.update([{ key: 'a', name: null }])
    t.update([available('a', 'x_one')])
    t.update([available('a', 'x_one')]) // adopted
    t.update([draftedUnread('a', 'x_one')])
    expect(t.update([draftedUnread('a', 'x_one')]).get('a')?.picked).toBe(true)
  })

  it('reset forgets everything', () => {
    const t = createPoolTracker()
    t.update([available('a', 'x_one')])
    t.reset()
    expect(t.update([available('a', 'y_two')]).get('a')).toEqual({ key: 'a', name: 'y_two', picked: false })
  })
})
