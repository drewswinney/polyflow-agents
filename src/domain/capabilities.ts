/**
 * Capability negotiation (§4.1).
 *
 * The backend declares what it supports and the UI omits what is not there.
 * The governing rule, taken from the design:
 *
 * > Absent capabilities are stated once, never rendered as blank tiles — and
 * > never shown disabled.
 */

export interface Capabilities {
  sessions: { search: boolean; rename: boolean; pin: boolean }
  settings: { schemaDriven: boolean; model: boolean; providers: boolean }
  extras: { cron: boolean; skills: boolean; mcp: boolean }
  approvals: { requests: boolean; policy: boolean }
  logs: { events: boolean }
  media: { images: boolean; audioIn: boolean; audioOut: boolean }
  /**
   * Whether this backend *kind* has anywhere to register a push device.
   *
   * Structural, like every other flag here: it says a Hermes host has the
   * route if the plugin is installed, not that this one does. Whether a given
   * host actually answers is a 404 at registration time, which the settings
   * screen reports as "not installed" rather than as a failure — an absent
   * plugin is a host that has not been set up, not a broken app.
   */
  push: { register: boolean }
}

/** Everything off — the floor a backend builds up from. */
export const NO_CAPABILITIES: Capabilities = {
  sessions: { search: false, rename: false, pin: false },
  settings: { schemaDriven: false, model: false, providers: false },
  extras: { cron: false, skills: false, mcp: false },
  approvals: { requests: false, policy: false },
  logs: { events: false },
  media: { images: false, audioIn: false, audioOut: false },
  push: { register: false }
}

/**
 * Human-readable names for the things an agent does not report, so a screen can
 * state the absence once (design §7 non-Hermes variant, §8).
 */
export function missingCapabilityLabels(caps: Capabilities): string[] {
  const missing: string[] = []

  if (!caps.media.audioIn && !caps.media.audioOut) missing.push('Voice')
  if (!caps.extras.skills) missing.push('Skills')
  if (!caps.extras.cron) missing.push('Cron')
  if (!caps.extras.mcp) missing.push('MCP')
  if (!caps.approvals.requests) missing.push('Approvals')

  return missing
}
