import { useRef, useEffect, useCallback } from 'react'
import type { LivelinePoint, LivelinePalette, LivelineSeries, Momentum, ReferenceLine, HoverPoint, Padding, ChartLayout, OrderbookData, DegenOptions, BadgeVariant, CandlePoint } from './types'
import { lerp } from './math/lerp'
import { computeRange } from './math/range'
import { detectMomentum } from './math/momentum'
import { interpolateAtTime } from './math/interpolate'
import { getDpr, applyDpr } from './canvas/dpr'
import { drawFrame, drawCandleFrame, drawMultiFrame, FADE_EDGE_WIDTH } from './draw'
import type { MultiSeriesEntry } from './draw'
import { drawLoading } from './draw/loading'
import { drawEmpty } from './draw/empty'
import { createOrderbookState } from './draw/orderbook'
import { createParticleState } from './draw/particles'
import { createShakeState } from './draw'
import { badgeSvgPath, badgePillOnly, BADGE_PAD_X, BADGE_PAD_Y, BADGE_TAIL_LEN, BADGE_TAIL_SPREAD, BADGE_LINE_H } from './draw/badge'

interface EngineConfig {
  data: LivelinePoint[]
  value: number
  palette: LivelinePalette
  windowSecs: number
  lerpSpeed: number
  showGrid: boolean
  showBadge: boolean
  showMomentum: boolean
  momentumOverride?: Momentum
  showFill: boolean
  referenceLine?: ReferenceLine
  formatValue: (v: number) => string
  formatTime: (t: number) => string
  padding: Required<Padding>
  onHover?: (point: HoverPoint | null) => void
  showPulse: boolean
  scrub: boolean
  exaggerate: boolean
  degenOptions?: DegenOptions
  badgeTail: boolean
  badgeVariant: BadgeVariant
  tooltipY: number
  tooltipOutline: boolean
  valueMomentumColor: boolean
  valueDisplayRef?: React.RefObject<HTMLSpanElement | null>
  orderbookData?: OrderbookData
  loading?: boolean
  paused?: boolean
  emptyText?: string

  // Candlestick mode
  mode: 'line' | 'candle'
  candles?: CandlePoint[]
  candleWidth?: number
  liveCandle?: CandlePoint
  lineMode?: boolean
  lineData?: LivelinePoint[]
  lineValue?: number

  // Multi-series mode
  multiSeries?: Array<{
    id: string
    data: LivelinePoint[]
    value: number
    palette: LivelinePalette
    label?: string
  }>
  isMultiSeries?: boolean
  hiddenSeriesIds?: Set<string>
}

interface BadgeEls {
  container: HTMLDivElement
  svg: SVGSVGElement
  path: SVGPathElement
  text: HTMLSpanElement
  displayW: number   // current lerped text width
  targetW: number    // target text width
}

const SVG_NS = 'http://www.w3.org/2000/svg'

// --- Constants ---
const MAX_DELTA_MS = 50
const SCRUB_LERP_SPEED = 0.12
const BADGE_WIDTH_LERP = 0.15
const BADGE_Y_LERP = 0.35
const BADGE_Y_LERP_TRANSITIONING = 0.5
const MOMENTUM_COLOR_LERP = 0.12
const WINDOW_TRANSITION_MS = 750
const WINDOW_BUFFER = 0.05
const VALUE_SNAP_THRESHOLD = 0.001
const ADAPTIVE_SPEED_BOOST = 0.2
const MOMENTUM_GREEN: [number, number, number] = [34, 197, 94]
const MOMENTUM_RED: [number, number, number] = [239, 68, 68]
const CHART_REVEAL_SPEED = 0.14     // data → loading/empty (reverse)
const CHART_REVEAL_SPEED_FWD = 0.09 // loading/empty → data (forward, slower for choreography)
const PAUSE_PROGRESS_SPEED = 0.12
const PAUSE_CATCHUP_SPEED = 0.08
const PAUSE_CATCHUP_SPEED_FAST = 0.22
const LOADING_ALPHA_SPEED = 0.14
const SERIES_TOGGLE_SPEED = 0.10

// --- Candle-specific constants ---
const CANDLE_LERP_SPEED = 0.25
const CANDLE_WIDTH_TRANS_MS = 300
const LINE_MORPH_MS = 500
const CLOSE_LINE_LERP_SPEED = 0.25  // matches candle body speed
const LINE_DENSITY_MS = 350
const LINE_LERP_BASE = 0.08
const LINE_ADAPTIVE_BOOST = 0.2
const LINE_SNAP_THRESHOLD = 0.001
const RANGE_LERP_SPEED = 0.15
const RANGE_ADAPTIVE_BOOST = 0.2
const CANDLE_BUFFER = 0.05

// --- Extracted helper functions (pure computation, called inside draw loop) ---

interface WindowTransState {
  from: number; to: number; startMs: number
  rangeFromMin: number; rangeFromMax: number; rangeToMin: number; rangeToMax: number
}

/** Lerp display value with adaptive speed — slow for big jumps, fast for small ticks. */
function computeAdaptiveSpeed(
  value: number,
  displayValue: number,
  displayMin: number,
  displayMax: number,
  lerpSpeed: number,
  noMotion: boolean,
): number {
  const valGap = Math.abs(value - displayValue)
  const prevRange = displayMax - displayMin || 1
  const gapRatio = Math.min(valGap / prevRange, 1)
  return noMotion ? 1 : lerpSpeed + (1 - gapRatio) * ADAPTIVE_SPEED_BOOST
}

/** Update window transition state, returning current display window and transition progress. */
function updateWindowTransition(
  cfg: EngineConfig,
  wt: WindowTransState,
  displayWindow: number,
  displayMin: number,
  displayMax: number,
  noMotion: boolean,
  now_ms: number,
  now: number,
  points: LivelinePoint[],
  smoothValue: number,
  buffer: number,
): { windowSecs: number; windowTransProgress: number } {
  if (wt.to !== cfg.windowSecs) {
    wt.from = displayWindow
    wt.to = cfg.windowSecs
    wt.startMs = now_ms
    wt.rangeFromMin = displayMin
    wt.rangeFromMax = displayMax
    const targetRightEdge = now + cfg.windowSecs * buffer
    const targetLeftEdge = targetRightEdge - cfg.windowSecs
    const targetVisible: LivelinePoint[] = []
    for (const p of points) {
      if (p.time >= targetLeftEdge - 2 && p.time <= targetRightEdge) {
        targetVisible.push(p)
      }
    }
    if (targetVisible.length > 0) {
      const targetRange = computeRange(targetVisible, smoothValue, cfg.referenceLine?.value, cfg.exaggerate)
      wt.rangeToMin = targetRange.min
      wt.rangeToMax = targetRange.max
    }
  }

  let windowTransProgress = 0
  let resultWindow: number
  if (noMotion || wt.startMs === 0) {
    resultWindow = cfg.windowSecs
  } else {
    const elapsed = now_ms - wt.startMs
    const duration = WINDOW_TRANSITION_MS
    const t = Math.min(elapsed / duration, 1)
    const eased = (1 - Math.cos(t * Math.PI)) / 2
    windowTransProgress = eased
    const logFrom = Math.log(wt.from)
    const logTo = Math.log(wt.to)
    resultWindow = Math.exp(logFrom + (logTo - logFrom) * eased)
    if (t >= 1) {
      resultWindow = cfg.windowSecs
      wt.startMs = 0
      windowTransProgress = 0
    }
  }

  return { windowSecs: resultWindow, windowTransProgress }
}

/** Smooth Y range with lerp. During window transitions, interpolates between pre-computed ranges. */
function updateRange(
  computedRange: { min: number; max: number },
  rangeInited: boolean,
  targetMin: number,
  targetMax: number,
  displayMin: number,
  displayMax: number,
  isTransitioning: boolean,
  windowTransProgress: number,
  wt: WindowTransState,
  adaptiveSpeed: number,
  chartH: number,
  dt: number,
): { minVal: number; maxVal: number; valRange: number; targetMin: number; targetMax: number; displayMin: number; displayMax: number; rangeInited: boolean } {
  if (!rangeInited) {
    return {
      minVal: computedRange.min, maxVal: computedRange.max,
      valRange: (computedRange.max - computedRange.min) || 0.001,
      targetMin: computedRange.min, targetMax: computedRange.max,
      displayMin: computedRange.min, displayMax: computedRange.max,
      rangeInited: true,
    }
  }

  if (isTransitioning) {
    displayMin = wt.rangeFromMin + (wt.rangeToMin - wt.rangeFromMin) * windowTransProgress
    displayMax = wt.rangeFromMax + (wt.rangeToMax - wt.rangeFromMax) * windowTransProgress
    targetMin = computedRange.min
    targetMax = computedRange.max
  } else {
    const curRange = displayMax - displayMin
    targetMin = computedRange.min
    targetMax = computedRange.max
    displayMin = lerp(displayMin, targetMin, adaptiveSpeed, dt)
    displayMax = lerp(displayMax, targetMax, adaptiveSpeed, dt)
    const pxThreshold = 0.5 * curRange / chartH || 0.001
    if (Math.abs(displayMin - targetMin) < pxThreshold) displayMin = targetMin
    if (Math.abs(displayMax - targetMax) < pxThreshold) displayMax = targetMax
  }

  return {
    minVal: displayMin, maxVal: displayMax,
    valRange: (displayMax - displayMin) || 0.001,
    targetMin, targetMax, displayMin, displayMax,
    rangeInited: true,
  }
}

