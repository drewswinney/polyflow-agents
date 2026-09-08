/**
 * `resolveTapTarget` — which agent a tapped notification re-scopes the app to.
 *
 * The bug these guard against: the device registry is shared across every
 * profile on a host, so a push's `agentId` (set at registration time) can name
 * the *wrong* profile. A greg-fired push carrying default's `agentId` used to
 * open greg's session against default's scope — a blank chat. The host now
 * stamps the *firing* `profile` on each payload, and that must win over
 * `agentId`.
 */

// `resolveTapTarget` is pure, but importing the module loads its siblings'
// native deps (expo-*, react-native, async-storage), which a node Jest env
// can't parse. Stub the native-bearing modules with the no-op shapes the hook
// uses — `resolveTapTarget` touches none of them (same approach as the other
// state tests).
jest.mock('@/platform/notifications', () => ({
  ensureNotificationHandler: () => undefined
}))
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined }
}))
jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: () => ({ remove: () => undefined }),
  addNotificationReceivedListener: () => ({ remove: () => undefined }),
  getLastNotificationResponseAsync: async () => null,
  getPresentedNotificationsAsync: async () => []
}))
jest.mock('expo-router', () => ({
  router: { push: jest.fn() }
}))
jest.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) }
}))

import type { Agent } from '@/domain'
import { resolveTapTarget } from '@/state/notification-routing'

function agent(overrides: Partial<Agent> & Pick<Agent, 'id' | 'serverId' | 'scope'>): Agent {
  return {
    displayName: 'Agent',
    icon: 'bot' as Agent['icon'],
    ...overrides
  }
}

// Two servers, one host each, each carrying a `default` (null-scope) profile
// and a `greg` profile. `greg`'s session id is what the push carries.
const defaultA = agent({ id: 'agent-default-A', serverId: 'server-A', scope: null })
const gregA = agent({ id: 'agent-greg-A', serverId: 'server-A', scope: 'greg' })
const defaultB = agent({ id: 'agent-default-B', serverId: 'server-B', scope: null })
const gregB = agent({ id: 'agent-greg-B', serverId: 'server-B', scope: 'greg' })

const all = [defaultA, gregA, defaultB, gregB]

describe('resolveTapTarget', () => {
  describe('with a current-host `profile` stamp (the primary signal)', () => {
    it('routes to the firing profile even when `agentId` names a different one', () => {
      // The old bug: firing profile is greg, but the stored agentId is default's.
      const target = resolveTapTarget(all, defaultA.id, {
        profile: 'greg',
        agentId: defaultA.id,
        sessionId: 'sess-greg-1'
      })

      expect(target).toBe(gregA.id)
    })

    it('maps the `default` profile to the null scope', () => {
      const target = resolveTapTarget(all, gregA.id, {
        profile: 'default',
        agentId: gregA.id, // stale — points at greg, not default
        sessionId: 'sess-default-1'
      })

      expect(target).toBe(defaultA.id)
    })

    it('does not re-scope when already on the firing profile', () => {
      const target = resolveTapTarget(all, gregA.id, {
        profile: 'greg',
        agentId: defaultA.id, // stale, but irrelevant
        sessionId: 'sess-greg-2'
      })

      expect(target).toBe(gregA.id)
    })

    it('breaks a same-profile-name tie across servers using `agentId`', () => {
      // `greg` exists on both servers. The device registered against B, so
      // the push fired from B's greg. agentId points at B → resolve B's greg.
      const target = resolveTapTarget(all, defaultA.id, {
        profile: 'greg',
        agentId: gregB.id,
        sessionId: 'sess-greg-B'
      })

      expect(target).toBe(gregB.id)
    })

    it('falls back to the selected agent server when agentId is unknown', () => {
      // Unknown agentId (device drifted / stale id) — use the currently
      // selected agent's server as the hint.
      const target = resolveTapTarget(all, gregB.id, {
        profile: 'greg',
        agentId: 'agent-gone',
        sessionId: 'sess-greg-3'
      })

      expect(target).toBe(gregB.id)
    })

    it('returns null when the firing profile no longer exists on any host', () => {
      const target = resolveTapTarget(all, gregA.id, {
        profile: 'deleted-profile',
        agentId: gregA.id,
        sessionId: 'sess-x'
      })

      expect(target).toBeNull()
    })
  })

  describe('without a `profile` stamp (older host, `agentId` fallback)', () => {
    it('routes by `agentId` when it names a known agent', () => {
      const target = resolveTapTarget(all, defaultA.id, {
        agentId: gregB.id,
        sessionId: 'sess-greg-B'
      })

      expect(target).toBe(gregB.id)
    })

    it('returns null when `agentId` names an agent we no longer have', () => {
      const target = resolveTapTarget(all, defaultA.id, {
        agentId: 'agent-gone',
        sessionId: 'sess-x'
      })

      expect(target).toBeNull()
    })

    it('returns null when there is neither signal', () => {
      const target = resolveTapTarget(all, defaultA.id, { sessionId: 'sess-x' })

      expect(target).toBeNull()
    })
  })
})
