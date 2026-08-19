/**
 * Credentials live in the Keychain / Android Keystore, never in AsyncStorage or
 * Zustand-persisted state (§5.2).
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
 */
const CREDENTIAL_PREFIX = 'agent-credential.'

/** Agent ids are app-generated and already safe, but a key must never throw. */
function credentialKey(agentId: string): string {
  const safe = agentId.replace(/[^\w.-]/g, '_')

  if (!safe) throw new Error('An agent id cannot be empty.')

  return `${CREDENTIAL_PREFIX}${safe}`
}

export type AgentCredential =
  | { kind: 'token'; token: string }
  | { kind: 'password'; provider: string; username: string; password: string }

export async function saveAgentCredential(agentId: string, credential: AgentCredential): Promise<void> {
  await SecureStore.setItemAsync(credentialKey(agentId), JSON.stringify(credential), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  })
}

export async function readAgentCredential(agentId: string): Promise<AgentCredential | null> {
  const raw = await SecureStore.getItemAsync(credentialKey(agentId))

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
export async function forgetAgentCredential(agentId: string): Promise<void> {
  await SecureStore.deleteItemAsync(credentialKey(agentId))
}
