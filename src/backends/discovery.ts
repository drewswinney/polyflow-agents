/**
 * Agent discovery (§4.2).
 *
 * Onboarding connects a **server** and asks it what it hosts. This is the call
 * that asks, and it deliberately runs at the REST layer: at that point the app
 * holds a host and a credential but no agent, and `createBackend` takes an
 * agent — so there is nothing to reach through the §4 seam with, and no reason
 * to open a socket to read a list.
 *
 * The contract does not assume fan-out. Hermes and an OpenAI-compatible host
 * both return several identities; an A2A card describes exactly one and has no
 * registry behind it, so *one* is a normal answer rather than a degraded one.
 */

import type { AgentIdentity, Server } from '@/domain'
import type { AgentCredential } from '@/platform/secure-store'

// Both imports reach past the barrel on purpose: `./hermes` and `./registry`
// pull in every backend, and discovery must be able to ask a host what it
// carries without constructing anything that could talk to one.
import { HermesRest } from './hermes/rest'
import { MOCK_HOST } from './mock-host'

/**
 * What discovery needs to reach a host, which is less than a `Server`.
 *
 * Onboarding calls this before the server record exists — it has probed an
 * address and collected a credential, and the id and display name are decided
 * by what comes back.
 */
export type DiscoveryTarget = Pick<Server, 'kind' | 'host' | 'authMode'> & Pick<Partial<Server>, 'secure'>

export interface Discovery {
  identities: AgentIdentity[]
  /**
   * Why the list is empty, when it is empty because the host would not answer.
   *
   * Distinguished from an honestly empty list so the caller can say *"could not
   * list the agents on this host"* rather than silently presenting a server
   * with one agent as though that were what the host reported.
   */
  failure?: string
}

/**
 * Ask a server for its identities. Never throws.
 *
 * A refusal is data, not an error: §4.2's rule is that discovery only ever
 * *adds*, so a 404, an empty list or a parse failure all leave the caller free
 * to fall back to the single agent it would have created anyway.
 */
export async function discoverAgents(target: DiscoveryTarget, credential: AgentCredential): Promise<Discovery> {
  try {
    if (target.host === MOCK_HOST) {
      return { identities: [{ scope: null, label: 'Demo agent', isDefault: true }] }
    }

    return { identities: target.kind === 'hermes' ? await hermesIdentities(target, credential) : await openAiIdentities(target, credential) }
  } catch (cause) {
    return { identities: [], failure: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * Hermes profiles, which are agents in every sense the app cares about: own
 * model, own provider, own skills, own memory.
 */
async function hermesIdentities(target: DiscoveryTarget, credential: AgentCredential): Promise<AgentIdentity[]> {
  const rest = new HermesRest({
    host: target.host,
    ...(target.secure === undefined ? {} : { secure: target.secure }),
    ...(credential.kind === 'token'
      ? { token: credential.token }
      : { password: { provider: credential.provider, username: credential.username, password: credential.password } })
  })

  // Password auth mints a session cookie; without it every call below is a 401.
  if (credential.kind === 'password') await rest.login()

  const { profiles } = await rest.profiles()

  return profiles.map(profile => ({
    // The *name* is the selector Hermes spends as `?profile=`, and the default
    // profile is addressed by omitting the param rather than naming it — which
    // is why the default carries a null scope rather than its own name.
    scope: profile.is_default ? null : profile.name,
    label: profile.name,
    ...(describeProfile(profile.model, profile.skill_count) ? { hint: describeProfile(profile.model, profile.skill_count) } : {}),
    isDefault: profile.is_default
  }))
}

function describeProfile(model: string | null, skillCount: number): string {
  return [model, skillCount > 0 ? `${skillCount} ${skillCount === 1 ? 'skill' : 'skills'}` : null]
    .filter(Boolean)
    .join(' · ')
}

/**
 * `/v1/models` — the only introspection a non-Hermes host reliably offers.
 *
 * Thin, but real: for a backend that has no server-side agent objects, the
 * model *is* the whole identity. OpenAI's Assistants API did expose a genuine
 * agent list and is not implemented here on purpose — it sunsets 26 Aug 2026,
 * and its replacement (Responses + Conversations) has no enumerable equivalent.
 */
async function openAiIdentities(target: DiscoveryTarget, credential: AgentCredential): Promise<AgentIdentity[]> {
  const scheme = (target.secure ?? true) ? 'https' : 'http'
  // A host given as `api.example.com/v1` already carries the version segment;
  // appending a second one is the likeliest way to get a 404 out of a host that
  // works perfectly well.
  const base = `${scheme}://${target.host}`.replace(/\/+$/, '')
  const url = `${base}${base.endsWith('/v1') ? '' : '/v1'}/models`

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(credential.kind === 'token' && credential.token ? { Authorization: `Bearer ${credential.token}` } : {})
    }
  })

  if (!response.ok) throw new Error(`${url} answered ${response.status}`)

  const body = (await response.json()) as { data?: { id?: string; owned_by?: string }[] }
  const models = (body.data ?? []).filter(model => typeof model.id === 'string' && model.id)

  return models.map((model, index) => ({
    scope: model.id as string,
    label: model.id as string,
    ...(model.owned_by ? { hint: model.owned_by } : {}),
    // Nothing in the response marks a default, and picking one arbitrarily is
    // worse than admitting there isn't one — so the first row is pre-selected
    // only to give the picker somewhere to start.
    isDefault: index === 0
  }))
}

/**
 * The identities to actually create agents from, given what discovery said.
 *
 * The fallback is the whole point of §4.2's "discovery only ever adds": a host
 * that will not enumerate still yields one agent — itself — which is exactly
 * what the app produced before discovery existed.
 */
export function identitiesOrSelf(discovery: Discovery, serverName: string): AgentIdentity[] {
  if (discovery.identities.length > 0) return discovery.identities

  return [{ scope: null, label: serverName, isDefault: true }]
}
