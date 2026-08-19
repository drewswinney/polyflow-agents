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

const CREDENTIAL_PREFIX = 'agent-credential:'
/** Pre-union key, kept only so an agent added before this change still connects. */
const LEGACY_TOKEN_PREFIX = 'agent-token:'

export type AgentCredential =
  | { kind: 'token'; token: string }
  | { kind: 'password'; provider: string; username: string; password: string }

export async function saveAgentCredential(agentId: string, credential: AgentCredential): Promise<void> {
  await SecureStore.setItemAsync(`${CREDENTIAL_PREFIX}${agentId}`, JSON.stringify(credential), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  })
}

export async function readAgentCredential(agentId: string): Promise<AgentCredential | null> {
  const raw = await SecureStore.getItemAsync(`${CREDENTIAL_PREFIX}${agentId}`)

  if (raw) {
    try {
      return JSON.parse(raw) as AgentCredential
    } catch {
      // A corrupt entry is treated as absent: the user re-pairs rather than
      // the app failing to start.
      return null
    }
  }

  const legacy = await SecureStore.getItemAsync(`${LEGACY_TOKEN_PREFIX}${agentId}`)

  return legacy ? { kind: 'token', token: legacy } : null
}

/** The "lost my phone" half of enrolment lives on the host (`hermes pairing revoke`). */
export async function forgetAgentCredential(agentId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${CREDENTIAL_PREFIX}${agentId}`)
  await SecureStore.deleteItemAsync(`${LEGACY_TOKEN_PREFIX}${agentId}`)
}
