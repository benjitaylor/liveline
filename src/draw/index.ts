import type { LivelinePalette, ChartLayout, LivelinePoint, Momentum, ReferenceLine, OrderbookData, DegenOptions } from '../types'
import { drawGrid, type GridState } from './grid'
import { drawLine } from './line'
import { drawDot, drawArrows } from './dot'
import { drawCrosshair } from './crosshair'
import { drawReferenceLine } from './referenceLine'
import { drawTimeAxis, type TimeAxisState } from './timeAxis'
import { drawOrderbook, type OrderbookState } from './orderbook'
import { drawParticles, spawnOnSwing, type ParticleState } from './particles'

// Constants
const SHAKE_DECAY_RATE = 0.002
const SHAKE_MIN_AMPLITUDE = 0.2
const FADE_EDGE_WIDTH = 40
const CROSSHAIR_FADE_MIN_PX = 5

export interface ArrowState { up: number; down: number }

export interface ShakeState {
  amplitude: number  // current shake magnitude in px, decays each frame
}

export function createShakeState(): ShakeState {
  return { amplitude: 0 }
}

export interface DrawOptions {
  visible: LivelinePoint[]
  smoothValue: number
  now: number  // engine's Date.now()/1000, single timestamp for the frame
  momentum: Momentum
  arrowState: ArrowState
  showGrid: boolean
  showMomentum: boolean
  showPulse: boolean
  showFill: boolean
  referenceLine?: ReferenceLine
  hoverX: number | null
  hoverValue: number | null
  hoverTime: number | null
  scrubAmount: number // 0 = not scrubbing, 1 = fully scrubbing (lerped)
  windowSecs: number
  formatValue: (v: number) => string
  formatTime: (t: number) => string
  gridState: GridState
  timeAxisState: TimeAxisState
  dt: number // delta time in ms for frame-rate-independent lerps
  targetWindowSecs: number // final target window (stable during transitions)
  tooltipY: number
  tooltipOutline: boolean
  orderbookData?: OrderbookData
  orderbookState?: OrderbookState
  particleState?: ParticleState
  particleOptions?: DegenOptions
  swingMagnitude: number
  shakeState?: ShakeState
  chartReveal: number       // 0 = loading/morphing from center, 1 = fully revealed
  pauseProgress: number     // 0 = playing, 1 = fully paused
  now_ms: number            // performance.now() for breathing animation timing
}

