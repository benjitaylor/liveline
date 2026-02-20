import type { LivelinePalette, ChartLayout, LivelinePoint } from '../types'
import { drawSpline } from '../math/spline'
import { loadingY, loadingBreath, LOADING_AMPLITUDE_RATIO, LOADING_SCROLL_SPEED } from './loadingShape'

/** Parse a CSS color to [r, g, b, a]. Handles hex, rgb(), rgba(). */
function parseRgba(color: string): [number, number, number, number] {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 1]
  }
  const rgba = color.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)/)
  if (rgba) return [+rgba[1], +rgba[2], +rgba[3], +rgba[4]]
  const rgb = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], 1]
  return [128, 128, 128, 1]
}

/** Lerp between two CSS colors including alpha. Handles hex, rgb(), rgba(). */
function blendColor(c1: string, c2: string, t: number): string {
  if (t <= 0) return c1
  if (t >= 1) return c2
  const [r1, g1, b1, a1] = parseRgba(c1)
  const [r2, g2, b2, a2] = parseRgba(c2)
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  const a = a1 + (a2 - a1) * t
  if (a >= 0.995) return `rgb(${r},${g},${b})`
  return `rgba(${r},${g},${b},${a.toFixed(3)})`
}

/** Draw the fill gradient + stroke line for a set of points. */
function renderCurve(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  pts: [number, number][],
  showFill: boolean,
  lineAlpha: number = 1,
  fillAlpha: number = 1,
  strokeColor?: string,
) {
  const { h, pad } = layout
  const baseAlpha = ctx.globalAlpha

  if (showFill && fillAlpha > 0.01) {
    ctx.globalAlpha = baseAlpha * fillAlpha
    const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom)
    grad.addColorStop(0, palette.fillTop)
    grad.addColorStop(1, palette.fillBottom)
    ctx.beginPath()
    ctx.moveTo(pts[0][0], h - pad.bottom)
    ctx.lineTo(pts[0][0], pts[0][1])
    drawSpline(ctx, pts)
    ctx.lineTo(pts[pts.length - 1][0], h - pad.bottom)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()
  }

  ctx.globalAlpha = baseAlpha * lineAlpha
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  drawSpline(ctx, pts)
  ctx.strokeStyle = strokeColor ?? palette.line
  ctx.lineWidth = palette.lineWidth
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.globalAlpha = baseAlpha
}

export function drawLine(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  visible: LivelinePoint[],
  smoothValue: number,
  now: number,
  showFill: boolean,
  scrubX: number | null,
  scrubAmount: number = 0,
  chartReveal: number = 1,
  now_ms: number = 0,
) {
  const { h, pad, toX, toY, chartW, chartH } = layout

  // Build screen-space points: all historical data stays stable,
  // but the LAST data point uses smoothValue for its Y (so big jumps
  // animate smoothly instead of snapping). Its X stays at the original
  // data time (stable, no per-frame drift — this is what killed jitter).
  // Then append the live tip at (now, smoothValue).
  // Y coordinates are clamped to chart bounds so the line hugs the edge
  // during range transitions instead of getting hard-clipped.
  const yMin = pad.top
  const yMax = h - pad.bottom
  const clampY = (y: number) => Math.max(yMin, Math.min(yMax, y))

  // During reveal, morph Y positions from the loading squiggly shape toward real data.
  // At chartReveal=0 the chart line traces the exact same squiggly as drawLoading/drawEmpty.
  const centerY = pad.top + chartH / 2
  const amplitude = chartH * LOADING_AMPLITUDE_RATIO
  const scroll = now_ms * LOADING_SCROLL_SPEED
  const morphY = chartReveal < 1
    ? (rawY: number, x: number) => {
        const t = Math.max(0, Math.min(1, (x - pad.left) / chartW))
        const baseY = loadingY(t, centerY, amplitude, scroll)
        return baseY + (rawY - baseY) * chartReveal
      }
    : (rawY: number, _x: number) => rawY

  const pts: [number, number][] = visible.map((p, i) => {
    const x = toX(p.time)
    const y = i === visible.length - 1
      ? morphY(clampY(toY(smoothValue)), x)
      : morphY(clampY(toY(p.value)), x)
    return [x, y]
  })
  // Tip X: at reveal=0 extends to full chart width (matching loading/empty line),
  // at reveal=1 sits at the live dot position. Smooth morph between.
  const liveTipX = toX(now)
  const fullRightX = pad.left + chartW
  const tipX = chartReveal < 1
    ? liveTipX + (fullRightX - liveTipX) * (1 - chartReveal)
    : liveTipX
  pts.push([tipX, morphY(clampY(toY(smoothValue)), tipX)])

  if (pts.length < 2) return

  // Reveal alphas: at reveal=0, line matches loading/empty brightness (shared breath).
  // As reveal increases, line ramps to full. Fill fades in with reveal.
  let lineAlpha = 1
  let fillAlpha = 1
  if (chartReveal < 1) {
    const breath = loadingBreath(now_ms)
    lineAlpha = breath + (1 - breath) * chartReveal
    fillAlpha = chartReveal
  }

  // Blend line color: grey at reveal=0, accent by reveal≈0.3.
  // Front-loaded so the color shifts early while alpha is still low.
  const strokeColor = chartReveal < 1
    ? blendColor(palette.gridLabel, palette.line, Math.min(1, chartReveal * 3))
    : undefined

  const isScrubbing = scrubX !== null

  // Clip line + fill to chart area — during big value jumps the range
  // lerps smoothly so the line may extend beyond the chart bounds.
  // Clipping keeps it tidy while the range catches up.
  ctx.save()
  ctx.beginPath()
  ctx.rect(pad.left - 1, pad.top, chartW + 2, chartH)
  ctx.clip()

  if (isScrubbing) {
    // Full-opacity portion: clipped to LEFT of scrub point
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, scrubX!, h)
    ctx.clip()
    renderCurve(ctx, layout, palette, pts, showFill, lineAlpha, fillAlpha, strokeColor)
    ctx.restore()

    // Dimmed portion: clipped to RIGHT of scrub point
    ctx.save()
    ctx.beginPath()
    ctx.rect(scrubX!, 0, layout.w - scrubX!, h)
    ctx.clip()
    ctx.globalAlpha = 1 - scrubAmount * 0.6
    renderCurve(ctx, layout, palette, pts, showFill, lineAlpha, fillAlpha, strokeColor)
    ctx.restore()
  } else {
    renderCurve(ctx, layout, palette, pts, showFill, lineAlpha, fillAlpha, strokeColor)
  }

  // Restore from chart-area clip
  ctx.restore()

  // Dashed current-price line — morphs from center during reveal (fades in late,
  // so the center-vs-squiggly difference is imperceptible by the time it's visible)
  const realCurrentY = Math.max(pad.top, Math.min(h - pad.bottom, toY(smoothValue)))
  const currentY = chartReveal < 1
    ? centerY + (realCurrentY - centerY) * chartReveal
    : realCurrentY
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = palette.dashLine
  ctx.lineWidth = 1
  const dashBase = isScrubbing ? 1 - scrubAmount * 0.2 : 1
  ctx.globalAlpha = chartReveal < 1 ? dashBase * chartReveal : dashBase
  ctx.beginPath()
  ctx.moveTo(pad.left, currentY)
  ctx.lineTo(layout.w - pad.right, currentY)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  // Clamp last point Y so dot stays within canvas (not chart area).
  // The dot outer circle is 6.5px + shadow — 10px margin keeps it visible.
  const last = pts[pts.length - 1]
  last[1] = Math.max(10, Math.min(h - 10, last[1]))

  return pts
}
