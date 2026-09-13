import { parseHost, PLUGIN_INSTALL_STEPS, pluginInstallPrompt, setupStepIndex } from '@/ui/setup'

describe('parseHost', () => {
  it('takes the bare host:port the field asks for', () => {
    expect(parseHost('hermes.lan:9119')).toEqual({ host: 'hermes.lan:9119' })
    expect(parseHost('  100.122.164.50:9119  ')).toEqual({ host: '100.122.164.50:9119' })
  })

  it('takes a pasted dashboard URL, keeping the scheme as a hint', () => {
    expect(parseHost('http://hermes.lan:9119/')).toEqual({ host: 'hermes.lan:9119', secure: false })
    expect(parseHost('https://hermes.tailnet.ts.net/api/status')).toEqual({ host: 'hermes.tailnet.ts.net', secure: true })
    expect(parseHost('HTTP://Hermes.lan:9119?x=1#y')).toEqual({ host: 'Hermes.lan:9119', secure: false })
  })

  it('drops a scheme it cannot dial without guessing at TLS', () => {
    expect(parseHost('ws://hermes.lan:9119/socket')).toEqual({ host: 'hermes.lan:9119' })
  })

  it('is empty for nothing, and for a scheme alone', () => {
    expect(parseHost('')).toEqual({ host: '' })
    expect(parseHost('   ')).toEqual({ host: '' })
    expect(parseHost('http://')).toEqual({ host: '', secure: false })
  })
})

describe('pluginInstallPrompt', () => {
  it('names the README steps exactly, in order', () => {
    const prompt = pluginInstallPrompt(null)
    const first = prompt.indexOf(PLUGIN_INSTALL_STEPS[0])
    const second = prompt.indexOf(PLUGIN_INSTALL_STEPS[1])

    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
  })

  it('tells the agent which profile has to enable it', () => {
    expect(pluginInstallPrompt('greg')).toContain('`greg` profile')
    expect(pluginInstallPrompt(null)).not.toContain('profile\'s plugins directory and config')
  })

  it('asks for the log lines that prove it took', () => {
    expect(pluginInstallPrompt(null)).toContain('Mounted plugin API routes: /api/plugins/polyflow_agents_push')
  })
})

describe('setupStepIndex', () => {
  it('orders the pages the way the indicator draws them', () => {
    expect(setupStepIndex('welcome')).toBe(0)
    expect(setupStepIndex('connect')).toBe(1)
    expect(setupStepIndex('plugin')).toBe(2)
  })
})
