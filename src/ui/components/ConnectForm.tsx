import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { type Discovery, discoverAgents, identitiesOrSelf } from '@/backends/discovery'
import { HermesRest, probeScheme } from '@/backends/hermes'
import type { AgentIdentity, AuthMode, Server } from '@/domain'
import { type AgentCredential, saveAgentCredential } from '@/platform/secure-store'
import { useAgents } from '@/state/agents'
import { KeyboardInset } from '../keyboard'
import { parseHost } from '../setup'
import { useTheme } from '../ThemeProvider'
import { Card } from './Card'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { SetupButton } from './SetupChrome'
import { Text } from './Text'

/** How long the host field is left alone before the app dials it. */
const PROBE_DEBOUNCE_MS = 600

/**
 * Connect a Hermes host (§7.8, §7.14) — the form both first run and "add a
 * server" share.
 *
 * The person does the two things only they can do: name an address and
 * authenticate. Everything else the app finds out for itself, and the form
 * is shaped so that it never asks for what it can find out:
 *
 * - The host is **probed as it is typed** (debounced), not on a button. What
 *   comes back — reachable or not, TLS or not, which auth the host runs — is
 *   shown as a line under the field.
 * - The credential fields **appear once the probe says which** the host
 *   wants: username and password for the built-in provider, a token
 *   otherwise. Until the host answers there is nothing sensible to ask for.
 * - No kind: this app talks to Hermes. No display name: the host's address
 *   heads the server's group, and Settings can rename it later.
 *
 * Connecting authenticates and asks the host what it carries (§4.2). One
 * profile goes straight through; several stop here for a prune-not-pick
 * list; a host that would not answer still yields one agent, since
 * discovery can only ever add.
 *
 * `header` is what the page puts above the fields — first run explains, the
 * add-server modal does not — and `bottomInset` is the safe area the scroll
 * body clears.
 */