/** Compute hover position, interpolated value, and scrub amount. */
function updateHoverState(
  hoverPixelX: number | null,
  pad: Required<Padding>,
  w: number,
  layout: ChartLayout,
  now: number,
  visible: LivelinePoint[],
  scrubAmount: number,
  lastHover: { x: number; value: number; time: number } | null,
  cfg: EngineConfig,
  noMotion: boolean,
  leftEdge: number,
  rightEdge: number,
  chartW: number,
  dt: number,
): {
  hoverX: number | null; hoverValue: number | null; hoverTime: number | null
  scrubAmount: number; isActiveHover: boolean
  lastHover: { x: number; value: number; time: number } | null
} {
  let hoverValue: number | null = null
  let hoverTime: number | null = null
  let hoverChartX: number | null = null
  let isActiveHover = false

  if (hoverPixelX !== null && hoverPixelX >= pad.left && hoverPixelX <= w - pad.right) {
    const maxHoverX = layout.toX(now)
    const clampedX = Math.min(hoverPixelX, maxHoverX)
    const t = leftEdge + ((clampedX - pad.left) / chartW) * (rightEdge - leftEdge)
    const v = interpolateAtTime(visible, t)
    if (v !== null) {
      hoverValue = v
      hoverTime = t
      hoverChartX = clampedX
      isActiveHover = true
      lastHover = { x: clampedX, value: v, time: t }
      cfg.onHover?.({ time: t, value: v, x: clampedX, y: layout.toY(v) })
    }
  }

  // Lerp scrub amount
  const scrubTarget = isActiveHover ? 1 : 0
  if (noMotion) {
    scrubAmount = scrubTarget
  } else {
    scrubAmount += (scrubTarget - scrubAmount) * SCRUB_LERP_SPEED
    if (scrubAmount < 0.01) scrubAmount = 0
    if (scrubAmount > 0.99) scrubAmount = 1
  }

  // Use last known position during fade-out
  let drawHoverX = hoverChartX
  let drawHoverValue = hoverValue
  let drawHoverTime = hoverTime
  if (!isActiveHover && scrubAmount > 0 && lastHover) {
    drawHoverX = lastHover.x
    drawHoverValue = lastHover.value
    drawHoverTime = lastHover.time
  }

  return {
    hoverX: drawHoverX, hoverValue: drawHoverValue, hoverTime: drawHoverTime,
    scrubAmount, isActiveHover, lastHover,
  }
}

/** Update badge DOM element — text, width lerp, SVG path, position, color. */
function updateBadgeDOM(
  badge: BadgeEls,
  cfg: EngineConfig,
  smoothValue: number,
  layout: ChartLayout,
  momentum: Momentum,
  badgeY: number | null,
  badgeColor: { green: number },
  isWindowTransitioning: boolean,
  noMotion: boolean,
  ctx: CanvasRenderingContext2D,
  dt: number,
  chartReveal: number = 1,
): number | null /* updated badgeY */ {
  if (!cfg.showBadge || chartReveal < 0.25) {
    badge.container.style.display = 'none'
    return badgeY
  }

  badge.container.style.display = ''
  const badgeOpacity = chartReveal < 0.5 ? (chartReveal - 0.25) / 0.25 : 1
  badge.container.style.opacity = badgeOpacity < 1 ? String(badgeOpacity) : ''
  const { w, h, pad } = layout

  const text = cfg.formatValue(smoothValue)
  badge.text.textContent = text
  badge.text.style.font = cfg.palette.labelFont
  badge.text.style.lineHeight = `${BADGE_LINE_H}px`
  const tailLen = cfg.badgeTail ? BADGE_TAIL_LEN : 0
  badge.text.style.padding = `${BADGE_PAD_Y}px ${BADGE_PAD_X}px ${BADGE_PAD_Y}px ${tailLen + BADGE_PAD_X}px`

  // Measure target text width using canvas (template with widest digits)
  ctx.font = cfg.palette.labelFont
  const template = text.replace(/[0-9]/g, '8')
  const targetTextW = ctx.measureText(template).width

  // Smooth-lerp the badge width
  badge.targetW = targetTextW
  if (badge.displayW === 0) badge.displayW = targetTextW
  badge.displayW = lerp(badge.displayW, badge.targetW, BADGE_WIDTH_LERP, dt)
  if (Math.abs(badge.displayW - badge.targetW) < 0.3) badge.displayW = badge.targetW
  const textW = badge.displayW

  const pillW = textW + BADGE_PAD_X * 2
  const pillH = BADGE_LINE_H + BADGE_PAD_Y * 2

  const totalW = tailLen + pillW
  badge.svg.setAttribute('width', String(Math.ceil(totalW)))
  badge.svg.setAttribute('height', String(pillH))
  badge.svg.setAttribute('viewBox', `0 0 ${totalW} ${pillH}`)
  badge.path.setAttribute('d', cfg.badgeTail
    ? badgeSvgPath(pillW, pillH, BADGE_TAIL_LEN, BADGE_TAIL_SPREAD)
    : badgePillOnly(pillW, pillH))

  // Badge Y lerp — decoupled from range/value math, morphed during reveal
  const centerY = pad.top + layout.chartH / 2
  const realTargetY = Math.max(pad.top, Math.min(h - pad.bottom, layout.toY(smoothValue)))
  const targetBadgeY = chartReveal < 1
    ? centerY + (realTargetY - centerY) * chartReveal
    : realTargetY
  if (badgeY === null || noMotion) {
    badgeY = targetBadgeY
  } else {
    const badgeSpeed = isWindowTransitioning ? BADGE_Y_LERP_TRANSITIONING : BADGE_Y_LERP
    badgeY = lerp(badgeY, targetBadgeY, badgeSpeed, dt)
  }

  const badgeLeft = w - pad.right + 8 - BADGE_PAD_X - tailLen
  const badgeTop = badgeY - pillH / 2
  badge.container.style.transform = `translate3d(${badgeLeft}px, ${badgeTop}px, 0)`

  // Badge styling
  if (cfg.badgeVariant === 'minimal') {
    badge.path.setAttribute('fill', cfg.palette.badgeOuterBg)
    badge.text.style.color = cfg.palette.tooltipText
    badge.container.style.filter = `drop-shadow(0 1px 4px ${cfg.palette.badgeOuterShadow})`
  } else {
    badge.container.style.filter = ''
    badge.text.style.color = '#fff'
    const bs = badgeColor
    let fillColor: string
    if (!cfg.showMomentum) {
      fillColor = cfg.palette.line
    } else {
      const target = momentum === 'up' ? 1 : momentum === 'down' ? 0 : bs.green
      bs.green = noMotion ? target : lerp(bs.green, target, MOMENTUM_COLOR_LERP, dt)
      if (bs.green > 0.99) bs.green = 1
      if (bs.green < 0.01) bs.green = 0
      const g = bs.green
      const rr = Math.round(MOMENTUM_RED[0] + (MOMENTUM_GREEN[0] - MOMENTUM_RED[0]) * g)
      const gg = Math.round(MOMENTUM_RED[1] + (MOMENTUM_GREEN[1] - MOMENTUM_RED[1]) * g)
      const bb = Math.round(MOMENTUM_RED[2] + (MOMENTUM_GREEN[2] - MOMENTUM_RED[2]) * g)
      fillColor = `rgb(${rr},${gg},${bb})`
    }
    badge.path.setAttribute('fill', fillColor)
  }

  return badgeY
}

// --- Candle-specific helper functions ---

function computeCandleRange(
  candles: CandlePoint[],
): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const c of candles) {
    if (c.low < min) min = c.low
    if (c.high > max) max = c.high
  }
  if (!isFinite(min) || !isFinite(max)) return { min: 99, max: 101 }
  const range = max - min
  const margin = range * 0.12
  const minRange = range * 0.1 || 0.4
  if (range < minRange) {
    const mid = (min + max) / 2
    return { min: mid - minRange / 2, max: mid + minRange / 2 }
  }
  return { min: min - margin, max: max + margin }
}

function candleAtX(
  candles: CandlePoint[],
  hoverX: number,
  candleWidth: number,
  layout: ChartLayout,
): CandlePoint | null {
  const time = layout.leftEdge + ((hoverX - layout.pad.left) / layout.chartW) * (layout.rightEdge - layout.leftEdge)
  let lo = 0
  let hi = candles.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = candles[mid]
    if (time < c.time) hi = mid - 1
    else if (time >= c.time + candleWidth) lo = mid + 1
    else return c
  }
  return null
}

/** Smooth Y range for candle mode — adaptive speed, no target tracking. */
function updateCandleRange(
  computedRange: { min: number; max: number },
  rangeInited: boolean,
  displayMin: number,
  displayMax: number,
  isTransitioning: boolean,
  windowTransProgress: number,
  wt: { rangeFromMin: number; rangeFromMax: number; rangeToMin: number; rangeToMax: number },
  chartH: number,
  dt: number,
): { minVal: number; maxVal: number; valRange: number; displayMin: number; displayMax: number; rangeInited: boolean } {
  if (!rangeInited) {
    return {
      minVal: computedRange.min, maxVal: computedRange.max,
      valRange: (computedRange.max - computedRange.min) || 0.001,
      displayMin: computedRange.min, displayMax: computedRange.max,
      rangeInited: true,
    }
  }

  if (isTransitioning) {
    displayMin = wt.rangeFromMin + (wt.rangeToMin - wt.rangeFromMin) * windowTransProgress
    displayMax = wt.rangeFromMax + (wt.rangeToMax - wt.rangeFromMax) * windowTransProgress
  } else {
    const curRange = displayMax - displayMin || 1
    const gapMin = Math.abs(displayMin - computedRange.min)
    const gapMax = Math.abs(displayMax - computedRange.max)
    const gapRatio = Math.min((gapMin + gapMax) / curRange, 1)
    const speed = RANGE_LERP_SPEED + (1 - gapRatio) * RANGE_ADAPTIVE_BOOST

    displayMin = lerp(displayMin, computedRange.min, speed, dt)
    displayMax = lerp(displayMax, computedRange.max, speed, dt)
    const pxThreshold = 0.5 * curRange / chartH || 0.001
    if (Math.abs(displayMin - computedRange.min) < pxThreshold) displayMin = computedRange.min
    if (Math.abs(displayMax - computedRange.max) < pxThreshold) displayMax = computedRange.max
  }

  return {
    minVal: displayMin, maxVal: displayMax,
    valRange: (displayMax - displayMin) || 0.001,
    displayMin, displayMax,
    rangeInited: true,
  }
}

