import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { type Discovery, discoverAgents, identitiesOrSelf } from '@/backends/discovery'
import { HermesRest, probeScheme } from '@/backends/hermes'
import type { AgentIdentity, AgentKind, AuthMode, Server } from '@/domain'
import { type AgentCredential, saveAgentCredential } from '@/platform/secure-store'
import { useAgents } from '@/state/agents'
import { Card } from '@/ui/components/Card'
import { Icon } from '@/ui/components/Icon'
import { IconButton } from '@/ui/components/IconButton'
import { ScreenHeader } from '@/ui/components/ScreenHeader'
import { Text } from '@/ui/components/Text'
import { KeyboardInset } from '@/ui/keyboard'
import { useGradient, useTheme } from '@/ui/ThemeProvider'

/**
 * Connect a server (§7.14).
 *
 * Kind comes first because it determines everything after it. Then the host —
 * and then the app **asks the host what it wants** rather than assuming.
 *
 * That probe is the important part. §5.3 assumed enrolment was a pasted bearer
 * token; a self-hosted Hermes on a non-loopback bind almost always runs the
 * built-in username/password provider instead, and there is no paste-a-token
 * path at all unless a token-only provider is configured. `/api/status` and
 * `/api/auth/providers` are both public precisely so a client can find this out
 * before it has a credential, which also gives the design's "reachability is
 * checked before pairing" for free.
 *
 * The last step asks the host what it *hosts* (§4.2). The person does the part
 * only they can do — name an address, authenticate — and the app does the part
 * they cannot, which is know what identities are on the other side. A host that
 * reports exactly one skips the picker entirely rather than showing a
 * one-checkbox screen; a host that will not answer still yields one agent, so
 * discovery can only ever add.
 */
