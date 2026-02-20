import type { LivelinePalette, Padding } from '../types'
import { drawSpline } from '../math/spline'
import { loadingY, loadingBreath, LOADING_AMPLITUDE_RATIO, LOADING_SCROLL_SPEED } from './loadingShape'

/**
 * Draw the loading state: a gently undulating line in accent color at
 * breathing alpha. Uses drawSpline (same renderer as the chart line)
 * through evenly-spaced samples of loadingY — guarantees the loading
 * line and chart morph base produce visually identical curves.
 */
export function drawLoading(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: Required<Padding>,
  palette: LivelinePalette,
  now_ms: number,
  alpha: number = 1,
): void {
  const chartW = w - pad.left - pad.right
  const chartH = h - pad.top - pad.bottom
  const centerY = pad.top + chartH / 2
  const leftX = pad.left
  const amplitude = chartH * LOADING_AMPLITUDE_RATIO
  const scroll = now_ms * LOADING_SCROLL_SPEED

  const breath = loadingBreath(now_ms)

  // Sample the squiggly at ~32 evenly-spaced points — same density as
  // typical chart data, and rendered through the same spline path so the
  // loading→chart handoff has zero visual shape difference.
  const numPts = 32
  const pts: [number, number][] = []
  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts
    const x = leftX + t * chartW
    const y = loadingY(t, centerY, amplitude, scroll)
    pts.push([x, y])
  }

  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  drawSpline(ctx, pts)

  ctx.strokeStyle = palette.line
  ctx.lineWidth = palette.lineWidth
  ctx.globalAlpha = breath * alpha
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()

  ctx.globalAlpha = 1
}
