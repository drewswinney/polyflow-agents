/**
 * Agent discovery and the migration under it, minus the host.
 *
 * Two things here cannot be caught by a type and are both silently destructive
 * on a device.
 *
 * The first is what an *unanswered* discovery means. `discoverAgents` reports a
 * refusal as an empty list plus a reason, and an empty list also means "this
 * host genuinely has nothing" — read the first as the second and reconciliation
 * marks every agent on a working server missing the moment one request fails.
 *
 * The second is the `agents/v1` → `v2` migration. Credentials are keyed by
 * server id in the keychain, and the migration keeps each old agent id as its
 * server id precisely so those keys keep resolving. Mint a fresh id there and
 * every upgrading install silently loses its password, which typechecks
 * perfectly and looks like a host that suddenly wants re-pairing.
 *
 *   npm run check:discovery
 */

import assert from 'node:assert/strict'

import { discoverAgents, identitiesOrSelf } from '../src/backends/discovery.ts'
import type { AgentCredential } from '../src/platform/secure-store.ts'

const TOKEN: AgentCredential = { kind: 'token', token: 't' }
const realFetch = globalThis.fetch

function stubFetch(handler: (url: string) => Response | Promise<Response>): void {
  globalThis.fetch = ((input: RequestInfo | URL) => Promise.resolve(handler(String(input)))) as typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// --- Hermes: profiles are agents -------------------------------------------

{
  stubFetch(url => {
    assert.ok(url.endsWith('/api/profiles'), `asked for the profile list, got ${url}`)

    return json({
      profiles: [
        { name: 'default', is_default: true, model: 'claude-opus-4', skill_count: 12, path: '/p', has_env: true, provider: 'anthropic' },
        { name: 'research', is_default: false, model: 'claude-sonnet-4', skill_count: 1, path: '/r', has_env: false, provider: 'anthropic' }
      ]
    })
  })

  const found = await discoverAgents({ kind: 'hermes', host: 'h:9119', authMode: 'token', secure: false }, TOKEN)

  assert.equal(found.failure, undefined)
  assert.equal(found.identities.length, 2)

  // The default profile is addressed by *omitting* the query param, not by
  // naming it, so its scope has to be null — a scope of `'default'` would send
  // `?profile=default` on every request for the one profile that must not have
  // it.
  const [primary, research] = found.identities

  assert.equal(primary?.scope, null, 'the default profile carries a null scope')
  assert.equal(primary?.isDefault, true)
  assert.equal(primary?.hint, 'claude-opus-4 · 12 skills')
  assert.equal(research?.scope, 'research', 'a named profile carries its name as its scope')
  assert.equal(research?.hint, 'claude-sonnet-4 · 1 skill', 'one skill is not "1 skills"')
}

// --- A host that will not answer is not a host with nothing on it ------------

{
  stubFetch(() => json({ detail: 'nope' }, 500))

  const found = await discoverAgents({ kind: 'hermes', host: 'h:9119', authMode: 'token', secure: false }, TOKEN)

  assert.equal(found.identities.length, 0)
  assert.ok(found.failure, 'a refusal is reported as a reason, not as an empty list')

  // And the fallback still yields one agent, so discovery only ever adds.
  const list = identitiesOrSelf(found, 'garage pi')

  assert.equal(list.length, 1)
  assert.equal(list[0]?.scope, null)
  assert.equal(list[0]?.label, 'garage pi', 'the fallback agent is named after its server')
}

// --- OpenAI-compatible: the model is the identity ---------------------------

{
  stubFetch(url => {
    assert.equal(url, 'https://api.example.com/v1/models')

    return json({ data: [{ id: 'gpt-4o-mini', owned_by: 'openai' }, { id: 'gpt-4o' }] })
  })

  const found = await discoverAgents({ kind: 'other', host: 'api.example.com', authMode: 'token' }, TOKEN)

  assert.equal(found.identities.length, 2)
  assert.equal(found.identities[0]?.scope, 'gpt-4o-mini')
  assert.equal(found.identities[0]?.hint, 'openai')
  assert.equal(found.identities[1]?.hint, undefined, 'a model without an owner gets no hint rather than "undefined"')
}

// A host given with its version segment already on it must not get a second
// one. `/v1/v1/models` is the likeliest way to 404 a host that works fine.
{
  stubFetch(url => {
    assert.equal(url, 'https://api.example.com/v1/models', 'the version segment is not doubled')

    return json({ data: [] })
  })

  const found = await discoverAgents({ kind: 'other', host: 'api.example.com/v1', authMode: 'token' }, TOKEN)

  assert.equal(found.failure, undefined)
  assert.equal(found.identities.length, 0, 'an empty roster is an honest empty list, not a failure')
}

globalThis.fetch = realFetch

// --- The migration keeps the id the keychain is keyed by --------------------

{
  // The stub AsyncStorage the resolver installs, seeded before anything reads.
  const { __store: store } = (await import('@react-native-async-storage/async-storage')) as unknown as {
    __store: Map<string, string>
  }

  store.set(
    'agents/v1',
    JSON.stringify({
      agents: [
        {
          id: 'agent-legacy1',
          displayName: 'home hermes',
          kind: 'hermes',
          icon: 'server',
          host: '10.0.0.68:9119',
          authMode: 'password',
          username: 'drew',
          secure: false
        }
      ],
      selectedAgentId: 'agent-legacy1'
    })
  )

  const { useAgents } = await import('../src/state/agents.ts')

  await useAgents.getState().hydrate()

  const { servers, agents, selectedAgentId } = useAgents.getState()

  assert.equal(servers.length, 1)
  assert.equal(
    servers[0]?.id,
    'agent-legacy1',
    'the server keeps the old agent id — the keychain credential is keyed by it'
  )
  assert.equal(servers[0]?.host, '10.0.0.68:9119')
  assert.equal(servers[0]?.username, 'drew')
  assert.equal(servers[0]?.connection, 'idle', 'reachability is re-measured, never restored from disk')

  assert.equal(agents.length, 1)
  assert.equal(agents[0]?.serverId, 'agent-legacy1')
  assert.equal(agents[0]?.scope, null, 'a legacy agent had no profile, so it is the default identity')
  assert.equal(selectedAgentId, agents[0]?.id, 'the selection survives the rename')

  // And it is written back under the new key, so the next launch reads v2
  // rather than migrating the same registry again.
  assert.ok(store.has('agents/v2'), 'the migrated registry is persisted')
  assert.ok(store.has('agents/v1'), 'the old registry is left alone, not deleted under a downgrade')
}

console.log('Discovery check passed: a refused list is not an empty host, and the v1 migration keeps its keychain ids.')
