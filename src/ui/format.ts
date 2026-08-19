/** Formatting helpers shared by rows and headers. All machine data is mono. */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Relative timestamps as drawn: `4m`, `2h`, `3d`, then a date. */
export function relativeTime(at: number, now = Date.now()): string {
  const delta = Math.max(0, now - at)

  if (delta < MINUTE) return 'now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`

  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** How long until a future moment: `in 6m`, `in 3h`, `in 2d`. */
export function untilTime(at: number, now = Date.now()): string {
  const delta = at - now

  if (delta <= 0) return 'due'
  if (delta < MINUTE) return 'in under a minute'
  if (delta < HOUR) return `in ${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `in ${Math.floor(delta / HOUR)}h`

  return `in ${Math.floor(delta / DAY)}d`
}

export function clockTime(at: number): string {
  const date = new Date(at)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function compactTokens(count: number): string {
  if (count < 1000) return String(count)

  return `${(count / 1000).toFixed(1)}k`
}

export function usd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`

  return `${(ms / 1000).toFixed(1)}s`
}

/** `Today` / `Earlier` grouping for the sessions list. */
export function recencyGroup(at: number, now = Date.now()): 'Today' | 'Earlier' {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)

  return at >= startOfToday.getTime() ? 'Today' : 'Earlier'
}
