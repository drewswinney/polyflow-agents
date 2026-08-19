import FontAwesome6 from '@expo/vector-icons/FontAwesome6'

import type { AgentIconName } from '@/domain'

import { useTheme } from '../ThemeProvider'

/**
 * The mock uses FontAwesome Solid; this keeps that mapping in one place so the
 * icon set can be swapped without touching screens. One distinct glyph per
 * agent, and one per tool type (design §Global chrome).
 */
const AGENT_GLYPH: Record<AgentIconName, string> = {
  home: 'house',
  car: 'car',
  flask: 'flask',
  cloud: 'cloud',
  server: 'server',
  terminal: 'terminal'
}

export function AgentGlyph({ name, size = 11, color }: { name: AgentIconName; size?: number; color?: string }) {
  const theme = useTheme()

  return <FontAwesome6 name={AGENT_GLYPH[name] as never} size={size} color={color ?? theme.color.secondary} solid />
}

const TOOL_GLYPH: Record<string, string> = {
  shell: 'terminal',
  terminal: 'terminal',
  execute_code: 'code',
  read: 'file-lines',
  write: 'pen',
  search: 'magnifying-glass',
  web: 'globe',
  tool: 'wrench'
}

export function ToolGlyph({ name, size = 13, color }: { name: string; size?: number; color?: string }) {
  const theme = useTheme()
  const glyph = TOOL_GLYPH[name] ?? TOOL_GLYPH.tool

  return <FontAwesome6 name={glyph as never} size={size} color={color ?? theme.color.secondary} solid />
}

export function Icon({ name, size = 17, color }: { name: string; size?: number; color?: string }) {
  const theme = useTheme()

  return <FontAwesome6 name={name as never} size={size} color={color ?? theme.color.gray600} solid />
}
