import { join } from 'path'
import { promises as fs, mkdirSync } from 'fs'
import { app } from 'electron'
import log from 'electron-log/main'
import { abilityCdnUrl, heroCdnUrl, isSafeIconName } from '@core/icons/icon-urls'
import { ICON_CACHE_REFRESH_TTL_MS } from '@shared/constants/thresholds'

// @DEV-GUIDE: Download-through cache of Valve's official ability icons at
// userData/stream-icons/abilities/<name>.png. The ml-worker template-matches the
// player-row pick boxes against these files (ml-service.ts passes this directory as
// pickIconsDir) — far more accurate than the classifier on those flat icon crops.
// Adapted from the upstream icon-cache-service, trimmed to abilities plus on-demand hero
// portraits (userData/stream-icons/heroes/<name>.png) for the menus' mini icons.
// Cached files are not immutable: Valve reworks icon art in place, which silently breaks
// matching, so prefetch revalidates any icon older than ICON_CACHE_REFRESH_TTL_MS with a
// cache-busting fetch (an edge cache is known to serve pre-rework bytes for the bare URL).
// The directory is created up front: the worker latches to the weaker classifier for the
// whole session if it finds the directory missing on its first pick-row scan.
// Every failure is non-fatal — a missing icon just means that ability can't be matched.

const logger = log.scope('icon-cache')

const FETCH_TIMEOUT_MS = 10_000
const PREFETCH_CONCURRENCY = 6

export interface PrefetchSummary {
  total: number
  fetched: number
  alreadyCached: number
  refreshed: number
  failed: number
}

export type IconKind = 'abilities' | 'heroes'

export interface IconCacheService {
  /** Warm the cache for ability internal names (downloads missing, refreshes stale). */
  prefetchAbilities(names: string[]): Promise<PrefetchSummary>
  /**
   * Raw PNG bytes of one ability icon or hero portrait: from the cache, else downloaded
   * (and cached). Null on any failure — a failed name isn't retried for a couple of
   * minutes so a bad name can't hammer the CDN once per menu refresh.
   */
  getIcon(kind: IconKind, name: string): Promise<Buffer | null>
}

export interface IconCacheOptions {
  cacheRoot?: string
  fetchImpl?: typeof fetch
}

export function createIconCacheService(options: IconCacheOptions = {}): IconCacheService {
  const cacheRoot = options.cacheRoot ?? join(app.getPath('userData'), 'stream-icons')
  const abilitiesDir = join(cacheRoot, 'abilities')
  const fetchImpl = options.fetchImpl ?? fetch

  mkdirSync(abilitiesDir, { recursive: true })

  mkdirSync(join(cacheRoot, 'heroes'), { recursive: true })

  const negativeCache = new Map<string, number>() // "kind/name" -> retry-not-before
  const NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000

  async function fetchFromCdn(
    name: string,
    bustCache = false,
    kind: IconKind = 'abilities',
  ): Promise<Buffer | null> {
    let url = kind === 'abilities' ? abilityCdnUrl(name) : heroCdnUrl(name)
    if (bustCache) url += `?_=${Date.now()}`
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!response.ok) {
        logger.warn('CDN icon miss — candidate for ABILITY_ICON_NAME_OVERRIDES', {
          name,
          status: response.status,
          url,
        })
        return null
      }
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      logger.warn('CDN icon fetch failed', {
        name,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  return {
    async getIcon(kind, name) {
      if (!isSafeIconName(name)) return null
      const filePath = join(cacheRoot, kind, `${name}.png`)
      try {
        return await fs.readFile(filePath)
      } catch {
        // cache miss — fall through to the CDN
      }

      const negativeKey = `${kind}/${name}`
      const retryAfter = negativeCache.get(negativeKey)
      if (retryAfter !== undefined && Date.now() < retryAfter) return null

      const data = await fetchFromCdn(name, false, kind)
      if (data === null) {
        negativeCache.set(negativeKey, Date.now() + NEGATIVE_CACHE_TTL_MS)
        return null
      }
      try {
        await fs.writeFile(filePath, data)
      } catch (error) {
        logger.warn('Failed to persist icon to cache', {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return data
    },

    async prefetchAbilities(names) {
      const summary: PrefetchSummary = {
        total: names.length,
        fetched: 0,
        alreadyCached: 0,
        refreshed: 0,
        failed: 0,
      }

      const queue = names.filter(isSafeIconName)
      summary.failed += names.length - queue.length

      async function processOne(name: string): Promise<void> {
        const cachedPath = join(abilitiesDir, `${name}.png`)
        let cachedMtimeMs: number | null = null
        try {
          cachedMtimeMs = (await fs.stat(cachedPath)).mtimeMs
        } catch {
          // not cached yet
        }

        if (cachedMtimeMs !== null && Date.now() - cachedMtimeMs < ICON_CACHE_REFRESH_TTL_MS) {
          summary.alreadyCached++
          return
        }

        const data = await fetchFromCdn(name, cachedMtimeMs !== null)
        if (data === null) {
          // keep a stale copy if there is one — stale art beats no template
          if (cachedMtimeMs !== null) summary.alreadyCached++
          else summary.failed++
          return
        }
        if (cachedMtimeMs !== null) {
          const current = await fs.readFile(cachedPath)
          if (current.equals(data)) {
            const now = new Date()
            await fs.utimes(cachedPath, now, now)
            summary.alreadyCached++
            return
          }
          await fs.writeFile(cachedPath, data)
          logger.info('Cached icon refreshed — upstream art changed', { name })
          summary.refreshed++
          return
        }
        await fs.writeFile(cachedPath, data)
        summary.fetched++
      }

      async function worker(): Promise<void> {
        for (;;) {
          const name = queue.shift()
          if (name === undefined) return
          try {
            await processOne(name)
          } catch (error) {
            summary.failed++
            logger.warn('Icon prefetch failed', {
              name,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }

      await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, () => worker()))
      logger.info('Ability icon prefetch complete', { ...summary })
      return summary
    },
  }
}

/** Ability internal names the classifier knows (same list the ml-worker loads). */
export async function loadAbilityClassNames(): Promise<string[]> {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const raw = JSON.parse(await fs.readFile(join(base, 'model', 'class_names.json'), 'utf-8')) as unknown
  return Array.isArray(raw) ? (raw as string[]) : Object.values(raw as Record<string, string>)
}
