import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '../ThemeProvider'
import { IconButton } from './IconButton'
import { Text } from './Text'

/** Inside the card. The card's own margin adds to it to reach the screen edge. */
const SCREEN_PAD = 14
/** Between the card and the screen edge, matching the composer's. */
const CARD_INSET = 12
const ROW_GAP = 6
/** The control's touch slot. Never smaller than the ring it draws: Android
 *  does not deliver a touch that lands outside the parent's bounds, so a ring
 *  overhanging its own Pressable would have a dead rim. */
const BACK_SLOT = 44
/** The drawn circle inside that slot. */
const BACK_RING = 40

/** The title row's floor, which is also the action's touch slot. */
const TITLE_ROW = 44

/**
 * How many blur layers the header's fade is built from, and how hard each one is.
 *
 * React Native cannot vary a blur radius across a single view, so the gradient
 * is stacked rather than interpolated: each layer covers less of the header
 * than the one under it, so at the top all of them overlap and at the bottom
 * only the first does. Five steps is where the banding stops reading as bands;
 * fewer and the steps are visible, more and the top layers cost frames for a
 * difference nobody sees.
 */
const BLUR_LAYERS = 5
const BLUR_STEP = 24

/** The same colour at zero alpha, so a fade ends in nothing rather than in black. */
function clear(rgba: string): string {
  return rgba.replace(/,\s*[\d.]+\)$/, ',0)')
}

/**
 * What makes a floating header readable over the content it floats on.
 *
 * Blur alone does not do it — blurred text is still text-coloured, and a title
 * over it competes with the smear. The wash on top is what actually separates
 * them; the blur is what stops the wash looking like a flat bar laid over the
 * screen. Both fade out downward, so the content is untouched a few pixels
 * below the controls.
 */
function HeaderScrim() {
  const theme = useTheme()
  const wash = theme.color.headerWash

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: BLUR_LAYERS }, (_, index) => (
        <BlurView
          key={index}
          intensity={BLUR_STEP}
          tint={theme.dark ? 'dark' : 'light'}
          style={[styles.blurLayer, { height: `${100 - (index * 100) / BLUR_LAYERS}%` }]}
        />
      ))}
      {/* Held, then dropped. A straight wash-to-nothing spreads the fade over
          the whole header and leaves the top too thin to read a title on; this
          keeps it solid behind the controls and spends the falloff in the last
          third, where the content is coming back anyway. */}
      <LinearGradient
        colors={[theme.color.bg, wash, clear(wash)]}
        locations={[0, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  )
}

/**
 * How much of the top of a screen the floating header covers.
 *
 * Screens add this to their scrolling content's `paddingTop`, so the first row
 * starts below the controls while the content behind them still runs to the
 * top of the page. Computed rather than measured: every part of it is a
 * constant or an inset, and a measured height would arrive a frame after the
 * list had already laid out against the wrong one.
 *
 * A subtitle is not counted. Only chat has one and only while the connection
 * is unhappy, and reserving its height on every screen for good would be a
 * permanent gap paid for a rare row.
 */
export function useHeaderInset(insetTop = true): number {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  return (insetTop ? insets.top : 0) + theme.space.headerTop + TITLE_ROW + theme.space.headerBottom
}

/**
 * Where the title's left edge actually lands once the chevron's slot and its
 * overhang are accounted for. Derived rather than eyeballed so the subtitle
 * cannot drift out of alignment with the title it belongs to.
 */
const TITLE_INDENT = SCREEN_PAD - (BACK_SLOT - BACK_RING) / 2 + BACK_SLOT + ROW_GAP

