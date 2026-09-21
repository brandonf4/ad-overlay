import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => tmpdir() } }))
vi.mock('electron-log/main', () => ({
  default: { scope: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) },
}))

import { createIconCacheService } from '../../../../src/main/services/icon-cache-service'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'icon-cache-get-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const ok = (body: string): Response => new Response(body, { status: 200 })

// getIcon backs the menus' mini icons: cache-through reads of one ability icon / hero portrait.
describe('icon cache getIcon', () => {
  it('downloads a hero portrait from the heroes CDN path, then serves it from disk', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url)
      return ok('portrait-bytes')
    }) as unknown as typeof fetch
    const cache = createIconCacheService({ cacheRoot: root, fetchImpl })

    const first = await cache.getIcon('heroes', 'antimage')
    expect(first?.toString()).toBe('portrait-bytes')
    expect(urls[0]).toMatch(/\/heroes\/antimage\.png$/)
    expect(readFileSync(join(root, 'heroes', 'antimage.png'), 'utf-8')).toBe('portrait-bytes')

    const second = await cache.getIcon('heroes', 'antimage')
    expect(second?.toString()).toBe('portrait-bytes')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('serves an already-cached ability icon without touching the network', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const cache = createIconCacheService({ cacheRoot: root, fetchImpl })
    writeFileSync(join(root, 'abilities', 'axe_culling_blade.png'), 'cached')
    expect((await cache.getIcon('abilities', 'axe_culling_blade'))?.toString()).toBe('cached')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('remembers a failure briefly instead of re-requesting on every menu refresh', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch
    const cache = createIconCacheService({ cacheRoot: root, fetchImpl })
    expect(await cache.getIcon('heroes', 'nobody')).toBeNull()
    expect(await cache.getIcon('heroes', 'nobody')).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses unsafe names without a network call or file access', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const cache = createIconCacheService({ cacheRoot: root, fetchImpl })
    expect(await cache.getIcon('abilities', '../../secret')).toBeNull()
    expect(await cache.getIcon('heroes', 'a/b')).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
