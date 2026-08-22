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
const PUSH_PREFIX = 'agent-push.'

/** Agent ids are app-generated and already safe, but a key must never throw. */
function credentialKey(agentId: string): string {
  const safe = agentId.replace(/[^\w.-]/g, '_')

  if (!safe) throw new Error('An agent id cannot be empty.')

  return `${CREDENTIAL_PREFIX}${safe}`
}

function pushKey(agentId: string): string {
  const safe = agentId.replace(/[^\w.-]/g, '_')

  if (!safe) throw new Error('An agent id cannot be empty.')

  return `${PUSH_PREFIX}${safe}`
}

/**
 * Where this device registers for push, and the key it signs with.
 *
 * A second secret, distinct from the pairing token: it authenticates *one
 * webhook route*, not the agent. It lives here for the same reason the
 * credential does — and because the whole point of the notification design is
 * that this key never travels in a payload.
 */
export interface PushRegistrationConfig {
  baseUrl: string
  secret: string
}

export async function savePushConfig(agentId: string, config: PushRegistrationConfig): Promise<void> {
  await SecureStore.setItemAsync(pushKey(agentId), JSON.stringify(config), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  })
}

export async function readPushConfig(agentId: string): Promise<PushRegistrationConfig | null> {
  const raw = await SecureStore.getItemAsync(pushKey(agentId))

  if (!raw) return null

  try {
    return JSON.parse(raw) as PushRegistrationConfig
  } catch {
    return null
  }
}

export async function forgetPushConfig(agentId: string): Promise<void> {
  await SecureStore.deleteItemAsync(pushKey(agentId))
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
