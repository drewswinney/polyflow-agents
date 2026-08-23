/**
 * Credentials live in the Keychain / Android Keystore, never in AsyncStorage or
 * Zustand-persisted state (§5.2).
 *
 * Keyed by **server**, not agent: both a credential and a push registration are
 * facts about a host, and several agents can share one. Keying push by agent
 * registered the same device twice against a single host.
 *
 * A credential is not always a token. A self-hosted Hermes on a non-loopback
 * bind authenticates with a username and password (§5.3), so this stores a
 * tagged union rather than a string — and the *whole* credential goes to the
 * secure store, username included.
 */

import * as SecureStore from 'expo-secure-store'

/**
 * SecureStore keys are validated against `/^[\w.-]+$/` — alphanumerics, `.`,
 * `-` and `_` only. A `:` separator (the obvious choice, and the one this used
 * at first) throws on every read *and* write, so the store was unusable rather
 * than merely wrong. Hence the dot.
 *
 * Both prefixes still say `agent`, and both are now keyed by **server** id
 * (§5.2). The words are stale and the keys are not: renaming them would strand
 * every credential already in a keychain behind a name nothing reads, for a
 * cosmetic gain. The `agents/v1` → `v2` migration reuses each old agent id as
 * its server id precisely so these keys keep resolving.
 */
const CREDENTIAL_PREFIX = 'agent-credential.'

/** Server ids are app-generated and already safe, but a key must never throw. */
function credentialKey(serverId: string): string {
  const safe = serverId.replace(/[^\w.-]/g, '_')

  if (!safe) throw new Error('A server id cannot be empty.')

  return `${CREDENTIAL_PREFIX}${safe}`
}

export type AgentCredential =
  | { kind: 'token'; token: string }
  | { kind: 'password'; provider: string; username: string; password: string }

export async function saveAgentCredential(serverId: string, credential: AgentCredential): Promise<void> {
  await SecureStore.setItemAsync(credentialKey(serverId), JSON.stringify(credential), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  })
}

export async function readAgentCredential(serverId: string): Promise<AgentCredential | null> {
  const raw = await SecureStore.getItemAsync(credentialKey(serverId))

  if (!raw) return null

  try {
    return JSON.parse(raw) as AgentCredential
  } catch {
    // A corrupt entry is treated as absent: the user re-pairs rather than the
    // app failing to start.
    return null
  }
}

/**
 * Forget an agent's credential.
 *
 * Note this is only half a revocation: the host has no per-device credential to
 * revoke (§5.3), so removing it here stops *this* phone without invalidating
 * anything server-side.
 */
export async function forgetAgentCredential(serverId: string): Promise<void> {
  await SecureStore.deleteItemAsync(credentialKey(serverId))
}
