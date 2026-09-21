import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, utimesSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => tmpdir() } }))
vi.mock('electron-log/main', () => ({
  default: { scope: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) },
}))

import { createIconCacheService } from '../../../../src/main/services/icon-cache-service'
import { ICON_CACHE_REFRESH_TTL_MS } from '@shared/constants/thresholds'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'icon-cache-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const ok = (body: string): Response => new Response(body, { status: 200 })

describe('icon cache prefetch', () => {
  it('creates the icon directory up front (the worker latches to the classifier if it is missing)', () => {
    createIconCacheService({ cacheRoot: root, fetchImpl: vi.fn() as unknown as typeof fetch })
    expect(existsSync(join(root, 'abilities'))).toBe(true)
  })

  it('downloads missing icons and strips the _ad suffix from the CDN url', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url)
      return ok('png:' + url)
    }) as unknown as typeof fetch
    const cache = createIconCacheService({ cacheRoot: root, fetchImpl })
    const summary = await cache.prefetchAbilities(['abaddon_frostmourne', 'invoker_quas_ad'])
    expect(summary).toMatchObject({ total: 2, fetched: 2, failed: 0 })
    expect(urls.some((u) => u.endsWith('/abilities/invoker_quas.png'))).toBe(true)
    expect(readFileSync(join(root, 'abilities', 'abaddon_frostmourne.png'), 'utf-8')).toContain('abaddon_frostmourne')
    // cached under the ability's own name (what the worker keys templates by)
    expect(existsSync(join(root, 'abilities', 'invoker_quas_ad.png'))).toBe(true)
  })

  it('skips fresh icons, refreshes stale ones only when the art changed', async () => {
    const fetchImpl = vi.fn(async () => ok('new-art')) as unknown as typeof fetch
    const cache = createIconCacheService({ cacheRoot: root, fetchImpl })
    const fresh = join(root, 'abilities', 'a_fresh.png')
    const stale = join(root, 'abilities', 'b_stale.png')
    const staleSame = join(root, 'abilities', 'c_same.png')
    writeFileSync(fresh, 'old')
    writeFileSync(stale, 'old-art')
    writeFileSync(staleSame, 'new-art')
    const past = new Date(Date.now() - ICON_CACHE_REFRESH_TTL_MS - 60_000)
    utimesSync(stale, past, past)
    utimesSync(staleSame, past, past)

    const summary = await cache.prefetchAbilities(['a_fresh', 'b_stale', 'c_same'])
    expect(summary).toMatchObject({ alreadyCached: 2, refreshed: 1, fetched: 0, failed: 0 })
    expect(readFileSync(fresh, 'utf-8')).toBe('old')
    expect(readFileSync(stale, 'utf-8')).toBe('new-art')
  })

  it('counts a CDN miss as failed but keeps a stale copy when one exists', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch
    const cache = createIconCacheService({ cacheRoot: root, fetchImpl })
    const stale = join(root, 'abilities', 'kept.png')
    writeFileSync(stale, 'stale-art')
    const past = new Date(Date.now() - ICON_CACHE_REFRESH_TTL_MS - 60_000)
    utimesSync(stale, past, past)

    const summary = await cache.prefetchAbilities(['missing_one', 'kept'])
    expect(summary).toMatchObject({ failed: 1, alreadyCached: 1 })
    expect(readFileSync(stale, 'utf-8')).toBe('stale-art')
  })

  it('never fetches an unsafe name and survives network errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const cache = createIconCacheService({ cacheRoot: root, fetchImpl })
    const summary = await cache.prefetchAbilities(['../evil', 'fine_name'])
    expect(summary.failed).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
