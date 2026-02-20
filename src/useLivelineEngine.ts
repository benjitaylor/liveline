import { useRef, useEffect, useCallback } from 'react'
import type { LivelinePoint, LivelinePalette, Momentum, ReferenceLine, HoverPoint, Padding, ChartLayout, OrderbookData, DegenOptions, BadgeVariant } from './types'
import { lerp } from './math/lerp'
import { computeRange } from './math/range'
import { detectMomentum } from './math/momentum'
import { interpolateAtTime } from './math/interpolate'
import { getDpr, applyDpr } from './canvas/dpr'
import { drawFrame, FADE_EDGE_WIDTH } from './draw'
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
const CHART_REVEAL_SPEED = 0.14
const PAUSE_PROGRESS_SPEED = 0.12
const PAUSE_CATCHUP_SPEED = 0.08
const PAUSE_CATCHUP_SPEED_FAST = 0.22
const LOADING_ALPHA_SPEED = 0.14

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

  // Reveal state (loading → chart morph)
  const chartRevealRef = useRef(0) // 0 = loading/empty, 1 = fully revealed

  // Pause state
  const pauseProgressRef = useRef(0) // 0 = playing, 1 = fully paused
  const timeDebtRef = useRef(0) // accumulated seconds behind real time

  // Data stash for reverse morph (chart → flat line when data disappears)
  const lastDataRef = useRef<LivelinePoint[]>([])
  const frozenNowRef = useRef(0)

  // Pause data snapshot — freeze visible data when pausing to prevent
  // consumer-side pruning from eroding the left edge of the line
  const pausedDataRef = useRef<LivelinePoint[] | null>(null)

  // Loading ↔ empty crossfade
  const loadingAlphaRef = useRef(config.loading ? 1 : 0)

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
  }, [])  // draw is stable (useCallback with no deps that change)

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

    // Snapshot data when pause starts, use snapshot while paused
    // so consumer-side pruning can't erode the visible line
    if (cfg.paused && pausedDataRef.current === null && cfg.data.length >= 2) {
      pausedDataRef.current = cfg.data.slice()
    }
    if (!cfg.paused) {
      pausedDataRef.current = null
    }

    const points = pausedDataRef.current ?? cfg.data
    const hasData = points.length >= 2
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
      : lerp(chartRevealRef.current, revealTarget, CHART_REVEAL_SPEED, dt)
    if (Math.abs(chartRevealRef.current - revealTarget) < 0.005) {
      chartRevealRef.current = revealTarget
    }
    const chartReveal = chartRevealRef.current

    // Data stash for reverse morph — keep drawing chart while it morphs back
    // to the squiggly shape (identical to loading/empty line at reveal=0)
    const useStash = !hasData && chartReveal > 0.005 && lastDataRef.current.length >= 2
    if (hasData) {
      lastDataRef.current = points
    }

    if (!hasData && !useStash) {
      // No chart pipeline — draw loading or empty as the sole visual.
      // Loading is ONLY drawn here (never behind the chart) so there's
      // always ONE line on screen, never two overlapping.
      if (loadingAlpha > 0.01) {
        drawLoading(ctx, w, h, pad, cfg.palette, now_ms, loadingAlpha)
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
    // so new data (with real-time timestamps) can't appear past the live dot
    const filterRight = rightEdge - (rightEdge - now) * pauseProgress
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

    rafRef.current = requestAnimationFrame(draw)
  }, [canvasRef])

  // Start/stop loop
  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])
}
