// @DEV-GUIDE: Where Valve publishes official ability art. The pick-row scan
// template-matches against these icons (see ml-worker.ts / core/ml/template-matcher.ts),
// so the icon cache (main/services/icon-cache-service.ts) downloads one per ability.
// Ability internal names map 1:1 onto the CDN's file names, except Ability Draft
// variants (invoker_*_ad, kez_*_ad), which share the base ability's art.

const VALVE_CDN_BASE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react'

/** Renamed abilities whose legacy class name survives in our data: name -> CDN file name. */
export const ABILITY_ICON_NAME_OVERRIDES: Readonly<Record<string, string>> = {}

export function resolveAbilityIconName(abilityName: string): string {
  const override = ABILITY_ICON_NAME_OVERRIDES[abilityName]
  if (override) return override
  if (abilityName.endsWith('_ad')) return abilityName.slice(0, -3)
  return abilityName
}

export function abilityCdnUrl(abilityName: string): string {
  return `${VALVE_CDN_BASE}/abilities/${resolveAbilityIconName(abilityName)}.png`
}

/** True when the name is safe to use as a URL path segment / file name. */
export function isSafeIconName(name: string): boolean {
  return /^[a-z0-9_]+$/.test(name)
}