/** Candle window transition — uses candle data instead of line points. */
function updateCandleWindowTransition(
  targetWindowSecs: number,
  wt: { from: number; to: number; startMs: number; rangeFromMin: number; rangeFromMax: number; rangeToMin: number; rangeToMax: number },
  displayWindow: number,
  displayMin: number,
  displayMax: number,
  now_ms: number,
  now: number,
  candles: CandlePoint[],
  liveCandle: CandlePoint | undefined,
  candleWidth: number,
  buffer: number,
): { windowSecs: number; windowTransProgress: number } {
  if (wt.to !== targetWindowSecs) {
    wt.from = displayWindow
    wt.to = targetWindowSecs
    wt.startMs = now_ms
    wt.rangeFromMin = displayMin
    wt.rangeFromMax = displayMax
    const targetRightEdge = now + targetWindowSecs * buffer
    const targetLeftEdge = targetRightEdge - targetWindowSecs
    const targetVisible: CandlePoint[] = []
    for (const c of candles) {
      if (c.time + candleWidth >= targetLeftEdge && c.time <= targetRightEdge) {
        targetVisible.push(c)
      }
    }
    if (liveCandle && liveCandle.time + candleWidth >= targetLeftEdge && liveCandle.time <= targetRightEdge) {
      targetVisible.push(liveCandle)
    }
    if (targetVisible.length > 0) {
      const tr = computeCandleRange(targetVisible)
      wt.rangeToMin = tr.min
      wt.rangeToMax = tr.max
    }
  }

  let windowTransProgress = 0
  let resultWindow: number
  if (wt.startMs === 0) {
    resultWindow = targetWindowSecs
  } else {
    const elapsed = now_ms - wt.startMs
    const t = Math.min(elapsed / WINDOW_TRANSITION_MS, 1)
    const eased = (1 - Math.cos(t * Math.PI)) / 2
    windowTransProgress = eased
    const logFrom = Math.log(wt.from)
    const logTo = Math.log(wt.to)
    resultWindow = Math.exp(logFrom + (logTo - logFrom) * eased)
    if (t >= 1) {
      resultWindow = targetWindowSecs
      wt.startMs = 0
      windowTransProgress = 0
    }
  }

  return { windowSecs: resultWindow, windowTransProgress }
}