export function ConnectForm({
  header,
  topInset,
  bottomInset,
  onConnected
}: {
  header?: React.ReactNode
  topInset: number
  bottomInset: number
  /** The server is saved and its agents registered; the first is selected. */
  onConnected: (agentId: string) => void
}) {
  const theme = useTheme()
  const addServer = useAgents(state => state.addServer)
  const scroller = useRef<ScrollView>(null)

  /**
   * Brings a field that has just taken focus to the top of what is left of the
   * screen. The keyboard covers the lower half, and the fields that matter —
   * the password most of all — are in it.
   */
  const revealField = useCallback((y: number) => {
    scroller.current?.scrollTo({ y: Math.max(y - 12, 0), animated: true })
  }, [])

  const [hostInput, setHostInput] = useState('')
  const parsed = parseHost(hostInput)
  const host = parsed.host

  const [probe, setProbe] = useState<Probe>({ status: 'idle' })
  // Which probe is the latest. A reply from an earlier host — typed over
  // before it answered — must not land on the field as it is now.
  const probeTicket = useRef(0)

  useEffect(() => {
    const ticket = ++probeTicket.current

    if (!host) {
      setProbe({ status: 'idle' })

      return
    }

    setProbe({ status: 'checking' })

    const timer = setTimeout(async () => {
      try {
        // Ask before assuming: a tailnet address is neither loopback nor
        // public, and `hermes serve` speaks plain HTTP unless something
        // terminates TLS in front of it. A typed scheme is the answer.
        const secure = parsed.secure ?? (await probeScheme(host))
        const rest = new HermesRest({ host, secure })
        const status = await rest.status()
        const providers = await rest.authProviders().catch(() => [])
        const passwordProvider = providers.find(provider => provider.supportsPassword)

        if (ticket !== probeTicket.current) return

        setProbe({
          status: 'reachable',
          secure,
          version: (status as { version?: string }).version ?? 'unknown',
          providerName: passwordProvider?.name ?? providers[0]?.name ?? null,
          authMode: passwordProvider ? 'password' : providers.length > 0 ? 'oauth' : 'token'
        })
      } catch (cause) {
        if (ticket !== probeTicket.current) return

        setProbe({ status: 'unreachable', message: cause instanceof Error ? cause.message : String(cause) })
      }
    }, PROBE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [host, parsed.secure])

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [reveal, setReveal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  /**
   * What the host said it carries, once asked. Null until it has been.
   *
   * The whole `Discovery` rather than just the list keeps the difference
   * between *"this host has one agent"* and *"this host would not tell us"*
   * — which read identically in a bare array and mean opposite things.
   */
  const [discovery, setDiscovery] = useState<Discovery | null>(null)
  const [identities, setIdentities] = useState<AgentIdentity[]>([])
  /** Scopes the user has left ticked. Keyed by `scope ?? ''` — null is a scope. */
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  const authMode: AuthMode = probe.status === 'reachable' ? probe.authMode : 'token'
  const needsPassword = authMode === 'password'
  // The credential fields wait for the host: until it has answered there is
  // no knowing whether to ask for a password or a token. A host that cannot
  // be reached gets the token field, since an offline host can still be
  // saved and a token is the credential that needs no provider to name.
  const askCredentials = probe.status === 'reachable' || probe.status === 'unreachable'

  const credentialReady = needsPassword ? username.trim() && password.trim() : token.trim()
  const ready = Boolean(host && askCredentials && credentialReady) && !saving

  const buildServer = (): Server => ({
    id: `server-${Date.now().toString(36)}`,
    // The address, which is a worse name than one you would type and never a
    // wrong one. Settings renames it.
    displayName: host,
    kind: 'hermes',
    host,
    authMode,
    ...(needsPassword ? { username: username.trim() } : {}),
    ...(probe.status === 'reachable' && probe.providerName ? { authProvider: probe.providerName } : {}),
    ...(probe.status === 'reachable' ? { secure: probe.secure, version: probe.version } : {}),
    // Reachability was checked above, but an offline host can still be saved:
    // the connection attempt on selection is what sets this for real.
    connection: probe.status === 'reachable' ? 'idle' : 'offline'
  })

  const buildCredential = (): AgentCredential =>
    needsPassword
      ? {
          kind: 'password',
          provider: (probe.status === 'reachable' && probe.providerName) || 'basic',
          username: username.trim(),
          password: password.trim()
        }
      : { kind: 'token', token: token.trim() }

  const commit = async (server: Server, credential: AgentCredential, chosenIdentities: AgentIdentity[]) => {
    // Secret first: the registry row is what makes it findable, so writing the
    // row before the credential is what strands an agent that cannot connect.
    await saveAgentCredential(server.id, credential)
    onConnected(await addServer(server, chosenIdentities))
  }

  const connect = async () => {
    if (!ready) return

    setSaving(true)
    setSaveError(null)

    const server = buildServer()
    const credential = buildCredential()

    try {
      const found = await discoverAgents(
        { kind: 'hermes', host: server.host, authMode, ...(server.secure === undefined ? {} : { secure: server.secure }) },
        credential
      )
      const list = identitiesOrSelf(found, server.displayName)

      if (!found.failure && list.length <= 1) {
        await commit(server, credential, list)

        return
      }

      setDiscovery(found)
      setIdentities(list)
      // Pre-selected, not pre-empty: someone with three profiles wants three
      // agents, so the step is a prune rather than a pick.
      setChosen(new Set(list.map(identityKey)))
      setSaving(false)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
      setSaving(false)
    }
  }

  const addChosen = async () => {
    const picked = identities.filter(identity => chosen.has(identityKey(identity)))

    if (picked.length === 0 || saving) return

    setSaving(true)
    setSaveError(null)

    try {
      await commit(buildServer(), buildCredential(), picked)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
      setSaving(false)
    }
  }

  const toggle = (identity: AgentIdentity) =>
    setChosen(current => {
      const next = new Set(current)
      const key = identityKey(identity)

      if (next.has(key)) next.delete(key)
      else next.add(key)

      return next
    })

  const picking = discovery !== null
  const primaryReady = picking ? chosen.size > 0 && !saving : ready

  return (
    // The form is taller than the screen with the keyboard up, so the whole
    // of it — not just the part above the fold — has to stay reachable.
    <KeyboardInset style={styles.flex}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={[styles.body, { paddingTop: topInset, paddingBottom: bottomInset + 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        {header}

        <Field
          label="Host"
          value={hostInput}
          onChange={setHostInput}
          placeholder="hermes.lan:9119"
          mono
          keyboardType="url"
          onReveal={revealField}
          hint={<ProbeLine probe={probe} />}
        />

        {askCredentials ? (
          needsPassword ? (
            <>
              <Field label="Username" value={username} onChange={setUsername} placeholder="the dashboard username" mono onReveal={revealField} />
              <Field
                label="Password"
                value={password}
                onChange={setPassword}
                placeholder="the dashboard password"
                secure={!reveal}
                mono
                trailing={<RevealToggle revealed={reveal} onToggle={() => setReveal(value => !value)} />}
                onReveal={revealField}
              />
            </>
          ) : (
            <Field
              label="Access token"
              value={token}
              onChange={setToken}
              placeholder="paste the token from the host"
              secure={!reveal}
              mono
              trailing={<RevealToggle revealed={reveal} onToggle={() => setReveal(value => !value)} />}
              onReveal={revealField}
            />
          )
        ) : null}

        {probe.status === 'reachable' && !probe.secure ? (
          <Text variant="secondary">
            This host speaks plain HTTP, so your password crosses the network unencrypted. Fine inside a tailnet; not fine on open Wi-Fi.
          </Text>
        ) : null}

        {picking ? (
          <Card style={styles.probeCard}>
            <View style={styles.probeHead}>
              <Icon
                name={discovery?.failure ? 'circle-exclamation' : 'circle-check'}
                size={14}
                color={discovery?.failure ? theme.color.warning700 : theme.color.success700}
              />
              <Text variant="rowLabelStrong">
                {discovery?.failure ? 'Could not list what is on this host' : `Found ${identities.length} agents`}
              </Text>
            </View>

            <Text variant="secondary">
              {discovery?.failure
                ? 'It answered, but not with a list of agents. Adding it as a single agent — nothing is lost, and the list is checked again every time it connects.'
                : 'Sessions, settings and history never mix between them. Untick any you do not want.'}
            </Text>

            {identities.map(identity => (
              <IdentityRow key={identityKey(identity)} identity={identity} checked={chosen.has(identityKey(identity))} onToggle={() => toggle(identity)} />
            ))}
          </Card>
        ) : null}

        {saveError ? (
          <Text variant="secondary" color={theme.color.error700}>
            {saveError}
          </Text>
        ) : null}

        {askCredentials ? (
          <Text variant="secondary">Credentials go to this phone&apos;s keychain and are sent only to this host.</Text>
        ) : null}

        <View style={styles.action}>
          <SetupButton
            label={picking ? `Add ${chosen.size} ${chosen.size === 1 ? 'agent' : 'agents'}` : 'Connect'}
            disabled={!primaryReady}
            busy={saving}
            onPress={() => void (picking ? addChosen() : connect())}
          />
        </View>
      </ScrollView>
    </KeyboardInset>
  )
}

/** Null is a real scope — the default identity — so it needs its own key. */
function identityKey(identity: AgentIdentity): string {
  return identity.scope ?? ''
}

type Probe =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'reachable'; secure: boolean; version: string; providerName: string | null; authMode: AuthMode }
  | { status: 'unreachable'; message: string }

/**
 * What the probe found, as one line under the host field. Nothing until
 * something has been typed; a spinner while the host is dialled; then either
 * what it is or why it could not be reached.
 */
function ProbeLine({ probe }: { probe: Probe }) {
  const theme = useTheme()

  switch (probe.status) {
    case 'idle':
      return null
    case 'checking':
      return (
        <View style={styles.probeLine}>
          <ActivityIndicator size="small" color={theme.color.secondary} />
          <Text variant="secondary">Looking for it…</Text>
        </View>
      )
    case 'reachable':
      return (
        <View style={styles.probeLine}>
          <Icon name="circle-check" size={13} color={theme.color.success700} />
          <Text variant="secondary" style={styles.probeText}>
            {`Hermes ${probe.version} · ${probe.secure ? 'https' : 'http'} · ${describeAuth(probe.authMode)}`}
          </Text>
        </View>
      )
    case 'unreachable':
      return (
        <View style={styles.probeLine}>
          <Icon name="circle-exclamation" size={13} color={theme.color.warning700} />
          <Text variant="secondary" style={styles.probeText}>
            {`Could not reach it: ${probe.message} You can still connect with a token; it will show as offline until it answers.`}
          </Text>
        </View>
      )
  }
}

function describeAuth(mode: AuthMode): string {
  switch (mode) {
    case 'password':
      return 'signs in with a password'
    case 'oauth':
      return 'oauth sign-in'
    case 'token':
    default:
      return 'takes a token'
  }
}

/** One discovered identity, ticked by default (§7.8). */
function IdentityRow({ identity, checked, onToggle }: { identity: AgentIdentity; checked: boolean; onToggle: () => void }) {
  const theme = useTheme()

  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onToggle} style={styles.identityRow}>
      <Icon name={checked ? 'circle-check' : 'circle'} size={16} color={checked ? theme.color.secondary : theme.color.gray400} />
      <View style={styles.identityText}>
        <Text variant="rowLabelStrong">{identity.label}</Text>
        {identity.hint ? <Text variant="monoSmall">{identity.hint}</Text> : null}
      </View>
    </Pressable>
  )
}

function RevealToggle({ revealed, onToggle }: { revealed: boolean; onToggle: () => void }) {
  const theme = useTheme()

  return (
    <IconButton
      name={revealed ? 'eye-slash' : 'eye'}
      accessibilityLabel={revealed ? 'Hide the secret' : 'Show the secret'}
      size={14}
      slot={36}
      color={theme.color.gray400}
      onPress={onToggle}
    />
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  mono,
  keyboardType,
  trailing,
  hint,
  onReveal
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  secure?: boolean
  mono?: boolean
  keyboardType?: 'default' | 'url'
  trailing?: React.ReactNode
  /** A line under the field — the probe's answer. */
  hint?: React.ReactNode
  /** Called with this field's offset in the form when it takes focus. */
  onReveal?: (y: number) => void
}) {
  const theme = useTheme()
  // Its own offset inside the scrolling body, which is what the screen needs to
  // scroll it into the space the keyboard leaves.
  const offset = useRef(0)

  return (
    <View style={styles.field} onLayout={event => (offset.current = event.nativeEvent.layout.y)}>
      <Text variant="sectionHeader">{label}</Text>
      <View style={[styles.input, { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border, borderRadius: theme.radius.control }]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.color.gray400}
          keyboardAppearance={theme.dark ? 'dark' : 'light'}
          keyboardType={keyboardType ?? 'default'}
          secureTextEntry={secure}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => onReveal?.(offset.current)}
          style={[styles.inputText, { color: theme.color.gray800, fontFamily: mono ? theme.font.mono : theme.font.body }]}
        />
        {trailing}
      </View>
      {hint}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  identityText: { flex: 1, minWidth: 0, gap: 1 },
  field: { gap: 6 },
  input: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderWidth: 1 },
  inputText: { flex: 1, fontSize: 14 },
  probeLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: 2, paddingTop: 2 },
  probeText: { flex: 1, minWidth: 0 },
  probeCard: { padding: 14, gap: 6 },
  probeHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  action: { marginTop: 4 }
})
