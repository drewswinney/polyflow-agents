/**
 * The pure half of the setup flow (`docs/architecture.md` §7.8): what a
 * typed host means, and the words the plugin page hands to the agent.
 */

/** A host as typed, reduced to what the app dials. */
export interface ParsedHost {
  /** `host:port`, no scheme, no path. Empty when nothing usable was typed. */
  host: string
  /**
   * The scheme the person typed, when they typed one. A pasted `http://…` is
   * an answer to the question the probe would otherwise ask; `undefined`
   * means ask.
   */
  secure?: boolean
}

/**
 * Take a host any way someone is likely to paste it.
 *
 * The dashboard URL from the browser bar (`http://hermes.lan:9119/`), the
 * bare `hermes.lan:9119` the field asks for, or the address with a path
 * after it — all reduce to the same `host:port`. The scheme is kept as a
 * hint when given, since a person who pasted `https://` knows something the
 * probe would spend two round trips finding out.
 */
export function parseHost(input: string): ParsedHost {
  let text = input.trim()

  if (!text) return { host: '' }

  let secure: boolean | undefined

  const scheme = /^(https?):\/\//i.exec(text)

  if (scheme) {
    secure = scheme[1].toLowerCase() === 'https'
    text = text.slice(scheme[0].length)
  } else {
    // A scheme that is not http(s) is not something this app can dial.
    text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  }

  // Everything from the first `/`, `?` or `#` is path, and the path is never
  // part of the host.
  const host = text.split(/[/?#]/, 1)[0].trim()

  return secure === undefined ? { host } : { host, secure }
}

/** The command the host plugin README gives, in the order it gives them. */
export const PLUGIN_INSTALL_STEPS = [
  'uv tool install polyflow-agents-push',
  'polyflow_agents_push install --copy --enable'
] as const

/**
 * What to say to the agent so it installs the plugin on its own host.
 *
 * Written for the agent, not the person: the steps are the README's, named
 * exactly, with what to do after and how to know it worked — so an agent that
 * follows them lands on a host whose routes answer, and one that cannot says
 * which step stopped it. `profile` names the one the app is talking to, since
 * a plugin enabled only in the default home fires no hooks for a profile's
 * turns (the plugin README says why).
 */
export function pluginInstallPrompt(profile: string | null): string {
  const home = profile ? `the \`${profile}\` profile's plugins directory and config` : 'this profile'

  return [
    'Please install the polyflow-agents-push plugin on this host so the Polyflow Agents app can receive notifications, keep the files you produce, and answer approvals from a phone.',
    '',
    'Steps:',
    `1. Run \`${PLUGIN_INSTALL_STEPS[0]}\` (uv ships with Hermes at ~/.hermes/bin/uv if it is not on PATH).`,
    `2. Run \`${PLUGIN_INSTALL_STEPS[1]}\` to link it under ~/.hermes/plugins and add it to plugins.enabled.`,
    `3. Make sure it is also enabled for ${home}: symlink ~/.hermes/plugins/polyflow_agents_push into the profile's plugins directory and add polyflow_agents_push to that profile's plugins.enabled.`,
    '4. Restart hermes serve and the gateway so the routes mount and the hooks register.',
    '5. Confirm by grepping ~/.hermes/logs/agent.log for "Mounted plugin API routes: /api/plugins/polyflow_agents_push" and "registered 5 hook(s)".',
    '',
    'Tell me which steps succeeded, and if one failed, what it said.'
  ].join('\n')
}

/** Where the flow is, as the step indicator draws it. */
export type SetupStep = 'welcome' | 'connect' | 'plugin'

export const SETUP_STEPS: readonly SetupStep[] = ['welcome', 'connect', 'plugin']

export function setupStepIndex(step: SetupStep): number {
  return SETUP_STEPS.indexOf(step)
}
