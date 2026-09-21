import sharp from 'sharp'
import log from 'electron-log/main'
import type { IconCacheService } from './icon-cache-service'

// @DEV-GUIDE: Serves the overlay's mini icons. Official ability icons / hero portraits are
// large (~30KB); the menus draw them at ~15px, so each is shrunk once to a small PNG and
// handed to the renderer as a data: URL (the overlay window has no file or network
// access of its own). Results are memoized for the session — there are only ~640 icons.
// A failure is not memoized, so an icon that wasn't cached yet appears on a later refresh.

const logger = log.scope('icon-data')

// Drawn at roughly 15 CSS px; 2x that keeps it crisp on scaled displays.
export const MINI_ICON_PX = 32

export type MiniIconKind = 'ability' | 'model'

export interface IconDataService {
  getDataUrl(kind: MiniIconKind, name: string): Promise<string | null>
}

export function createIconDataService(cache: IconCacheService): IconDataService {
  const memo = new Map<string, string>()
  const inflight = new Map<string, Promise<string | null>>()

  async function build(kind: MiniIconKind, name: string): Promise<string | null> {
    const source = await cache.getIcon(kind === 'ability' ? 'abilities' : 'heroes', name)
    if (source === null) return null
    try {
      // Hero portraits are landscape; cover-crop to a square around the interesting part.
      const png = await sharp(source)
        .resize(MINI_ICON_PX, MINI_ICON_PX, { fit: 'cover', position: 'attention' })
        .png()
        .toBuffer()
      return `data:image/png;base64,${png.toString('base64')}`
    } catch (error) {
      logger.warn('Failed to shrink icon', {
        kind,
        name,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  return {
    async getDataUrl(kind, name) {
      const key = `${kind}/${name}`
      const done = memo.get(key)
      if (done) return done
      const pending = inflight.get(key)
      if (pending) return pending

      const promise = build(kind, name)
        .then((url) => {
          if (url) memo.set(key, url)
          return url
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, promise)
      return promise
    },
  }
}
