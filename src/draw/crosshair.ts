import type { LivelinePalette, ChartLayout } from '../types'

export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  hoverX: number,
  hoverValue: number,
  hoverTime: number,
  formatValue: (v: number) => string,
  formatTime: (t: number) => string,
  scrubOpacity: number,
  tooltipY?: number,
  liveDotX?: number,
  tooltipOutline?: boolean,
) {
  if (scrubOpacity < 0.01) return

  const { h, pad, toY } = layout
  const y = toY(hoverValue)

  // Vertical line (solid, like Kalshi)
  ctx.save()
  ctx.globalAlpha = scrubOpacity * 0.5
  ctx.strokeStyle = palette.crosshairLine
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(hoverX, pad.top)
  ctx.lineTo(hoverX, h - pad.bottom)
  ctx.stroke()
  ctx.restore()

  // Dot at intersection — solid accent color, always fully opaque.
  // Radius scales with scrubOpacity for smooth appear/disappear.
  const dotRadius = 4 * Math.min(scrubOpacity * 3, 1)
  if (dotRadius > 0.5) {
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(hoverX, y, dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = palette.line
    ctx.fill()
  }

  // Top label: "$VALUE - TIME" — fixed at top, moves horizontally only
  // Skip text for small containers (text is ~200px wide)
  if (scrubOpacity < 0.1 || layout.w < 300) return

  const valueText = formatValue(hoverValue)
  const timeText = formatTime(hoverTime)
  const separator = '  ·  '

  ctx.save()
  ctx.globalAlpha = scrubOpacity
  ctx.font = '400 13px "SF Mono", Menlo, monospace'

  const valueW = ctx.measureText(valueText).width
  const sepW = ctx.measureText(separator).width
  const timeW = ctx.measureText(timeText).width
  const totalW = valueW + sepW + timeW

  // Center on crosshair, clamp to chart bounds
  // Right edge of tooltip text aligns with the right edge of the live dot circle
  let tx = hoverX - totalW / 2
  const minX = pad.left + 4
  const dotRightEdge = liveDotX != null ? liveDotX + 7 : layout.w - pad.right
  const maxX = dotRightEdge - totalW
  if (tx < minX) tx = minX
  if (tx > maxX) tx = maxX

  const ty = pad.top + (tooltipY ?? 14) + 10 // offset from top

  ctx.textAlign = 'left'

  // Text outline for readability against the chart
  if (tooltipOutline) {
    ctx.strokeStyle = palette.tooltipBg
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    ctx.strokeText(valueText, tx, ty)
    ctx.strokeText(separator + timeText, tx + valueW, ty)
  }

  // Value (dark)
  ctx.fillStyle = palette.tooltipText
  ctx.fillText(valueText, tx, ty)

  // Separator + time (lighter)
  ctx.fillStyle = palette.gridLabel
  ctx.fillText(separator + timeText, tx + valueW, ty)

  ctx.restore()
}
