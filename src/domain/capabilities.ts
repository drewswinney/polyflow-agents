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
  extras: { cron: boolean; skills: boolean; mcp: boolean; profiles: boolean }
  approvals: { requests: boolean; policy: boolean }
  activity: { spend: boolean; events: boolean }
  media: { images: boolean; audioIn: boolean; audioOut: boolean }
}

/** Everything off — the floor a backend builds up from. */
export const NO_CAPABILITIES: Capabilities = {
  sessions: { search: false, rename: false, pin: false },
  settings: { schemaDriven: false, model: false, providers: false },
  extras: { cron: false, skills: false, mcp: false, profiles: false },
  approvals: { requests: false, policy: false },
  activity: { spend: false, events: false },
  media: { images: false, audioIn: false, audioOut: false }
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
  if (!caps.activity.spend) missing.push('Spend')

  return missing
}