/**
 * The agent switcher is not here: it says which agent the whole app is pointed
 * at, which is a property of the app rather than of the screen under it, so it
 * lives at the top of the sidebar with the rest of the app-wide navigation.
 *
 * The Polyflow navbar treatment: translucent wash over 12px blur, as a rounded
 * card floating inside the screen's padding rather than a full-width bar ruled
 * off with a bottom border. It answers the composer at the other end of the
 * screen — the two are the app's floating chrome and share `radius.floating`.
 *
 * The blur stays. It is what lets a floating element sit over content without
 * turning into a slab: a solid fill would be the composer's treatment applied
 * to the one piece of chrome that content actually passes under.
 *
 * Right-side actions are bare icons in a 44px tap slot — no chip, no border
 * (design §Design system).
 *
 * Laid out as three explicit rows — pill, title line, subtitle — rather than the
 * mock's construction of one bottom-aligned row with the pill absolutely
 * positioned above it. That construction cannot keep a right-hand action inline
 * with the title: bottom-aligning the row aligns the action with the *last* line
 * of the title block, so the moment a subtitle appears the action drops a line
 * below the title it belongs to. Explicit rows make "inline with the title" true
 * by construction, in both the one-line and title-plus-subtitle cases.
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  onMenu,
  titleVariant,
  right,
  insetTop = true
}: {
  /** Absent on a screen whose content already names itself. */
  title?: string
  subtitle?: ReactNode
  onBack?: () => void
  /**
   * Opens the sidebar. Top-level screens pass this where a sub-screen passes
   * `onBack` — the slot is the same, because the two never both apply: a screen
   * you can go back from is one you did not reach from the sidebar.
   */
  onMenu?: () => void
  /**
   * Type size for the title. Defaults to the display size on a screen you
   * cannot go back from and the smaller one where you can — which is right
   * until a screen has both a hamburger *and* content for a title, as chat
   * does: the session's own name is not a screen name and should not be set
   * like one.
   */
  titleVariant?: 'screen' | 'sub'
  right?: ReactNode
  /**
   * Whether to reserve room for the status bar.
   *
   * False inside a modal. A modally presented screen is already inset by the
   * card that hosts it, but the safe-area context still reports the *window's*
   * top inset — so applying it there pads twice and the header floats.
   */
  insetTop?: boolean
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  // Top-level screens read as a nav bar — menu, centred title, action. Screens
  // reached by a chevron keep the design's left-aligned title, which is what
  // lets a subtitle hang under it.
  const centred = !onBack && Boolean(onMenu)

  const leftControl = onBack ? (
    // The design draws a 34px slot; the shortfall against the 44px minimum is
    // made up in hitSlop rather than by moving the chevron.
    <IconButton name="chevron-left" accessibilityLabel="Back" slot={BACK_SLOT} edge="left" outlined onPress={onBack} />
  ) : onMenu ? (
    <IconButton name="bars" accessibilityLabel="Open navigation" slot={BACK_SLOT} edge="left" outlined onPress={onMenu} />
  ) : null

  return (
    // Bare and floating: no fill, no blur, no border, and pinned over the
    // screen rather than stacked above it — the content runs to the top of the
    // page and scrolls under these controls. `box-none` so only the controls
    // themselves take touches; the empty width between them belongs to
    // whatever has scrolled beneath.
    <View
      pointerEvents="box-none"
      style={[
        styles.frame,
        {
          paddingTop: (insetTop ? insets.top : 0) + theme.space.headerTop,
          // Height for the fade to happen in. Without it the gradient has only
          // the controls' own row to work with and has to fall off inside the
          // glyphs; the padding is what lets it finish below them. Counted by
          // `useHeaderInset`, so the clearance screens leave matches it.
          paddingBottom: theme.space.headerBottom
        }
      ]}
    >
      <HeaderScrim />

      {/* Everything on this row shares one vertical centre — that is the whole
          point of it being its own row. */}
      <View style={styles.titleRow}>
        {/* A centred title needs equal-width side slots — centred on the screen,
            not on whatever space the two controls happen to leave. A left-aligned
            one must not have them: the title sits directly against the chevron,
            and `TITLE_INDENT` is derived from exactly that. */}
        {centred ? <View style={styles.side}>{leftControl}</View> : leftControl}

        {/* Chat has none: the session's name is already the thing you tapped
            to get here, and repeating it over the transcript spent the widest
            line on the screen restating what you just read. A spacer keeps the
            action on the trailing edge without it. */}
        {title ? (
          <Text
            variant={(titleVariant ?? (onBack ? 'sub' : 'screen')) === 'sub' ? 'subTitle' : 'screenTitle'}
            numberOfLines={1}
            style={[styles.title, centred ? styles.titleCentred : null]}
          >
            {title}
          </Text>
        ) : (
          <View style={styles.title} />
        )}

        {centred ? <View style={[styles.side, styles.sideRight]}>{right}</View> : right}
      </View>

      {subtitle ? (
        // Under a centred title it centres too; beside a chevron it is indented
        // to sit under the title rather than under the chevron.
        <View
          style={[
            styles.subtitleRow,
            centred ? styles.subtitleCentred : onBack ? { paddingLeft: TITLE_INDENT } : null
          ]}
        >
          {subtitle}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Above the screen's own content, below anything modal.
    zIndex: 10,
    paddingHorizontal: CARD_INSET,
    // The scrim is drawn edge to edge behind the padding, so it must not be
    // clipped to the content box.
    overflow: 'visible'
  },
  blurLayer: { position: 'absolute', top: 0, left: 0, right: 0 },
  // Separates two siblings now, rather than padding inside the card — so it
  // wants more than the 6 it had when it was one row stacked on another.
  pillRow: { alignItems: 'center', paddingBottom: 14 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SCREEN_PAD,
    gap: ROW_GAP,
    // Tall enough for the 44px action slot, so a header with an action is not
    // taller than one without.
    minHeight: TITLE_ROW
  },
  title: { flex: 1, minWidth: 0 },
  titleCentred: { textAlign: 'center' },
  // 44 = the action's touch slot, so both sides reserve the same width whether
  // or not a screen has an action.
  side: { width: 44, alignItems: 'flex-start', justifyContent: 'center' },
  sideRight: { alignItems: 'flex-end' },
  subtitleRow: { paddingHorizontal: SCREEN_PAD, paddingTop: 2 },
  subtitleCentred: { alignItems: 'center' }
})
