import type { LivelinePalette, Padding } from '../types'
import { drawSpline } from '../math/spline'
import { loadingY, loadingBreath, LOADING_AMPLITUDE_RATIO, LOADING_SCROLL_SPEED } from './loadingShape'

/**
 * Draw the empty/no-data state: a breathing squiggly line (grey) with
 * a gradient gap in the middle where "No data to display" text sits.
 *
 * skipLine=true skips the squiggly line but still draws the gradient
 * gap + text. Used as an overlay during chart morph so the gap fades
 * in smoothly over the morphing chart line.
 */
export function drawEmpty(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: Required<Padding>,
  palette: LivelinePalette,
  alpha: number = 1,
  now_ms: number = 0,
  skipLine: boolean = false,
): void {
  const chartW = w - pad.left - pad.right
  const chartH = h - pad.top - pad.bottom
  const centerY = pad.top + chartH / 2
  const cx = pad.left + chartW / 2

  const text = 'No data to display'
  ctx.font = '400 12px system-ui, -apple-system, sans-serif'

  const amplitude = chartH * LOADING_AMPLITUDE_RATIO

  // Measure text to know gap size
  const textW = ctx.measureText(text).width
  const gapHalf = textW / 2 + 20   // padding around text
  const fadeW = 30                   // gradient fade width on each side

  if (!skipLine) {
    const scroll = now_ms * LOADING_SCROLL_SPEED
    const breath = loadingBreath(now_ms)

    // Breathing squiggly line — same shape as drawLoading but grey
    const numPts = 32
    const pts: [number, number][] = []
    for (let i = 0; i <= numPts; i++) {
      const t = i / numPts
      const x = pad.left + t * chartW
      const y = loadingY(t, centerY, amplitude, scroll)
      pts.push([x, y])
    }

    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    drawSpline(ctx, pts)
    ctx.strokeStyle = palette.gridLabel
    ctx.lineWidth = palette.lineWidth
    ctx.globalAlpha = breath * alpha
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  // Gradient gap — erases whatever line is on the canvas in the text region.
  // Always drawn (even with skipLine) so it fades in over the morphing chart line.
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  const gapLeft = cx - gapHalf - fadeW
  const gapRight = cx + gapHalf + fadeW
  const eraseGrad = ctx.createLinearGradient(gapLeft, 0, gapRight, 0)
  eraseGrad.addColorStop(0, 'rgba(0,0,0,0)')
  eraseGrad.addColorStop(fadeW / (gapRight - gapLeft), 'rgba(0,0,0,1)')
  eraseGrad.addColorStop(1 - fadeW / (gapRight - gapLeft), 'rgba(0,0,0,1)')
  eraseGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = eraseGrad
  ctx.globalAlpha = alpha
  // Erase tall enough to cover the line's full amplitude
  const eraseH = amplitude * 2 + palette.lineWidth + 6
  ctx.fillRect(gapLeft, centerY - eraseH / 2, gapRight - gapLeft, eraseH)
  ctx.restore()

  // "No data to display" text
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.globalAlpha = 0.35 * alpha
  ctx.fillStyle = palette.gridLabel
  ctx.fillText(text, cx, centerY)

  ctx.globalAlpha = 1
  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'
}
