/**
 * Credentials live in the Keychain / Android Keystore, never in AsyncStorage or
 * Zustand-persisted state (§5.2).
 */

import * as SecureStore from 'expo-secure-store'

const TOKEN_PREFIX = 'agent-token:'

export async function saveAgentToken(agentId: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(`${TOKEN_PREFIX}${agentId}`, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  })
}

export async function readAgentToken(agentId: string): Promise<string | null> {
  return SecureStore.getItemAsync(`${TOKEN_PREFIX}${agentId}`)
}

/** The "lost my phone" half of enrolment lives on the host (`hermes pairing revoke`). */
export async function forgetAgentToken(agentId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${TOKEN_PREFIX}${agentId}`)
}
