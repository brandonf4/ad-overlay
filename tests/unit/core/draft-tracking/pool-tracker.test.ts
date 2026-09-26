import { describe, it, expect } from 'vitest'
import { createPoolTracker } from '@core/draft-tracking/pool-tracker'

const read = (key: string, name: string | null, blank = false) => ({ key, name, blank })
const blankBox = (key: string) => read(key, null, true)
const unreadable = (key: string) => read(key, null, false) // tooltip / hover highlight / other screen

describe('pool tracker', () => {
  it('keeps a slot available while it keeps reading its baseline', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    const r = t.update([read('a', 'x_one')])
    expect(r.get('a')).toEqual({ key: 'a', name: 'x_one', picked: false })
  })

  it('never treats an unreadable-but-not-blank box as drafted, however long it lasts', () => {
    // a hover tooltip lying over the box (or the gold hover highlight) for a long time
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    let last
    for (let i = 0; i < 40; i++) last = t.update([unreadable('a')])
    expect(last!.get('a')?.picked).toBe(false)
  })

  it('a tooltip covering a whole cluster of boxes does not make them all vanish', () => {
    const t = createPoolTracker()
    const keys = Array.from({ length: 9 }, (_, i) => `s${i}`)
    t.update(keys.map((k) => read(k, `name_${k}`)))
    let last
    for (let i = 0; i < 10; i++) last = t.update(keys.map(unreadable))
    expect([...last!.values()].filter((s) => s.picked)).toHaveLength(0)
  })

  it('does not count a confident different read on a non-blank box either', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    for (let i = 0; i < 5; i++) t.update([read('a', 'something_else')])
    expect(t.update([read('a', 'something_else')]).get('a')?.picked).toBe(false)
  })

  it('marks picked after consecutive blank boxes (what a drafted ability leaves)', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    expect(t.update([blankBox('a')]).get('a')?.picked).toBe(false) // one blank frame is not enough
    expect(t.update([blankBox('a')]).get('a')).toEqual({ key: 'a', name: 'x_one', picked: true })
  })

  it('a non-blank frame in between does not reset the blank count', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    t.update([blankBox('a')])
    t.update([unreadable('a')]) // e.g. the cursor's tooltip passes over the empty box
    expect(t.update([blankBox('a')]).get('a')?.picked).toBe(true)
  })

  it('a flat non-dark frame (a white flash) is not a blank box', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    for (let i = 0; i < 5; i++) t.update([unreadable('a')]) // worker reports blank=false for bright frames
    expect(t.update([unreadable('a')]).get('a')?.picked).toBe(false)
  })

  it('a baseline read in between resets the blank count', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    t.update([blankBox('a')])
    t.update([read('a', 'x_one')])
    expect(t.update([blankBox('a')]).get('a')?.picked).toBe(false)
  })

  it('undoes a pick when the baseline ability reads again — a drafted ability never returns', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    t.update([blankBox('a')])
    t.update([blankBox('a')])
    expect(t.update([read('a', 'x_one')]).get('a')?.picked).toBe(true) // one read: not yet
    expect(t.update([read('a', 'x_one')]).get('a')?.picked).toBe(false)
  })

  it('adopts a name for an initially unknown slot only after repeated identical reads', () => {
    const t = createPoolTracker()
    t.update([unreadable('a')])
    expect(t.update([read('a', 'x_one')]).get('a')?.name).toBeNull()
    expect(t.update([read('a', 'x_one')]).get('a')?.name).toBe('x_one')
  })

  it('does not adopt a name already claimed by another slot', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one'), unreadable('b')])
    t.update([read('a', 'x_one'), read('b', 'x_one')])
    const r = t.update([read('a', 'x_one'), read('b', 'x_one')])
    expect(r.get('b')?.name).toBeNull()
  })

  it('reset forgets the baseline', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    t.reset()
    expect(t.update([read('a', 'y_two')]).get('a')).toEqual({ key: 'a', name: 'y_two', picked: false })
  })
})