export function useLivelineEngine(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  config: EngineConfig,
) {
  // Store config in refs to avoid re-creating the draw loop
  const configRef = useRef(config)
  configRef.current = config

  // Animation state (persistent across frames, no allocations)
  const displayValueRef = useRef(config.value)
  const displayValuesRef = useRef<Map<string, number>>(new Map())
  const seriesAlphaRef = useRef<Map<string, number>>(new Map())
  const displayMinRef = useRef(0)
  const displayMaxRef = useRef(0)
  const targetMinRef = useRef(0)
  const targetMaxRef = useRef(0)
  const rangeInitedRef = useRef(false)
  const displayWindowRef = useRef(config.windowSecs)
  const windowTransitionRef = useRef({
    from: config.windowSecs, to: config.windowSecs, startMs: 0,
    rangeFromMin: 0, rangeFromMax: 0, rangeToMin: 0, rangeToMax: 0,
  })
  const arrowStateRef = useRef({ up: 0, down: 0 })
  const gridStateRef = useRef({ interval: 0, labels: new Map<number, number>() }) // labels: key=Math.round(val*1000), value=alpha
  const timeAxisStateRef = useRef({ labels: new Map<number, { alpha: number; text: string }>() })
  const orderbookStateRef = useRef(createOrderbookState())
  const particleStateRef = useRef(createParticleState())
  const shakeStateRef = useRef(createShakeState())
  const badgeColorRef = useRef({ green: 1 })
  const badgeYRef = useRef<number | null>(null) // lerped badge Y, null = uninited
  const reducedMotionRef = useRef(false)
  const sizeRef = useRef({ w: 0, h: 0 })
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const rafRef = useRef(0)
  const lastFrameRef = useRef(0)

  // Badge DOM element refs
  const badgeRef = useRef<BadgeEls | null>(null)

  // Hover state
  const hoverXRef = useRef<number | null>(null)
  const scrubAmountRef = useRef(0) // 0 = not scrubbing, 1 = fully scrubbing
  const lastHoverRef = useRef<{ x: number; value: number; time: number } | null>(null)
  const lastHoverEntriesRef = useRef<{ color: string; label: string; value: number }[]>([])

  // Reveal state (loading → chart morph)
  const chartRevealRef = useRef(0) // 0 = loading/empty, 1 = fully revealed

  // Pause state
  const pauseProgressRef = useRef(0) // 0 = playing, 1 = fully paused
  const timeDebtRef = useRef(0) // accumulated seconds behind real time

  // Data stash for reverse morph (chart → flat line when data disappears)
  const lastDataRef = useRef<LivelinePoint[]>([])
  const lastMultiSeriesRef = useRef<Array<{ id: string; data: LivelinePoint[]; value: number; palette: LivelinePalette; label?: string }>>([])
  const frozenNowRef = useRef(0)

  // Pause data snapshot — freeze visible data when pausing to prevent
  // consumer-side pruning from eroding the left edge of the line
  const pausedDataRef = useRef<LivelinePoint[] | null>(null)
  const pausedMultiDataRef = useRef<Map<string, { data: LivelinePoint[]; value: number }> | null>(null)

  // Loading ↔ empty crossfade
  const loadingAlphaRef = useRef(config.loading ? 1 : 0)

  // --- Candle mode refs (only used when mode='candle') ---
  const displayCandleRef = useRef<CandlePoint | null>(null)
  const liveBirthAlphaRef = useRef(1)
  const liveBullRef = useRef(0.5)
  const lineSmoothCloseRef = useRef(0)
  const lineSmoothInitedRef = useRef(false)
  const closeLineSmoothRef = useRef(0)         // smooth close for dashed line — never resets on candle birth
  const closeLineSmoothInitedRef = useRef(false)
  const lineModeProgRef = useRef(0)
  const lineModeTransRef = useRef({ startMs: 0, from: 0, to: 0 })
  const lineDensityProgRef = useRef(0)
  const lineDensityTransRef = useRef({ startMs: 0, from: 0, to: 0 })
  const lineTickSmoothRef = useRef(0)
  const lineTickSmoothInitedRef = useRef(false)
  const candleWidthTransRef = useRef({
    fromWidth: config.candleWidth ?? 1,
    toWidth: config.candleWidth ?? 1,
    startMs: 0,
    rangeFromMin: 0, rangeFromMax: 0,
    rangeToMin: 0, rangeToMax: 0,
    oldCandles: [] as CandlePoint[],
    oldWidth: config.candleWidth ?? 1,
  })
  const prevCandleDataRef = useRef({ candles: [] as CandlePoint[], width: config.candleWidth ?? 1 })
  const pausedCandlesRef = useRef<CandlePoint[] | null>(null)
  const pausedLiveRef = useRef<CandlePoint | null>(null)
  const pausedLineDataRef = useRef<LivelinePoint[] | null>(null)
  const pausedLineValueRef = useRef<number | null>(null)
  const lastCandlesRef = useRef<CandlePoint[]>([])
  const lastLiveRef = useRef<CandlePoint | null>(null)
  const lastLineDataStashRef = useRef<LivelinePoint[]>([])
  const lastLineValueStashRef = useRef<number | undefined>(undefined)

  // Create badge DOM elements (once, appended to container)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const el = document.createElement('div')
    el.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;will-change:transform;display:none;z-index:1;'

    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.style.cssText = 'position:absolute;top:0;left:0;'

    const path = document.createElementNS(SVG_NS, 'path')
    svg.appendChild(path)

    const text = document.createElement('span')
    text.style.cssText = 'position:relative;display:block;color:#fff;white-space:nowrap;'

    el.appendChild(svg)
    el.appendChild(text)
    container.appendChild(el)

    badgeRef.current = { container: el, svg, path, text, displayW: 0, targetW: 0 }

    return () => {
      container.removeChild(el)
      badgeRef.current = null
    }
  }, [containerRef])

  // ResizeObserver — update size ref without layout thrashing
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      sizeRef.current = { w: width, h: height }
    })

    ro.observe(container)
    // Init size
    const rect = container.getBoundingClientRect()
    sizeRef.current = { w: rect.width, h: rect.height }

    return () => ro.disconnect()
  }, [containerRef])

  // Mouse + touch events for hover/scrub
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onMove = (e: MouseEvent) => {
      if (!configRef.current.scrub) return
      const rect = container.getBoundingClientRect()
      hoverXRef.current = e.clientX - rect.left
    }
    const onLeave = () => {
      hoverXRef.current = null
      configRef.current.onHover?.(null)
    }

    const onTouchStart = (e: TouchEvent) => {
      if (!configRef.current.scrub) return
      if (e.touches.length !== 1) return
      const rect = container.getBoundingClientRect()
      hoverXRef.current = e.touches[0].clientX - rect.left
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!configRef.current.scrub) return
      if (e.touches.length !== 1) return
      e.preventDefault() // prevent scroll while scrubbing
      const rect = container.getBoundingClientRect()
      hoverXRef.current = e.touches[0].clientX - rect.left
    }
    const onTouchEnd = () => {
      hoverXRef.current = null
      configRef.current.onHover?.(null)
    }

    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    container.addEventListener('touchcancel', onTouchEnd)
    return () => {
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [containerRef])

  // Reduced motion detection
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotionRef.current = mql.matches
    const onChange = (e: MediaQueryListEvent) => { reducedMotionRef.current = e.matches }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // Pause/resume on visibility change (don't spin rAF when tab is hidden)
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && !rafRef.current) {
        rafRef.current = requestAnimationFrame(draw)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- draw is identity-stable (useCallback dep is a ref)
  }, [])

  // rAF draw loop
  const draw = useCallback(() => {
    if (document.hidden) {
      rafRef.current = 0
      return  // stop the loop; visibilitychange listener will restart it
    }

    const canvas = canvasRef.current
    const { w, h } = sizeRef.current
    if (!canvas || w === 0 || h === 0) {
      rafRef.current = requestAnimationFrame(draw)
      return
    }

    const cfg = configRef.current
    const dpr = getDpr()

    // Delta time for frame-rate-independent lerps
    const now_ms = performance.now()
    const dt = lastFrameRef.current ? Math.min(now_ms - lastFrameRef.current, MAX_DELTA_MS) : 16.67
    lastFrameRef.current = now_ms

    // Resize canvas if needed
    const targetW = Math.round(w * dpr)
    const targetH = Math.round(h * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }

    let ctx = ctxRef.current
    if (!ctx || ctx.canvas !== canvas) {
      ctx = canvas.getContext('2d')
      ctxRef.current = ctx
    }
    if (!ctx) {
      rafRef.current = requestAnimationFrame(draw)
      return
    }

    applyDpr(ctx, dpr, w, h)

    // Reduced motion: use speed=1 to skip all lerps (instant snap)
    const noMotion = reducedMotionRef.current

    // --- Mode-specific pause data snapshot ---
    const isCandle = cfg.mode === 'candle'

    if (isCandle) {
      if (cfg.paused && pausedCandlesRef.current === null && (cfg.candles?.length ?? 0) > 0) {
        pausedCandlesRef.current = cfg.candles!.slice()
        pausedLiveRef.current = cfg.liveCandle ?? null
        pausedLineDataRef.current = cfg.lineData?.slice() ?? null
        pausedLineValueRef.current = cfg.lineValue ?? null
      }
      if (!cfg.paused) {
        pausedCandlesRef.current = null
        pausedLiveRef.current = null
        pausedLineDataRef.current = null
        pausedLineValueRef.current = null
      }
    } else if (cfg.isMultiSeries && cfg.multiSeries) {
      if (cfg.paused && pausedMultiDataRef.current === null) {
        const snap = new Map<string, { data: LivelinePoint[]; value: number }>()
        for (const s of cfg.multiSeries) {
          if (s.data.length >= 2) snap.set(s.id, { data: s.data.slice(), value: s.value })
        }
        if (snap.size > 0) pausedMultiDataRef.current = snap
      }
      if (!cfg.paused) {
        pausedMultiDataRef.current = null
      }
    } else {
      if (cfg.paused && pausedDataRef.current === null && cfg.data.length >= 2) {
        pausedDataRef.current = cfg.data.slice()
      }
      if (!cfg.paused) {
        pausedDataRef.current = null
      }
    }

    const points = isCandle ? ([] as LivelinePoint[]) : (pausedDataRef.current ?? cfg.data)
    const effectiveCandles = isCandle ? (pausedCandlesRef.current ?? (cfg.candles ?? [])) : ([] as CandlePoint[])
    const hasMultiData = cfg.isMultiSeries && cfg.multiSeries ? cfg.multiSeries.some(s => s.data.length >= 2) : false
    const hasData = isCandle ? effectiveCandles.length >= 2 : (hasMultiData || points.length >= 2)
    const pad = cfg.padding
    const chartH = h - pad.top - pad.bottom

    // --- Pause time management ---
    const pauseTarget = cfg.paused ? 1 : 0
    pauseProgressRef.current = noMotion
      ? pauseTarget
      : lerp(pauseProgressRef.current, pauseTarget, PAUSE_PROGRESS_SPEED, dt)
    if (pauseProgressRef.current < 0.005) pauseProgressRef.current = 0
    if (pauseProgressRef.current > 0.995) pauseProgressRef.current = 1
    const pauseProgress = pauseProgressRef.current
    const pausedDt = dt * (1 - pauseProgress)

    const realDtSec = dt / 1000
    timeDebtRef.current += realDtSec * pauseProgress
    // Only drain time debt when unpausing — during pausing, let it
    // accumulate freely so the chart decelerates smoothly
    if (!cfg.paused && timeDebtRef.current > 0.001) {
      const catchUpSpeed = timeDebtRef.current > 10
        ? PAUSE_CATCHUP_SPEED_FAST
        : PAUSE_CATCHUP_SPEED
      timeDebtRef.current = lerp(timeDebtRef.current, 0, catchUpSpeed, dt)
      if (timeDebtRef.current < 0.01) timeDebtRef.current = 0
    }

    // --- Loading alpha (loading ↔ empty crossfade) ---
    const loadingTarget = cfg.loading ? 1 : 0
    loadingAlphaRef.current = noMotion
      ? loadingTarget
      : lerp(loadingAlphaRef.current, loadingTarget, LOADING_ALPHA_SPEED, dt)
    if (loadingAlphaRef.current < 0.01) loadingAlphaRef.current = 0
    if (loadingAlphaRef.current > 0.99) loadingAlphaRef.current = 1
    const loadingAlpha = loadingAlphaRef.current

    // --- Chart reveal (loading/empty → data morph) ---
    const revealTarget = (!cfg.loading && hasData) ? 1 : 0
    chartRevealRef.current = noMotion
      ? revealTarget
      : lerp(chartRevealRef.current, revealTarget,
          revealTarget === 1 ? CHART_REVEAL_SPEED_FWD : CHART_REVEAL_SPEED, dt)
    if (Math.abs(chartRevealRef.current - revealTarget) < 0.005) {
      chartRevealRef.current = revealTarget
    }
    const chartReveal = chartRevealRef.current

    // Reset range when reveal fully collapses — guarantees a fresh snap
    // (not a slow lerp from stale values) when data reappears.
    if (chartReveal < 0.01) {
      rangeInitedRef.current = false
    }

    // Data stash for reverse morph — keep drawing chart while it morphs back
    // to the squiggly shape (identical to loading/empty line at reveal=0)
    let useStash: boolean
    let useMultiStash = false
    if (isCandle) {
      useStash = !hasData && chartReveal > 0.005 && lastCandlesRef.current.length > 0
      // Candle stash updated inside candle pipeline after computing visible
    } else {
      // Multi-series stash
      useMultiStash = !hasData && chartReveal > 0.005 && lastMultiSeriesRef.current.length > 0
      if (hasMultiData && cfg.multiSeries) {
        lastMultiSeriesRef.current = cfg.multiSeries.map(s => ({
          id: s.id, data: s.data.slice(), value: s.value, palette: s.palette, label: s.label,
        }))
      }
      // Clear multi stash when single-series data arrives
      if (hasData && !cfg.isMultiSeries) lastMultiSeriesRef.current = []

      useStash = !useMultiStash && !hasData && chartReveal > 0.005 && lastDataRef.current.length >= 2
      if (hasData && !cfg.isMultiSeries) lastDataRef.current = points
    }

    // Update lineModeProg even during early return — prevents the
    // transition from freezing when the user toggles lineMode while
    // in loading or empty state. Without this, lineModeProg stays at
    // its pre-loading value and causes an accent-colored line flash
    // when data arrives (BUG #3).
    if (isCandle) {
      const lmt = lineModeTransRef.current
      const lineModeTarget = cfg.lineMode ? 1 : 0
      if (lmt.to !== lineModeTarget) {
        lmt.from = lineModeProgRef.current
        lmt.to = lineModeTarget
        lmt.startMs = now_ms
      }
      if (lmt.startMs > 0) {
        const elapsed = now_ms - lmt.startMs
        const t = Math.min(elapsed / LINE_MORPH_MS, 1)
        lineModeProgRef.current = lmt.from + (lmt.to - lmt.from) * ((1 - Math.cos(t * Math.PI)) / 2)
        if (t >= 1) { lineModeProgRef.current = lmt.to; lmt.startMs = 0 }
      } else {
        lineModeProgRef.current = lmt.to
      }
    }

    if (!hasData && !useStash && !useMultiStash) {
      // No chart pipeline — draw loading or empty as the sole visual.
      // Grey loading line for candle mode and multi-series (no single accent color)
      const loadingColor = (isCandle || cfg.isMultiSeries || lastMultiSeriesRef.current.length > 0)
        ? cfg.palette.gridLabel
        : undefined
      if (loadingAlpha > 0.01) {
        drawLoading(ctx, w, h, pad, cfg.palette, now_ms, loadingAlpha, loadingColor)
      }
      if ((1 - loadingAlpha) > 0.01) {
        drawEmpty(ctx, w, h, pad, cfg.palette, 1 - loadingAlpha, now_ms, false, cfg.emptyText)
      }
      // Left-edge fade
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      const fadeGrad = ctx.createLinearGradient(pad.left, 0, pad.left + FADE_EDGE_WIDTH, 0)
      fadeGrad.addColorStop(0, 'rgba(0, 0, 0, 1)')
      fadeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = fadeGrad
      ctx.fillRect(0, 0, pad.left + FADE_EDGE_WIDTH, h)
      ctx.restore()

      if (badgeRef.current) badgeRef.current.container.style.display = 'none'
      rafRef.current = requestAnimationFrame(draw)
      return
    }

    if (isCandle) {
      // ═══════════════════════════════════════════════════════
      // CANDLE MODE PIPELINE
      // ═══════════════════════════════════════════════════════

      // Frozen now — prevent candles from scrolling during reverse morph
      if (hasData) frozenNowRef.current = Date.now() / 1000 - timeDebtRef.current
      const now = (hasData || chartReveal < 0.005)
        ? Date.now() / 1000 - timeDebtRef.current
        : frozenNowRef.current
      const rawLive = pausedCandlesRef.current ? (pausedLiveRef.current ?? undefined) : cfg.liveCandle
      let effectiveLineData = pausedLineDataRef.current ?? cfg.lineData
      let effectiveLineValue = pausedLineValueRef.current ?? cfg.lineValue
      // Stash tick data for reverse morph — keeps tick resolution during morphback
      if (hasData && effectiveLineData && effectiveLineData.length > 0) {
        lastLineDataStashRef.current = effectiveLineData
        lastLineValueStashRef.current = effectiveLineValue
      }
      if (useStash && lastLineDataStashRef.current.length > 0) {
        effectiveLineData = lastLineDataStashRef.current
        effectiveLineValue = lastLineValueStashRef.current
      }
      const candleWidthSecs = cfg.candleWidth ?? 1

      // --- Candle width morph transition ---
      const cwt = candleWidthTransRef.current
      let morphT = -1
      let displayCandleWidth: number
      if (cwt.startMs > 0) {
        const elapsed = now_ms - cwt.startMs
        const t = Math.min(elapsed / CANDLE_WIDTH_TRANS_MS, 1)
        morphT = (1 - Math.cos(t * Math.PI)) / 2
        displayCandleWidth = Math.exp(
          Math.log(cwt.fromWidth) + (Math.log(cwt.toWidth) - Math.log(cwt.fromWidth)) * morphT,
        )
        if (t >= 1) { displayCandleWidth = cwt.toWidth; cwt.startMs = 0; morphT = -1 }
      } else {
        displayCandleWidth = cwt.toWidth
      }
      if (candleWidthSecs !== cwt.toWidth) {
        cwt.oldCandles = prevCandleDataRef.current.candles
        cwt.oldWidth = prevCandleDataRef.current.width
        cwt.fromWidth = displayCandleWidth
        cwt.toWidth = candleWidthSecs
        cwt.startMs = now_ms
        morphT = 0
        cwt.rangeFromMin = displayMinRef.current
        cwt.rangeFromMax = displayMaxRef.current
        const curWindow = displayWindowRef.current
        const re = now + curWindow * CANDLE_BUFFER
        const le = re - curWindow
        const targetVis: CandlePoint[] = []
        for (const c of effectiveCandles) {
          if (c.time + candleWidthSecs >= le && c.time <= re) targetVis.push(c)
        }
        if (rawLive) targetVis.push(rawLive)
        if (targetVis.length > 0) {
          const tr = computeCandleRange(targetVis)
          cwt.rangeToMin = tr.min
          cwt.rangeToMax = tr.max
        } else {
          cwt.rangeToMin = displayMinRef.current
          cwt.rangeToMax = displayMaxRef.current
        }
      }
      prevCandleDataRef.current = { candles: cfg.candles ?? [], width: candleWidthSecs }

      // lineModeProg is updated before the early return (see above).
      const lineModeProg = lineModeProgRef.current

      // --- Line density transition ---
      const ldt = lineDensityTransRef.current
      const hasTickData = effectiveLineData && effectiveLineData.length > 0
      const densityTarget = (cfg.lineMode && lineModeProg >= 0.3 && hasTickData) ? 1 : 0
      if (ldt.to !== densityTarget) {
        ldt.from = lineDensityProgRef.current
        ldt.to = densityTarget
        ldt.startMs = now_ms
      }
      let lineDensityProg: number
      if (ldt.startMs > 0) {
        const elapsed = now_ms - ldt.startMs
        const t = Math.min(elapsed / LINE_DENSITY_MS, 1)
        lineDensityProg = ldt.from + (ldt.to - ldt.from) * (1 - (1 - t) * (1 - t))
        if (t >= 1) { lineDensityProg = ldt.to; ldt.startMs = 0 }
      } else {
        lineDensityProg = ldt.to
      }
      lineDensityProgRef.current = lineDensityProg

      // --- Window transition ---
      const transition = windowTransitionRef.current
      const windowResult = updateCandleWindowTransition(
        cfg.windowSecs, transition, displayWindowRef.current,
        displayMinRef.current, displayMaxRef.current,
        now_ms, now, effectiveCandles, rawLive, candleWidthSecs, CANDLE_BUFFER,
      )
      displayWindowRef.current = windowResult.windowSecs
      const windowSecs = windowResult.windowSecs
      const windowTransProgress = windowResult.windowTransProgress
      const isWindowTransitioning = transition.startMs > 0

      const rightEdge = now + windowSecs * CANDLE_BUFFER
      const leftEdge = rightEdge - windowSecs

      // --- Live candle OHLC lerp ---
      let smoothLive: CandlePoint | undefined
      if (rawLive) {
        const prev = displayCandleRef.current
        if (!prev || prev.time !== rawLive.time) {
          displayCandleRef.current = {
            time: rawLive.time, open: rawLive.open,
            high: rawLive.open, low: rawLive.open, close: rawLive.open,
          }
          liveBirthAlphaRef.current = 0
        } else {
          const dc = displayCandleRef.current!
          dc.open = lerp(dc.open, rawLive.open, CANDLE_LERP_SPEED, pausedDt)
          dc.high = lerp(dc.high, rawLive.high, CANDLE_LERP_SPEED, pausedDt)
          dc.low = lerp(dc.low, rawLive.low, CANDLE_LERP_SPEED, pausedDt)
          dc.close = lerp(dc.close, rawLive.close, CANDLE_LERP_SPEED, pausedDt)
        }
        liveBirthAlphaRef.current = lerp(liveBirthAlphaRef.current, 1, 0.2, pausedDt)
        if (liveBirthAlphaRef.current > 0.99) liveBirthAlphaRef.current = 1
        const dc = displayCandleRef.current!
        const bullTarget = dc.close >= dc.open ? 1 : 0
        liveBullRef.current = lerp(liveBullRef.current, bullTarget, 0.12, pausedDt)
        if (liveBullRef.current > 0.99) liveBullRef.current = 1
        if (liveBullRef.current < 0.01) liveBullRef.current = 0
        smoothLive = dc
      } else {
        displayCandleRef.current = null
        liveBirthAlphaRef.current = 1
        liveBullRef.current = 0.5
      }

      // --- Smooth close for dashed price line ---
      // Tracks rawLive.close at candle-body speed but never resets on candle
      // birth, so the dashed line doesn't jump when a new candle starts.
      if (rawLive) {
        if (!closeLineSmoothInitedRef.current) {
          closeLineSmoothRef.current = rawLive.close
          closeLineSmoothInitedRef.current = true
        } else {
          closeLineSmoothRef.current = lerp(closeLineSmoothRef.current, rawLive.close, CLOSE_LINE_LERP_SPEED, pausedDt)
          const gap = Math.abs(closeLineSmoothRef.current - rawLive.close)
          const range = displayMaxRef.current - displayMinRef.current || 1
          if (gap < range * 0.0005) closeLineSmoothRef.current = rawLive.close
        }
      } else if (!useStash) {
        closeLineSmoothInitedRef.current = false
      }

      // --- Smooth close for line mode ---
      if (rawLive) {
        if (!lineSmoothInitedRef.current) {
          lineSmoothCloseRef.current = rawLive.close
          lineSmoothInitedRef.current = true
        } else {
          const valGap = Math.abs(rawLive.close - lineSmoothCloseRef.current)
          const prevRange = displayMaxRef.current - displayMinRef.current || 1
          const gapRatio = Math.min(valGap / prevRange, 1)
          const adaptiveSpeed = LINE_LERP_BASE + (1 - gapRatio) * LINE_ADAPTIVE_BOOST
          lineSmoothCloseRef.current = lerp(lineSmoothCloseRef.current, rawLive.close, adaptiveSpeed, pausedDt)
          if (valGap < prevRange * LINE_SNAP_THRESHOLD) lineSmoothCloseRef.current = rawLive.close
        }
      } else if (!useStash) {
        // Only reset when not using stash — during reverse morph,
        // freeze the smooth value (matches line mode's displayValueRef freeze)
        lineSmoothInitedRef.current = false
      }

      // --- Smooth tick value for density transition ---
      if (effectiveLineValue !== undefined && hasTickData) {
        if (!lineTickSmoothInitedRef.current) {
          lineTickSmoothRef.current = effectiveLineValue
          lineTickSmoothInitedRef.current = true
        } else {
          const valGap = Math.abs(effectiveLineValue - lineTickSmoothRef.current)
          const prevRange = displayMaxRef.current - displayMinRef.current || 1
          const gapRatio = Math.min(valGap / prevRange, 1)
          const adaptiveSpeed = LINE_LERP_BASE + (1 - gapRatio) * LINE_ADAPTIVE_BOOST
          lineTickSmoothRef.current = lerp(lineTickSmoothRef.current, effectiveLineValue, adaptiveSpeed, pausedDt)
          if (valGap < prevRange * LINE_SNAP_THRESHOLD) lineTickSmoothRef.current = effectiveLineValue
        }
      } else if (!useStash) {
        lineTickSmoothInitedRef.current = false
      }

      // --- Build visible candles ---
      const visible: CandlePoint[] = []
      for (const c of effectiveCandles) {
        if (c.time + candleWidthSecs >= leftEdge && c.time <= rightEdge) visible.push(c)
      }
      if (smoothLive && smoothLive.time + displayCandleWidth >= leftEdge && smoothLive.time <= rightEdge) {
        visible.push(smoothLive)
      }
      let oldVisible: CandlePoint[] = []
      if (morphT >= 0 && cwt.oldCandles.length > 0) {
        for (const c of cwt.oldCandles) {
          if (c.time + cwt.oldWidth >= leftEdge && c.time <= rightEdge) oldVisible.push(c)
        }
      }

      // Stash visible candles for reverse morph
      if (hasData) {
        lastCandlesRef.current = visible
        lastLiveRef.current = smoothLive ?? null
      }
      const effectiveVisible = useStash ? lastCandlesRef.current : visible
      const effectiveLive = useStash ? (lastLiveRef.current ?? undefined) : smoothLive

      // --- Range computation ---
      // Always use full OHLC range regardless of line mode progress.
      // The close-only and tick-level ranges are tighter (no wicks),
      // so blending between them during morphs shifts the Y axis and
      // causes visible grid label drift + line position jumps.
      // Using one consistent OHLC range means zero range change during
      // the morph — the line gets slightly more Y margin in line mode
      // (room for wicks it doesn't use) but that's an acceptable trade-off.
      const chartW = w - pad.left - pad.right
      const computed = effectiveVisible.length > 0
        ? computeCandleRange(effectiveVisible)
        : { min: displayMinRef.current, max: displayMaxRef.current }

      const rangeResult = updateCandleRange(
        computed, rangeInitedRef.current,
        displayMinRef.current, displayMaxRef.current,
        isWindowTransitioning, windowTransProgress, transition,
        chartH, pausedDt,
      )
      if (morphT >= 0) {
        rangeResult.displayMin = cwt.rangeFromMin + (cwt.rangeToMin - cwt.rangeFromMin) * morphT
        rangeResult.displayMax = cwt.rangeFromMax + (cwt.rangeToMax - cwt.rangeFromMax) * morphT
        rangeResult.minVal = rangeResult.displayMin
        rangeResult.maxVal = rangeResult.displayMax
        rangeResult.valRange = (rangeResult.displayMax - rangeResult.displayMin) || 0.001
      }
      rangeInitedRef.current = rangeResult.rangeInited
      displayMinRef.current = rangeResult.displayMin
      displayMaxRef.current = rangeResult.displayMax
      const { minVal, maxVal, valRange } = rangeResult

      const layout: ChartLayout = {
        w, h, pad,
        chartW, chartH,
        leftEdge, rightEdge,
        minVal, maxVal, valRange,
        toX: (t: number) => pad.left + ((t - leftEdge) / (rightEdge - leftEdge)) * chartW,
        toY: (v: number) => pad.top + (1 - (v - minVal) / valRange) * chartH,
      }

      // --- Hover + scrub ---
      const hoverPx = hoverXRef.current
      let hoveredCandle: CandlePoint | null = null
      let isActiveHover = false
      if (hoverPx !== null && hoverPx >= pad.left && hoverPx <= w - pad.right) {
        hoveredCandle = candleAtX(effectiveVisible, hoverPx, displayCandleWidth, layout)
        if (hoveredCandle) isActiveHover = true
      }
      const scrubTarget = isActiveHover ? 1 : 0
      scrubAmountRef.current = lerp(scrubAmountRef.current, scrubTarget, 0.12, dt)
      if (scrubAmountRef.current < 0.01) scrubAmountRef.current = 0
      if (scrubAmountRef.current > 0.99) scrubAmountRef.current = 1
      const scrubAmount = scrubAmountRef.current

      let drawHoverX = hoverPx
      let drawHoverTime = 0
      let drawHoverCandle: CandlePoint | null = hoveredCandle
      if (!isActiveHover && scrubAmount > 0 && lastHoverRef.current) {
        drawHoverX = lastHoverRef.current.x
        drawHoverTime = lastHoverRef.current.time
        drawHoverCandle = candleAtX(effectiveVisible, lastHoverRef.current.x, displayCandleWidth, layout)
      } else if (isActiveHover && hoverPx !== null) {
        drawHoverTime = layout.leftEdge + ((hoverPx - pad.left) / chartW) * (layout.rightEdge - layout.leftEdge)
        lastHoverRef.current = { x: hoverPx, value: hoveredCandle?.close ?? 0, time: drawHoverTime }
      }

      let drawCandles = effectiveVisible
      let drawOldCandles = oldVisible
      let drawLive = effectiveLive

      // Line mode: blend live close toward smooth close
      if (lineModeProg > 0.01 && drawLive && lineSmoothInitedRef.current) {
        const blended = drawLive.close + (lineSmoothCloseRef.current - drawLive.close) * lineModeProg
        drawLive = { ...drawLive, close: blended }
        const li = drawCandles.length - 1
        if (li >= 0 && drawCandles[li].time === drawLive.time) {
          drawCandles = drawCandles.slice()
          drawCandles[li] = { ...drawCandles[li], close: blended }
        }
      }

      // Line mode OHLC collapse
      if (lineModeProg > 0.01 && lineModeProg < 0.99) {
        const collapseOHLC = (c: CandlePoint): CandlePoint => {
          const inv = 1 - lineModeProg
          return {
            time: c.time,
            open: c.close + (c.open - c.close) * inv,
            high: c.close + (c.high - c.close) * inv,
            low: c.close + (c.low - c.close) * inv,
            close: c.close,
          }
        }
        drawCandles = drawCandles.map(collapseOHLC)
        if (drawOldCandles.length > 0) drawOldCandles = drawOldCandles.map(collapseOHLC)
        if (drawLive) drawLive = collapseOHLC(drawLive)
      }

      // Build lineVisible for drawLine — value-space points that drawLine
      // converts to screen coords with its own morphY/alpha/color logic.
      // Use tick-level resolution whenever the line is visible (lineModeProg > 0.05),
      // not just when lineDensityProg > 0.01.  The density transition finishes
      // 150ms before the line fades out; without this, lineVisible abruptly drops
      // from ~300 smooth points to ~5 stepped candle-close points while the line
      // is still at ~30% opacity, causing a visible shape jump.
      let lineVisible: LivelinePoint[]
      let lineSmoothValue: number
      if (effectiveLineData && effectiveLineData.length > 0
        && (lineDensityProg > 0.01 || lineModeProg > 0.05)) {
        // Density transition: blend candle-close values toward tick values
        const closeRefs: { t: number; v: number }[] = []
        for (const c of drawCandles) {
          closeRefs.push({ t: c.time + displayCandleWidth / 2, v: c.close })
        }
        if (drawLive) closeRefs.push({ t: now, v: drawLive.close })

        lineVisible = []
        let refIdx = 0
        for (const pt of effectiveLineData) {
          if (pt.time < leftEdge || pt.time > rightEdge) continue
          while (refIdx < closeRefs.length - 2 && closeRefs[refIdx + 1].t < pt.time) refIdx++
          let interpClose: number
          if (closeRefs.length === 0) {
            interpClose = pt.value
          } else if (closeRefs.length === 1 || pt.time <= closeRefs[0].t) {
            interpClose = closeRefs[0].v
          } else if (refIdx >= closeRefs.length - 1) {
            interpClose = closeRefs[closeRefs.length - 1].v
          } else {
            const a = closeRefs[refIdx]
            const b = closeRefs[refIdx + 1]
            const span = b.t - a.t
            const frac = span > 0 ? Math.max(0, Math.min(1, (pt.time - a.t) / span)) : 0
            interpClose = a.v + (b.v - a.v) * frac
          }
          const blended = interpClose + (pt.value - interpClose) * lineDensityProg
          lineVisible.push({ time: pt.time, value: blended })
        }

        const smoothTick = lineTickSmoothInitedRef.current
          ? lineTickSmoothRef.current
          : (effectiveLineValue ?? effectiveLineData[effectiveLineData.length - 1].value)
        // No explicit live tip — drawLine appends one at toX(now) using lineSmoothValue
        lineSmoothValue = lineSmoothCloseRef.current
          + (smoothTick - lineSmoothCloseRef.current) * lineDensityProg
      } else {
        // Candle-close resolution — no live tip; drawLine appends one at toX(now)
        lineVisible = drawCandles.map(c => ({
          time: c.time + displayCandleWidth / 2,
          value: c.close,
        }))
        lineSmoothValue = lineSmoothInitedRef.current
          ? lineSmoothCloseRef.current
          : (drawLive?.close ?? drawCandles[drawCandles.length - 1]?.close ?? 0)
      }

      // Pad lineVisible to span full chart width during reveal morph.
      // Without this, data that doesn't fill the window creates a partial-width
      // line that pops when it hands off to the full-width loading squiggly.
      if (chartReveal < 1 && lineVisible.length >= 2) {
        const firstTime = lineVisible[0].time
        const windowSpan = rightEdge - leftEdge
        if (firstTime - leftEdge > windowSpan * 0.05) {
          const firstVal = lineVisible[0].value
          const step = windowSpan / 32
          const padded: LivelinePoint[] = []
          for (let t = leftEdge; t < firstTime - step * 0.5; t += step) {
            padded.push({ time: t, value: firstVal })
          }
          lineVisible = [...padded, ...lineVisible]
        }
      }

      // --- Draw ---
      drawCandleFrame(ctx, layout, cfg.palette, {
        candles: drawCandles,
        displayCandleWidth,
        oldCandles: drawOldCandles,
        oldWidth: cwt.oldWidth,
        morphT,
        liveCandle: drawLive,
        closePriceCandle: closeLineSmoothInitedRef.current && rawLive
          ? { ...rawLive, close: closeLineSmoothRef.current }
          : rawLive,
        liveTime: effectiveLive?.time ?? -1,
        liveBirthAlpha: liveBirthAlphaRef.current,
        liveBullBlend: liveBullRef.current,
        lineModeProg,
        chartReveal,
        now_ms,
        now,
        pauseProgress,
        showGrid: cfg.showGrid,
        scrubAmount,
        hoverX: drawHoverX,
        hoverValue: drawHoverCandle?.close ?? null,
        hoverTime: drawHoverTime,
        hoveredCandle: drawHoverCandle,
        formatValue: cfg.formatValue,
        formatTime: cfg.formatTime,
        gridState: gridStateRef.current,
        timeAxisState: timeAxisStateRef.current,
        dt: pausedDt,
        targetWindowSecs: cfg.windowSecs,
        tooltipY: cfg.tooltipY,
        tooltipOutline: cfg.tooltipOutline,
        lineVisible,
        lineSmoothValue,
        emptyText: cfg.emptyText,
        loadingAlpha,
        // Show empty overlay when not loading AND loadingAlpha has fully
        // decayed. This prevents the gradient gap from flashing during
        // loading→live (where loadingAlpha starts at ~1), while still
        // allowing smooth fade-out during empty→live (loadingAlpha is 0).
        showEmptyOverlay: !(cfg.loading ?? false) && loadingAlpha < 0.01,
      })

      // Badge in candle mode — only when in line mode (lineModeProg > 0.5)
      if (badgeRef.current) {
        if (lineModeProg > 0.5 && cfg.showBadge) {
          const momentum = detectMomentum(lineVisible)
          badgeYRef.current = updateBadgeDOM(
            badgeRef.current, cfg, lineSmoothValue, layout, momentum,
            badgeYRef.current, badgeColorRef.current,
            isWindowTransitioning, noMotion, ctx, pausedDt,
            chartReveal,
          )
          // Fade badge in/out with lineModeProg (0.5→1 maps to 0→1)
          const badgeFade = (lineModeProg - 0.5) * 2
          if (badgeRef.current.container.style.display !== 'none') {
            const base = badgeRef.current.container.style.opacity
              ? parseFloat(badgeRef.current.container.style.opacity) : 1
            badgeRef.current.container.style.opacity = String(
              base * badgeFade * (1 - pauseProgress),
            )
          }
        } else {
          badgeRef.current.container.style.display = 'none'
        }
      }

    } else if ((cfg.isMultiSeries && cfg.multiSeries && cfg.multiSeries.length > 0) || useMultiStash) {
    // ═══════════════════════════════════════════════════════
    // MULTI-SERIES LINE MODE PIPELINE
    // ═══════════════════════════════════════════════════════

    const effectiveMultiSeries = useMultiStash ? lastMultiSeriesRef.current : cfg.multiSeries!

    // Reserve just enough right-side space so endpoint labels don't overlap
    // grid value text (which starts at w - pad.right + 8). Labels are drawn
    // at lineEnd + 6, so overlap = labelW + 6 - 8 = labelW - 2.
    // Scale with chartReveal so layout doesn't shift during loading collapse.
    let labelReserve = 0
    if (effectiveMultiSeries.some(s => s.label)) {
      ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
      let maxLabelW = 0
      for (const s of effectiveMultiSeries) {
        if (s.label) {
          const lw = ctx.measureText(s.label).width
          if (lw > maxLabelW) maxLabelW = lw
        }
      }
      labelReserve = Math.max(0, maxLabelW - 2) * chartReveal
    }

    const chartW = w - pad.left - pad.right - labelReserve
    const buffer = WINDOW_BUFFER

    // Clean stale entries from displayValuesRef (series that were removed)
    if (!useMultiStash) {
      const currentIds = new Set(effectiveMultiSeries.map(s => s.id))
      for (const key of displayValuesRef.current.keys()) {
        if (!currentIds.has(key)) displayValuesRef.current.delete(key)
      }
    }

    // Use first series data for window transition seeding
    const firstSeries = effectiveMultiSeries[0]
    const transition = windowTransitionRef.current
    if (hasData) frozenNowRef.current = Date.now() / 1000 - timeDebtRef.current
    const now = useMultiStash ? frozenNowRef.current : Date.now() / 1000 - timeDebtRef.current

    // Per-series smooth values (freeze when using stash)
    const smoothValues = new Map<string, number>()
    for (const s of effectiveMultiSeries) {
      let dv = displayValuesRef.current.get(s.id)
      if (dv === undefined) dv = s.value
      if (!useMultiStash) {
        const adaptiveSpeed = computeAdaptiveSpeed(
          s.value, dv,
          displayMinRef.current, displayMaxRef.current,
          cfg.lerpSpeed, noMotion,
        )
        dv = lerp(dv, s.value, adaptiveSpeed, pausedDt)
        const prevRange = displayMaxRef.current - displayMinRef.current || 1
        if (Math.abs(dv - s.value) < prevRange * VALUE_SNAP_THRESHOLD) dv = s.value
        displayValuesRef.current.set(s.id, dv)
      }
      smoothValues.set(s.id, dv)
    }

    // Per-series visibility alpha (lerp toward 0 for hidden, 1 for visible)
    const hiddenIds = cfg.hiddenSeriesIds
    const seriesAlphas = seriesAlphaRef.current
    for (const s of effectiveMultiSeries) {
      let alpha = seriesAlphas.get(s.id) ?? 1
      const target = hiddenIds?.has(s.id) ? 0 : 1
      alpha = noMotion ? target : lerp(alpha, target, SERIES_TOGGLE_SPEED, pausedDt)
      if (alpha < 0.01) alpha = 0
      if (alpha > 0.99) alpha = 1
      seriesAlphas.set(s.id, alpha)
    }

    // Window transition — seed with all series data for accurate range
    const firstData = pausedMultiDataRef.current?.get(firstSeries.id)?.data ?? firstSeries.data
    const windowResult = updateWindowTransition(
      cfg, transition, displayWindowRef.current,
      displayMinRef.current, displayMaxRef.current,
      noMotion, now_ms, now, firstData, smoothValues.get(firstSeries.id) ?? firstSeries.value, buffer,
    )
    // Override range target with union of ALL series (not just first)
    if (transition.startMs > 0 && effectiveMultiSeries.length > 1) {
      const targetRightEdge = now + cfg.windowSecs * buffer
      const targetLeftEdge = targetRightEdge - cfg.windowSecs
      let unionMin = Infinity
      let unionMax = -Infinity
      for (const s of effectiveMultiSeries) {
        const sData = pausedMultiDataRef.current?.get(s.id)?.data ?? s.data
        const sv = smoothValues.get(s.id) ?? s.value
        const targetVisible: LivelinePoint[] = []
        for (const p of sData) {
          if (p.time >= targetLeftEdge - 2 && p.time <= targetRightEdge) targetVisible.push(p)
        }
        if (targetVisible.length > 0) {
          const range = computeRange(targetVisible, sv, cfg.referenceLine?.value, cfg.exaggerate)
          if (range.min < unionMin) unionMin = range.min
          if (range.max > unionMax) unionMax = range.max
        }
      }
      if (isFinite(unionMin) && isFinite(unionMax)) {
        transition.rangeToMin = unionMin
        transition.rangeToMax = unionMax
      }
    }
    displayWindowRef.current = windowResult.windowSecs
    const windowSecs = windowResult.windowSecs
    const windowTransProgress = windowResult.windowTransProgress
    const isWindowTransitioning = transition.startMs > 0

    const rightEdge = now + windowSecs * buffer
    const leftEdge = rightEdge - windowSecs
    const filterRight = rightEdge - (rightEdge - now) * pauseProgress

    // Build per-series visible arrays and compute global range
    // Use paused snapshots when available to prevent left-edge erosion
    // Exclude hidden series (alpha < 0.01) from range so Y-axis adjusts
    const seriesEntries: MultiSeriesEntry[] = []
    let globalMin = Infinity
    let globalMax = -Infinity
    for (const s of effectiveMultiSeries) {
      const snap = pausedMultiDataRef.current?.get(s.id)
      const seriesData = snap?.data ?? s.data
      const visible: LivelinePoint[] = []
      for (const p of seriesData) {
        if (p.time >= leftEdge - 2 && p.time <= filterRight) visible.push(p)
      }
      const sv = smoothValues.get(s.id) ?? s.value
      const alpha = seriesAlphas.get(s.id) ?? 1
      if (visible.length >= 2) {
        // Only include in range if series is at least partially visible
        if (alpha > 0.01) {
          const range = computeRange(visible, sv, cfg.referenceLine?.value, cfg.exaggerate)
          if (range.min < globalMin) globalMin = range.min
          if (range.max > globalMax) globalMax = range.max
        }
        // Always push to entries (drawMultiFrame skips via alpha)
        seriesEntries.push({ visible, smoothValue: sv, palette: s.palette, label: s.label, alpha })
      }
    }

    if (seriesEntries.length === 0) {
      // No visible data — draw loading/empty fallback (matching single-series behavior)
      // Grey loading line for multi-series (no single accent color to use)
      if (loadingAlpha > 0.01) {
        drawLoading(ctx, w, h, pad, cfg.palette, now_ms, loadingAlpha, cfg.palette.gridLabel)
      }
      if ((1 - loadingAlpha) > 0.01) {
        drawEmpty(ctx, w, h, pad, cfg.palette, 1 - loadingAlpha, now_ms, false, cfg.emptyText)
      }
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      const fadeGrad = ctx.createLinearGradient(pad.left, 0, pad.left + FADE_EDGE_WIDTH, 0)
      fadeGrad.addColorStop(0, 'rgba(0, 0, 0, 1)')
      fadeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = fadeGrad
      ctx.fillRect(0, 0, pad.left + FADE_EDGE_WIDTH, h)
      ctx.restore()
      if (badgeRef.current) badgeRef.current.container.style.display = 'none'
      rafRef.current = requestAnimationFrame(draw)
      return
    }

    // Smooth global range
    const computedRange = { min: isFinite(globalMin) ? globalMin : 0, max: isFinite(globalMax) ? globalMax : 1 }
    const adaptiveSpeed = cfg.lerpSpeed + ADAPTIVE_SPEED_BOOST * 0.5
    const rangeResult = updateRange(
      computedRange, rangeInitedRef.current,
      targetMinRef.current, targetMaxRef.current,
      displayMinRef.current, displayMaxRef.current,
      isWindowTransitioning, windowTransProgress, transition,
      adaptiveSpeed, chartH, pausedDt,
    )
    rangeInitedRef.current = rangeResult.rangeInited
    targetMinRef.current = rangeResult.targetMin
    targetMaxRef.current = rangeResult.targetMax
    displayMinRef.current = rangeResult.displayMin
    displayMaxRef.current = rangeResult.displayMax
    const { minVal, maxVal, valRange } = rangeResult

    const layout: ChartLayout = {
      w, h, pad,
      chartW, chartH,
      leftEdge, rightEdge,
      minVal, maxVal, valRange,
      toX: (t: number) => pad.left + ((t - leftEdge) / (rightEdge - leftEdge)) * chartW,
      toY: (v: number) => pad.top + (1 - (v - minVal) / valRange) * chartH,
    }

    // Hover — interpolate value at hover time for each series
    const hoverPx = hoverXRef.current
    let drawHoverX: number | null = null
    let drawHoverTime: number | null = null
    let isActiveHover = false
    let hoverEntries: { color: string; label: string; value: number }[] = []

    if (hoverPx !== null && hoverPx >= pad.left && hoverPx <= w - pad.right) {
      const maxHoverX = layout.toX(now)
      const clampedX = Math.min(hoverPx, maxHoverX)
      const t = leftEdge + ((clampedX - pad.left) / chartW) * (rightEdge - leftEdge)
      drawHoverX = clampedX
      drawHoverTime = t
      isActiveHover = true

      for (const entry of seriesEntries) {
        // Skip hidden series from crosshair tooltip
        if ((entry.alpha ?? 1) < 0.5) continue
        const v = interpolateAtTime(entry.visible, t)
        if (v !== null) {
          hoverEntries.push({ color: entry.palette.line, label: entry.label ?? '', value: v })
        }
      }
      lastHoverRef.current = { x: clampedX, value: hoverEntries[0]?.value ?? 0, time: t }
      lastHoverEntriesRef.current = hoverEntries
      cfg.onHover?.({ time: t, value: hoverEntries[0]?.value ?? 0, x: clampedX, y: layout.toY(hoverEntries[0]?.value ?? 0) })
    }

    // Scrub amount
    const scrubTarget = isActiveHover ? 1 : 0
    if (noMotion) {
      scrubAmountRef.current = scrubTarget
    } else {
      scrubAmountRef.current += (scrubTarget - scrubAmountRef.current) * SCRUB_LERP_SPEED
      if (scrubAmountRef.current < 0.01) scrubAmountRef.current = 0
      if (scrubAmountRef.current > 0.99) scrubAmountRef.current = 1
    }

    // Fade-out: use last known hover position + cached entries
    if (!isActiveHover && scrubAmountRef.current > 0 && lastHoverRef.current) {
      drawHoverX = lastHoverRef.current.x
      drawHoverTime = lastHoverRef.current.time
      hoverEntries = lastHoverEntriesRef.current
    }

    // Draw multi-series frame
    drawMultiFrame(ctx, layout, {
      series: seriesEntries,
      now,
      showGrid: cfg.showGrid,
      showPulse: cfg.showPulse,
      referenceLine: cfg.referenceLine,
      hoverX: drawHoverX,
      hoverTime: drawHoverTime,
      hoverEntries,
      scrubAmount: scrubAmountRef.current,
      windowSecs,
      formatValue: cfg.formatValue,
      formatTime: cfg.formatTime,
      gridState: gridStateRef.current,
      timeAxisState: timeAxisStateRef.current,
      dt,
      targetWindowSecs: cfg.windowSecs,
      tooltipY: cfg.tooltipY,
      tooltipOutline: cfg.tooltipOutline,
      chartReveal,
      pauseProgress,
      now_ms,
      primaryPalette: cfg.palette,
    })

    // During reverse morph (chart → loading/empty), overlay the empty text
    // as chartReveal drops — identical to single-series behavior
    const bgAlpha = 1 - chartReveal
    if (bgAlpha > 0.01 && revealTarget === 0 && !cfg.loading) {
      const bgEmptyAlpha = (1 - loadingAlpha) * bgAlpha
      if (bgEmptyAlpha > 0.01) {
        drawEmpty(ctx, w, h, pad, cfg.palette, bgEmptyAlpha, now_ms, true, cfg.emptyText)
      }
    }

    // Hide badge in multi-series mode
    if (badgeRef.current) badgeRef.current.container.style.display = 'none'

    } else {
    // ═══════════════════════════════════════════════════════
    // LINE MODE PIPELINE (existing)
    // ═══════════════════════════════════════════════════════

    const effectivePoints = useStash ? lastDataRef.current : points

    // Adaptive speed + smooth value (freeze lerp when using stashed data)
    const adaptiveSpeed = computeAdaptiveSpeed(
      cfg.value, displayValueRef.current,
      displayMinRef.current, displayMaxRef.current,
      cfg.lerpSpeed, noMotion,
    )
    if (!useStash) {
      displayValueRef.current = lerp(displayValueRef.current, cfg.value, adaptiveSpeed, pausedDt)
      // Skip snap when pausing — cfg.value keeps changing from the consumer,
      // so the snap would cause visible jumps in a supposedly frozen chart
      if (pauseProgress < 0.5) {
        const prevRange = displayMaxRef.current - displayMinRef.current || 1
        if (Math.abs(displayValueRef.current - cfg.value) < prevRange * VALUE_SNAP_THRESHOLD) {
          displayValueRef.current = cfg.value
        }
      }
    }
    const smoothValue = displayValueRef.current

    const chartW = w - pad.left - pad.right

    // Dynamic buffer: when momentum arrows + badge are both on, ensure enough
    // gap between the live dot and badge for the arrows to fit.
    // Gap formula: buffer * chartW - 7. Need ~30px for arrows.
    const needsArrowRoom = cfg.showMomentum
    const buffer = needsArrowRoom
      ? Math.max(WINDOW_BUFFER, 37 / Math.max(chartW, 1))
      : WINDOW_BUFFER

    // Window transition
    const transition = windowTransitionRef.current
    if (hasData) frozenNowRef.current = Date.now() / 1000 - timeDebtRef.current
    const now = useStash ? frozenNowRef.current : Date.now() / 1000 - timeDebtRef.current
    const windowResult = updateWindowTransition(
      cfg, transition, displayWindowRef.current,
      displayMinRef.current, displayMaxRef.current,
      noMotion, now_ms, now, effectivePoints, smoothValue, buffer,
    )
    displayWindowRef.current = windowResult.windowSecs
    const windowSecs = windowResult.windowSecs
    const windowTransProgress = windowResult.windowTransProgress

    const rightEdge = now + windowSecs * buffer
    const leftEdge = rightEdge - windowSecs

    // Filter visible points — when pausing, contract right edge to `now`
    // so new data (with real-time timestamps) can't appear past the live dot.
    // While draining time debt (catch-up), also cap at `now` — data from the
    // pause period has real-time timestamps ahead of the chart's lagging `now`,
    // and letting those through would place points past the live tip, breaking
    // the spline's monotone-X assumption and causing the line to loop backward.
    const rawFilterRight = rightEdge - (rightEdge - now) * pauseProgress
    const filterRight = timeDebtRef.current > 0.01 ? Math.min(now, rawFilterRight) : rawFilterRight
    const visible: LivelinePoint[] = []
    for (const p of effectivePoints) {
      if (p.time >= leftEdge - 2 && p.time <= filterRight) {
        visible.push(p)
      }
    }

    if (visible.length < 2) {
      if (badgeRef.current) badgeRef.current.container.style.display = 'none'
      rafRef.current = requestAnimationFrame(draw)
      return
    }

    // Compute + smooth Y range
    const computedRange = computeRange(visible, smoothValue, cfg.referenceLine?.value, cfg.exaggerate)
    const isWindowTransitioning = transition.startMs > 0
    const rangeResult = updateRange(
      computedRange, rangeInitedRef.current,
      targetMinRef.current, targetMaxRef.current,
      displayMinRef.current, displayMaxRef.current,
      isWindowTransitioning, windowTransProgress, transition,
      adaptiveSpeed, chartH, pausedDt,
    )
    rangeInitedRef.current = rangeResult.rangeInited
    targetMinRef.current = rangeResult.targetMin
    targetMaxRef.current = rangeResult.targetMax
    displayMinRef.current = rangeResult.displayMin
    displayMaxRef.current = rangeResult.displayMax
    const { minVal, maxVal, valRange } = rangeResult

    const layout: ChartLayout = {
      w, h, pad,
      chartW, chartH,
      leftEdge, rightEdge,
      minVal, maxVal, valRange,
      toX: (t: number) => pad.left + ((t - leftEdge) / (rightEdge - leftEdge)) * chartW,
      toY: (v: number) => pad.top + (1 - (v - minVal) / valRange) * chartH,
    }

    // Momentum
    const momentum: Momentum = cfg.momentumOverride ?? detectMomentum(visible)

    // Hover + scrub
    const hoverResult = updateHoverState(
      hoverXRef.current, pad, w, layout, now, visible,
      scrubAmountRef.current, lastHoverRef.current,
      cfg, noMotion, leftEdge, rightEdge, chartW, dt,
    )
    scrubAmountRef.current = hoverResult.scrubAmount
    lastHoverRef.current = hoverResult.lastHover
    const { hoverX: drawHoverX, hoverValue: drawHoverValue, hoverTime: drawHoverTime } = hoverResult

    // Compute swing magnitude for particles (recent velocity / visible range)
    const lookback = Math.min(5, visible.length - 1)
    const recentDelta = lookback > 0
      ? Math.abs(visible[visible.length - 1].value - visible[visible.length - 1 - lookback].value)
      : 0
    const swingMagnitude = valRange > 0 ? Math.min(recentDelta / valRange, 1) : 0

    // Draw canvas content (everything except badge)
    drawFrame(ctx, layout, cfg.palette, {
      visible,
      smoothValue,
      now,
      momentum,
      arrowState: arrowStateRef.current,
      showGrid: cfg.showGrid,
      showMomentum: cfg.showMomentum,
      showPulse: cfg.showPulse,
      showFill: cfg.showFill,
      referenceLine: cfg.referenceLine,
      hoverX: drawHoverX,
      hoverValue: drawHoverValue,
      hoverTime: drawHoverTime,
      scrubAmount: scrubAmountRef.current,
      windowSecs,
      formatValue: cfg.formatValue,
      formatTime: cfg.formatTime,
      gridState: gridStateRef.current,
      timeAxisState: timeAxisStateRef.current,
      dt,
      targetWindowSecs: cfg.windowSecs,
      tooltipY: cfg.tooltipY,
      tooltipOutline: cfg.tooltipOutline,
      orderbookData: cfg.orderbookData,
      orderbookState: cfg.orderbookData ? orderbookStateRef.current : undefined,
      particleState: cfg.degenOptions ? particleStateRef.current : undefined,
      particleOptions: cfg.degenOptions,
      swingMagnitude,
      shakeState: cfg.degenOptions ? shakeStateRef.current : undefined,
      chartReveal,
      pauseProgress,
      now_ms,
    })

    // During morph (chart ↔ empty), overlay the gradient gap + text on
    // top of the morphing chart line. skipLine=true avoids double-drawing
    // the squiggly. The gap fades in smoothly as chartReveal drops.
    const bgAlpha = 1 - chartReveal
    if (bgAlpha > 0.01 && revealTarget === 0 && !cfg.loading) {
      const bgEmptyAlpha = (1 - loadingAlpha) * bgAlpha
      if (bgEmptyAlpha > 0.01) {
        drawEmpty(ctx, w, h, pad, cfg.palette, bgEmptyAlpha, now_ms, true, cfg.emptyText)
      }
    }

    // Badge (DOM element, floats above container)
    const badge = badgeRef.current
    if (badge) {
      badgeYRef.current = updateBadgeDOM(
        badge, cfg, smoothValue, layout, momentum,
        badgeYRef.current, badgeColorRef.current,
        isWindowTransitioning, noMotion, ctx, pausedDt,
        chartReveal,
      )
      // Hide badge during pause — fully fades out as pauseProgress → 1
      if (pauseProgress > 0.01 && badge.container.style.display !== 'none') {
        const base = badge.container.style.opacity ? parseFloat(badge.container.style.opacity) : 1
        badge.container.style.opacity = String(base * (1 - pauseProgress))
      }
    }

    // --- Live value display (DOM element, updated by ref — no React re-renders) ---
    const valEl = cfg.valueDisplayRef?.current
    if (valEl) {
      // When momentum colour is on, strip sign — colour already communicates direction
      const displayVal = cfg.valueMomentumColor ? Math.abs(smoothValue) : smoothValue
      valEl.textContent = cfg.formatValue(displayVal)
      if (cfg.valueMomentumColor) {
        const mc = momentum === 'up' ? '#22c55e' : momentum === 'down' ? '#ef4444' : ''
        if (mc) valEl.style.color = mc
        else valEl.style.removeProperty('color')
      }
    }

    } // end else (line mode)

    rafRef.current = requestAnimationFrame(draw)
  }, [canvasRef])

  // Start/stop loop
  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])
}
