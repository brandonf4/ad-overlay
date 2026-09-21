import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'

vi.mock('electron-log/main', () => ({
  default: { scope: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) },
}))

import { createIconDataService, MINI_ICON_PX } from '../../../../src/main/services/icon-data-service'
import type { IconCacheService } from '../../../../src/main/services/icon-cache-service'

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png()
    .toBuffer()
}

function fakeCache(getIcon: IconCacheService['getIcon']): IconCacheService {
  return { getIcon, prefetchAbilities: vi.fn() as never }
}

describe('icon data service', () => {
  it('shrinks an icon to a small square PNG data URL', async () => {
    const source = await png(128, 128)
    const service = createIconDataService(fakeCache(async () => source))
    const url = (await service.getDataUrl('ability', 'abaddon_frostmourne'))!
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const meta = await sharp(Buffer.from(url.split(',')[1], 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([MINI_ICON_PX, MINI_ICON_PX])
  })

  it('cover-crops a landscape hero portrait to a square', async () => {
    const source = await png(256, 144)
    const service = createIconDataService(fakeCache(async () => source))
    const url = (await service.getDataUrl('model', 'antimage'))!
    const meta = await sharp(Buffer.from(url.split(',')[1], 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([MINI_ICON_PX, MINI_ICON_PX])
  })

  it('asks for hero portraits for models and ability icons for abilities', async () => {
    const source = await png(64, 64)
    const getIcon = vi.fn(async () => source)
    const service = createIconDataService(fakeCache(getIcon))
    await service.getDataUrl('model', 'antimage')
    await service.getDataUrl('ability', 'axe_berserkers_call')
    expect(getIcon).toHaveBeenNthCalledWith(1, 'heroes', 'antimage')
    expect(getIcon).toHaveBeenNthCalledWith(2, 'abilities', 'axe_berserkers_call')
  })

  it('memoizes successes and shares one in-flight request', async () => {
    const source = await png(64, 64)
    const getIcon = vi.fn(async () => source)
    const service = createIconDataService(fakeCache(getIcon))
    const [a, b] = await Promise.all([service.getDataUrl('ability', 'x'), service.getDataUrl('ability', 'x')])
    await service.getDataUrl('ability', 'x')
    expect(a).toBe(b)
    expect(getIcon).toHaveBeenCalledTimes(1)
  })

  it('does not memoize a miss, so the icon appears once it becomes available', async () => {
    const source = await png(64, 64)
    let available = false
    const service = createIconDataService(fakeCache(async () => (available ? source : null)))
    expect(await service.getDataUrl('ability', 'late')).toBeNull()
    available = true
    expect(await service.getDataUrl('ability', 'late')).not.toBeNull()
  })

  it('returns null for bytes that are not an image instead of throwing', async () => {
    const service = createIconDataService(fakeCache(async () => Buffer.from('not a png')))
    expect(await service.getDataUrl('ability', 'junk')).toBeNull()
  })
})
