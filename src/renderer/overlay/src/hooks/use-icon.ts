import { useEffect, useState } from 'react'

// @DEV-GUIDE: Mini icon (ability or hero model) as a data: URL, fetched once from the main
// process (main/services/icon-data-service.ts) and cached for the life of the overlay.
// A miss (icon not downloaded yet, offline) retries a few times, slowly, then gives up
// until the component next mounts — menus refresh every scan, so this must stay cheap.

export type IconKind = 'ability' | 'model'

const RETRY_DELAY_MS = 4_000
const MAX_ATTEMPTS = 4

const resolved = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

function fetchIcon(kind: IconKind, name: string): Promise<string | null> {
  const key = `${kind}/${name}`
  let pending = inflight.get(key)
  if (!pending) {
    pending = window.electronApi
      .invoke('icon:get', { kind, name })
      .then((url) => {
        if (url) resolved.set(key, url)
        return url
      })
      .catch(() => null)
      .finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  return pending
}

export function useIcon(kind: IconKind, name: string): string | null {
  const key = `${kind}/${name}`
  const [url, setUrl] = useState<string | null>(resolved.get(key) ?? null)

  useEffect(() => {
    const cached = resolved.get(key)
    if (cached) {
      setUrl(cached)
      return
    }
    setUrl(null)

    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const attempt = (n: number): void => {
      void fetchIcon(kind, name).then((result) => {
        if (!alive) return
        if (result) setUrl(result)
        else if (n + 1 < MAX_ATTEMPTS) timer = setTimeout(() => attempt(n + 1), RETRY_DELAY_MS)
      })
    }
    attempt(0)
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [key, kind, name])

  return url
}

/** Test hook: forget every cached icon. */
export function clearIconCache(): void {
  resolved.clear()
  inflight.clear()
}