/**
 * Master draw function — calls each draw module in order.
 * Mutates arrowState in place.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  opts: DrawOptions,
): void {
  // 0. Chart shake — apply offset, decay amplitude
  const shake = opts.shakeState
  let shakeX = 0
  let shakeY = 0
  if (shake && shake.amplitude > SHAKE_MIN_AMPLITUDE) {
    shakeX = (Math.random() - 0.5) * 2 * shake.amplitude
    shakeY = (Math.random() - 0.5) * 2 * shake.amplitude
    ctx.save()
    ctx.translate(shakeX, shakeY)
  }
  if (shake) {
    // Exponential decay — ~200ms of visible shake
    const decayRate = Math.pow(SHAKE_DECAY_RATE, opts.dt / 1000)
    shake.amplitude *= decayRate
    if (shake.amplitude < SHAKE_MIN_AMPLITUDE) shake.amplitude = 0
  }

  const reveal = opts.chartReveal
  const pause = opts.pauseProgress

  // Smoothstep helper for staggered reveal
  const revealRamp = (start: number, end: number) => {
    const t = Math.max(0, Math.min(1, (reveal - start) / (end - start)))
    return t * t * (3 - 2 * t)
  }

  // 1. Reference line (behind everything) — fades with reveal
  if (opts.referenceLine && reveal > 0.01) {
    ctx.save()
    if (reveal < 1) ctx.globalAlpha = reveal
    drawReferenceLine(ctx, layout, palette, opts.referenceLine)
    ctx.restore()
  }

  // 2. Grid — fades in delayed (15%–70% of reveal)
  if (opts.showGrid) {
    const gridAlpha = reveal < 1 ? revealRamp(0.15, 0.7) : 1
    if (gridAlpha > 0.01) {
      ctx.save()
      if (gridAlpha < 1) ctx.globalAlpha = gridAlpha
      drawGrid(ctx, layout, palette, opts.formatValue, opts.gridState, opts.dt)
      ctx.restore()
    }
  }

  // 2b. Orderbook (behind line) — fades with reveal
  if (opts.orderbookData && opts.orderbookState && reveal > 0.01) {
    ctx.save()
    if (reveal < 1) ctx.globalAlpha = reveal
    drawOrderbook(ctx, layout, palette, opts.orderbookData, opts.dt, opts.orderbookState, opts.swingMagnitude)
    ctx.restore()
  }

  // Pause: no visual dimming, chart stays full color.
  // Badge hides + pulse suppresses separately.
  const pauseDim = 1

  // 3. Line + fill (with scrub dimming + reveal morphing + pause dim)
  const scrubX = opts.scrubAmount > 0.05 ? opts.hoverX : null
  ctx.save()
  if (pauseDim < 1) ctx.globalAlpha = pauseDim
  const pts = drawLine(ctx, layout, palette, opts.visible, opts.smoothValue, opts.now, opts.showFill, scrubX, opts.scrubAmount, reveal, opts.now_ms)
  ctx.restore()

  // 4. Time axis — same timing as grid
  {
    const timeAlpha = reveal < 1 ? revealRamp(0.15, 0.7) : 1
    if (timeAlpha > 0.01) {
      ctx.save()
      if (timeAlpha < 1) ctx.globalAlpha = timeAlpha
      drawTimeAxis(ctx, layout, palette, opts.windowSecs, opts.targetWindowSecs, opts.formatTime, opts.timeAxisState, opts.dt)
      ctx.restore()
    }
  }

  if (pts && pts.length > 0) {
    const lastPt = pts[pts.length - 1]

    // 5. Dot — dims during scrub, fades in with reveal (0.3 → 1.0)
    let dotScrub = opts.scrubAmount
    if (opts.hoverX !== null && dotScrub > 0) {
      const distToLive = lastPt[0] - opts.hoverX
      const fadeStart = Math.min(80, layout.chartW * 0.3)
      dotScrub = distToLive < CROSSHAIR_FADE_MIN_PX ? 0
        : distToLive >= fadeStart ? opts.scrubAmount
        : ((distToLive - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX)) * opts.scrubAmount
    }

    // Dot appears once shape is recognizable (reveal > 0.3), dims with pause
    const dotAlpha = (reveal < 0.3 ? 0 : (reveal - 0.3) / 0.7) * pauseDim
    const showPulse = opts.showPulse && reveal > 0.6 && pause < 0.5
    if (dotAlpha > 0.01) {
      ctx.save()
      if (dotAlpha < 1) ctx.globalAlpha = dotAlpha
      drawDot(ctx, lastPt[0], lastPt[1], palette, showPulse, dotScrub)
      ctx.restore()
    }

    // 5b. Arrows — appear late in reveal (60%+), fade with pause
    if (opts.showMomentum) {
      const arrowReveal = reveal < 1 ? revealRamp(0.6, 1) : 1
      const arrowAlpha = arrowReveal * (1 - pause)
      if (arrowAlpha > 0.01) {
        ctx.save()
        if (arrowAlpha < 1) ctx.globalAlpha = arrowAlpha
        drawArrows(
          ctx, lastPt[0], lastPt[1],
          opts.momentum, palette, opts.arrowState, opts.dt,
        )
        ctx.restore()
      }
    }

    // 6. Particles — only when fully revealed
    if (opts.particleState && reveal > 0.9) {
      const burstIntensity = spawnOnSwing(
        opts.particleState, opts.momentum, lastPt[0], lastPt[1],
        opts.swingMagnitude, palette.line, opts.dt, opts.particleOptions,
      )
      if (burstIntensity > 0 && shake) {
        shake.amplitude = (3 + opts.swingMagnitude * 4) * burstIntensity
      }
      drawParticles(ctx, opts.particleState, opts.dt)
    }
  }

  // 7. Left edge fade — gradient erase
  const fadeW = FADE_EDGE_WIDTH
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  const fadeGrad = ctx.createLinearGradient(layout.pad.left, 0, layout.pad.left + fadeW, 0)
  fadeGrad.addColorStop(0, 'rgba(0, 0, 0, 1)')
  fadeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = fadeGrad
  ctx.fillRect(0, 0, layout.pad.left + fadeW, layout.h)
  ctx.restore()

  // 8. Crosshair — fade out well before reaching live dot
  if (opts.hoverX !== null && opts.hoverValue !== null && opts.hoverTime !== null && pts && pts.length > 0) {
    const lastPt = pts[pts.length - 1]
    const distToLive = lastPt[0] - opts.hoverX
    const fadeStart = Math.min(80, layout.chartW * 0.3)
    const scrubOpacity = distToLive < CROSSHAIR_FADE_MIN_PX ? 0
      : distToLive >= fadeStart ? opts.scrubAmount
      : ((distToLive - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX)) * opts.scrubAmount

    if (scrubOpacity > 0.01) {
      drawCrosshair(
        ctx, layout, palette,
        opts.hoverX, opts.hoverValue, opts.hoverTime,
        opts.formatValue, opts.formatTime,
        scrubOpacity,
        opts.tooltipY,
        lastPt[0], // liveDotX — tooltip right edge stops here
        opts.tooltipOutline,
      )
    }
  }

  // Restore shake translate
  if (shake && (shakeX !== 0 || shakeY !== 0)) {
    ctx.restore()
  }
}