export default function AddServerScreen() {
  const theme = useTheme()
  const gradient = useGradient()
  const insets = useSafeAreaInsets()
  const addServer = useAgents(state => state.addServer)
  const scroller = useRef<ScrollView>(null)

  /**
   * Whether a card is already holding this screen off the top of the window.
   *
   * Only an iOS modal presentation does. Android draws its modal full-bleed,
   * and on first run this can be the screen at the root of the stack with
   * nothing behind it at all — in both of those the status bar is ours to
   * clear, and `insetTop={false}` put the title underneath it.
   */
  const canGoBack = router.canGoBack()
  const hostedInCard = Platform.OS === 'ios' && canGoBack

  /**
   * Brings a field that has just taken focus to the top of what is left of the
   * screen. The keyboard covers the lower half of a form this long, and the
   * fields that matter — the password, the display name — are all in it.
   */
  const revealField = useCallback((y: number) => {
    scroller.current?.scrollTo({ y: Math.max(y - 12, 0), animated: true })
  }, [])

  const [kind, setKind] = useState<AgentKind>('hermes')
  const [host, setHost] = useState('')
  const [displayName, setDisplayName] = useState('')

  /**
   * What the host said it carries, once asked. Null until it has been.
   *
   * Holding the whole `Discovery` rather than just the list keeps the
   * difference between *"this host has one agent"* and *"this host would not
   * tell us"* — which read identically in a bare array and mean opposite things
   * to someone deciding whether the screen worked.
   */
  const [discovery, setDiscovery] = useState<Discovery | null>(null)
  const [identities, setIdentities] = useState<AgentIdentity[]>([])
  /** Scopes the user has left ticked. Keyed by `scope ?? ''` — null is a scope. */
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  const [probe, setProbe] = useState<Probe>({ status: 'idle' })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [reveal, setReveal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const checkHost = async () => {
    const target = host.trim()

    if (!target) return

    setProbe({ status: 'checking' })

    try {
      // Ask before assuming: a tailnet address is neither loopback nor public,
      // and `hermes serve` speaks plain HTTP unless something terminates TLS
      // in front of it.
      const secure = await probeScheme(target)
      const rest = new HermesRest({ host: target, secure })
      const status = await rest.status()
      const providers = await rest.authProviders().catch(() => [])
      const passwordProvider = providers.find(provider => provider.supportsPassword)

      setProbe({
        status: 'reachable',
        secure,
        version: (status as { version?: string }).version ?? 'unknown',
        providerName: passwordProvider?.name ?? providers[0]?.name ?? null,
        authMode: passwordProvider ? 'password' : providers.length > 0 ? 'oauth' : 'token'
      })
    } catch (cause) {
      setProbe({ status: 'unreachable', message: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const authMode: AuthMode = probe.status === 'reachable' ? probe.authMode : 'token'
  const needsPassword = authMode === 'password'

  const credentialReady = needsPassword ? username.trim() && password.trim() : token.trim()
  // Display name no longer gates this. It used to, and it was a chore standing
  // between someone and a working app for a string the host can supply itself.
  const ready = Boolean(host.trim() && credentialReady) && !saving

  /** Falls back to the address, which is a worse name and never a wrong one. */
  const serverName = displayName.trim() || host.trim()

  const buildServer = (): Server => ({
    id: `server-${Date.now().toString(36)}`,
    displayName: serverName,
    kind,
    host: host.trim(),
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
    await addServer(server, chosenIdentities)
    // `replace`, not `back`: this screen is also the first-run destination,
    // where there is no history to return to and `back()` is a no-op that
    // leaves you staring at the form you just submitted.
    router.replace('/')
  }

  /**
   * Authenticate, ask what is there, and only stop to ask if there is a choice.
   *
   * One identity — an OpenAI-compatible host with a single model, an A2A card,
   * a Hermes with only its default profile — goes straight in. A host that
   * *refused* to answer stops, because "we could not ask" and "there is one
   * here" deserve different words even though both end with one agent.
   */
  const connect = async () => {
    if (!ready) return

    setSaving(true)
    setSaveError(null)

    const server = buildServer()
    const credential = buildCredential()

    try {
      const found = await discoverAgents(
        { kind, host: server.host, authMode, ...(server.secure === undefined ? {} : { secure: server.secure }) },
        credential
      )
      const list = identitiesOrSelf(found, serverName)

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
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <ScreenHeader
        title="Connect a server"
        // Nothing to go back to on first run, and a chevron that does nothing is
        // worse than no chevron.
        onBack={canGoBack ? () => router.back() : undefined}
        insetTop={!hostedInCard}
      />

      {/* The form is taller than the screen with the keyboard up, so the whole
          of it — not just the part above the fold — has to stay reachable. */}
      <KeyboardInset style={styles.flex}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          <Text variant="secondary">
            Agents stay separate. Sessions, settings, and history never mix between them.
          </Text>

          <KindCard
            selected={kind === 'hermes'}
            title="Another Hermes"
            detail="Full support — voice, skills, cron, MCP, approvals"
            onPress={() => setKind('hermes')}
          />
          <KindCard
            selected={kind === 'other'}
            title="Something else"
            detail="Any agent that speaks OpenAI-compatible streaming"
            onPress={() => setKind('other')}
          />

          <Field
            label="Host and port"
            value={host}
            onChange={value => {
              setHost(value)
              setProbe({ status: 'idle' })
            }}
            placeholder="10.0.0.68:9119"
            mono
            onReveal={revealField}
          />

          <Pressable
            accessibilityRole="button"
            disabled={!host.trim() || probe.status === 'checking'}
            onPress={() => void checkHost()}
            style={[styles.outlineButton, { borderColor: theme.color.border, borderRadius: theme.radius.control }]}
          >
            {probe.status === 'checking' ? (
              <ActivityIndicator color={theme.color.secondary} />
            ) : (
              <Text variant="rowLabelStrong" color={theme.color.primary}>
                Check this host
              </Text>
            )}
          </Pressable>

          {probe.status === 'reachable' ? (
            <Card style={styles.probeCard}>
              <View style={styles.probeHead}>
                <Icon name="circle-check" size={14} color={theme.color.success700} />
                <Text variant="rowLabelStrong">Reachable</Text>
              </View>
              <Text variant="monoSmall">
                {`hermes ${probe.version} · ${probe.secure ? 'https' : 'http'} · ${describeAuth(probe.authMode)}`}
              </Text>
              {!probe.secure ? (
                <Text variant="secondary">
                  This host speaks plain HTTP, so your password crosses the network unencrypted. Fine inside a tailnet;
                  not fine on open Wi-Fi.
                </Text>
              ) : null}
            </Card>
          ) : null}

          {probe.status === 'unreachable' ? (
            <Card style={styles.probeCard}>
              <View style={styles.probeHead}>
                <Icon name="circle-exclamation" size={14} color={theme.color.warning700} />
                <Text variant="rowLabelStrong">Could not reach it</Text>
              </View>
              <Text variant="secondary">{probe.message}</Text>
              <Text variant="secondary">
                You can still save it — the agent will show as offline until it answers.
              </Text>
            </Card>
          ) : null}

          {needsPassword ? (
            <>
              <Field
                label="Username"
                value={username}
                onChange={setUsername}
                placeholder="drew"
                mono
                onReveal={revealField}
              />
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
          )}

          <Field
            label="Display name (optional)"
            value={displayName}
            onChange={setDisplayName}
            placeholder={host.trim() || 'home hermes'}
            onReveal={revealField}
          />

          {picking ? (
            <Card style={styles.probeCard}>
              <View style={styles.probeHead}>
                <Icon
                  name={discovery?.failure ? 'circle-exclamation' : 'circle-check'}
                  size={14}
                  color={discovery?.failure ? theme.color.warning700 : theme.color.success700}
                />
                <Text variant="rowLabelStrong">
                  {discovery?.failure
                    ? 'Could not list what is on this host'
                    : `Found ${identities.length} agents`}
                </Text>
              </View>

              <Text variant="secondary">
                {discovery?.failure
                  ? 'It answered, but not with a list of agents. Adding it as a single agent — nothing is lost, and the list is checked again every time it connects.'
                  : 'Sessions, settings and history never mix between them. Untick any you do not want.'}
              </Text>

              {identities.map(identity => (
                <IdentityRow
                  key={identityKey(identity)}
                  identity={identity}
                  checked={chosen.has(identityKey(identity))}
                  onToggle={() => toggle(identity)}
                />
              ))}
            </Card>
          ) : null}

          {saveError ? (
            <Text variant="secondary" color={theme.color.error700}>
              {saveError}
            </Text>
          ) : null}

          <Text variant="secondary">
            Credentials go to this phone&apos;s keychain and are sent only to this host.
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={!primaryReady}
            onPress={() => void (picking ? addChosen() : connect())}
          >
            <LinearGradient
              colors={primaryReady ? gradient.colors : [theme.color.bgSubtle, theme.color.bgSubtle]}
              start={gradient.start}
              end={gradient.end}
              style={[styles.primary, { borderRadius: theme.radius.control }]}
            >
              {saving ? (
                <ActivityIndicator color={primaryReady ? '#ffffff' : theme.color.gray400} />
              ) : (
                <Text variant="rowLabelStrong" color={primaryReady ? '#ffffff' : theme.color.gray400}>
                  {picking
                    ? `Add ${chosen.size} ${chosen.size === 1 ? 'agent' : 'agents'}`
                    : 'Pair and connect'}
                </Text>
              )}
            </LinearGradient>
          </Pressable>
        </ScrollView>
      </KeyboardInset>
    </View>
  )
}

/** Null is a real scope — the default identity — so it needs its own key. */
function identityKey(identity: AgentIdentity): string {
  return identity.scope ?? ''
}

/** One discovered identity, ticked by default (§7.8). */
function IdentityRow({
  identity,
  checked,
  onToggle
}: {
  identity: AgentIdentity
  checked: boolean
  onToggle: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={styles.identityRow}
    >
      <Icon
        name={checked ? 'circle-check' : 'circle'}
        size={16}
        color={checked ? theme.color.secondary : theme.color.gray400}
      />
      <View style={styles.identityText}>
        <Text variant="rowLabelStrong">{identity.label}</Text>
        {identity.hint ? <Text variant="monoSmall">{identity.hint}</Text> : null}
      </View>
    </Pressable>
  )
}

type Probe =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'reachable'; secure: boolean; version: string; providerName: string | null; authMode: AuthMode }
  | { status: 'unreachable'; message: string }

function describeAuth(mode: AuthMode): string {
  switch (mode) {
    case 'password':
      return 'username + password'
    case 'oauth':
      return 'oauth sign-in'
    case 'token':
    default:
      return 'bearer token'
  }
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

function KindCard({
  selected,
  title,
  detail,
  onPress
}: {
  selected: boolean
  title: string
  detail: string
  onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}>
      <Card style={{ ...styles.kindCard, borderColor: selected ? theme.color.secondaryMuted : theme.color.border }}>
        <Icon
          name={selected ? 'circle-check' : 'circle'}
          size={16}
          color={selected ? theme.color.secondary : theme.color.gray400}
        />
        <View style={styles.kindText}>
          <Text variant="rowLabelStrong">{title}</Text>
          <Text variant="secondary">{detail}</Text>
        </View>
      </Card>
    </Pressable>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  mono,
  trailing,
  onReveal
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  secure?: boolean
  mono?: boolean
  trailing?: React.ReactNode
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
      <View
        style={[
          styles.input,
          { backgroundColor: theme.color.bgSubtle, borderColor: theme.color.border, borderRadius: theme.radius.control }
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.color.gray400}
          secureTextEntry={secure}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => onReveal?.(offset.current)}
          style={[
            styles.inputText,
            { color: theme.color.gray800, fontFamily: mono ? theme.font.mono : theme.font.body }
          ]}
        />
        {trailing}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 14, gap: 13 },
  kindCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14 },
  kindText: { flex: 1, minWidth: 0, gap: 2 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  identityText: { flex: 1, minWidth: 0, gap: 1 },
  field: { gap: 6 },
  input: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderWidth: 1 },
  inputText: { flex: 1, fontSize: 14 },
  outlineButton: { height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  probeCard: { padding: 14, gap: 6 },
  probeHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  primary: { height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 4 }
})
