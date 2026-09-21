import { describe, it, expect } from 'vitest'
import { createPoolTracker } from '@core/draft-tracking/pool-tracker'

const read = (key: string, name: string | null) => ({ key, name })

describe('pool tracker', () => {
  it('keeps a slot available while it keeps reading its baseline', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    const r = t.update([read('a', 'x_one')])
    expect(r.get('a')).toEqual({ key: 'a', name: 'x_one', picked: false })
  })

  it('does not mark picked on a single differing read (transient misread)', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    expect(t.update([read('a', null)]).get('a')?.picked).toBe(false)
    expect(t.update([read('a', 'x_one')]).get('a')?.picked).toBe(false)
    expect(t.update([read('a', null)]).get('a')?.picked).toBe(false)
  })

  it('marks picked after consecutive misses, including a confident misread of the empty box', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    t.update([read('a', 'other_thing')])
    const r = t.update([read('a', null)])
    expect(r.get('a')).toEqual({ key: 'a', name: 'x_one', picked: true })
  })

  it('keeps picked sticky even if the baseline name reads again', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one')])
    t.update([read('a', null)])
    t.update([read('a', null)])
    expect(t.update([read('a', 'x_one')]).get('a')?.picked).toBe(true)
  })

  it('adopts a name for an initially unknown slot only after repeated identical reads', () => {
    const t = createPoolTracker()
    t.update([read('a', null)])
    expect(t.update([read('a', 'x_one')]).get('a')?.name).toBeNull()
    expect(t.update([read('a', 'x_one')]).get('a')?.name).toBe('x_one')
  })

  it('does not adopt a name already claimed by another slot', () => {
    const t = createPoolTracker()
    t.update([read('a', 'x_one'), read('b', null)])
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
