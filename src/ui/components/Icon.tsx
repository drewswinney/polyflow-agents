import FontAwesome6 from '@expo/vector-icons/FontAwesome6'

import type { AgentIconName } from '@/domain'

import { useTheme } from '../ThemeProvider'

/**
 * The mock uses FontAwesome Solid; this keeps that mapping in one place so the
 * icon set can be swapped without touching screens. One distinct glyph per
 * agent, and one per tool type (design §Global chrome).
 */
const AGENT_GLYPH: Record<AgentIconName, string> = {
  server: 'server',
  terminal: 'terminal',
  flask: 'flask',
  cloud: 'cloud',
  home: 'house',
  car: 'car',
  robot: 'robot',
  brain: 'brain',
  rocket: 'rocket',
  bolt: 'bolt',
  code: 'code',
  database: 'database',
  microchip: 'microchip',
  laptop: 'laptop',
  compass: 'compass',
  cube: 'cube',
  leaf: 'leaf',
  ghost: 'ghost'
}

/**
 * Every glyph an agent can wear, in the order the picker shows them — read off
 * the map above rather than listed again, so a glyph cannot be added to one and
 * forgotten in the other. `Record<AgentIconName, …>` is what makes that whole:
 * a new name in the union does not compile until it has a glyph here.
 */
export const AGENT_ICONS = Object.keys(AGENT_GLYPH) as AgentIconName[]

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
