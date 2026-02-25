import type { LivelinePalette, ChartLayout } from '../types'

export interface MultiSeriesHoverEntry {
  color: string
  label: string
  value: number
}

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

/** Multi-series crosshair: vertical line + inline text at top, matching single-series style. */
export function drawMultiCrosshair(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  hoverX: number,
  hoverTime: number,
  entries: MultiSeriesHoverEntry[],
  formatValue: (v: number) => string,
  formatTime: (t: number) => string,
  scrubOpacity: number,
  tooltipY?: number,
  tooltipOutline?: boolean,
  liveDotX?: number,
) {
  if (scrubOpacity < 0.01 || entries.length === 0) return

  const { h, pad, toY } = layout

  // Vertical line (solid, matching single-series)
  ctx.save()
  ctx.globalAlpha = scrubOpacity * 0.5
  ctx.strokeStyle = palette.crosshairLine
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(hoverX, pad.top)
  ctx.lineTo(hoverX, h - pad.bottom)
  ctx.stroke()
  ctx.restore()

  // Dots at each series intersection — radius scales with scrubOpacity,
  // alpha stays at 1 (matching single-series crosshair dot behavior)
  const dotRadius = 4 * Math.min(scrubOpacity * 3, 1)
  if (dotRadius > 0.5) {
    ctx.globalAlpha = 1
    for (const entry of entries) {
      const y = toY(entry.value)
      ctx.beginPath()
      ctx.arc(hoverX, y, dotRadius, 0, Math.PI * 2)
      ctx.fillStyle = entry.color
      ctx.fill()
    }
  }

  if (scrubOpacity < 0.1 || layout.w < 300) return

  // Inline text at top — same style as single-series crosshair
  // Format: "TIME  ·  ● Label Value  ·  ● Label Value"
  ctx.save()
  ctx.globalAlpha = scrubOpacity
  ctx.font = '400 13px "SF Mono", Menlo, monospace'
  ctx.textAlign = 'left'

  const timeText = formatTime(hoverTime)
  const sep = '  ·  '
  const dotInline = ' '  // spacing for inline colored dot

  // Build segments: [ { text, color } ... ]
  type Seg = { text: string; color: string; isDot?: boolean }
  const segments: Seg[] = [
    { text: timeText, color: palette.gridLabel },
  ]
  for (const e of entries) {
    segments.push({ text: sep, color: palette.gridLabel })
    // Inline dot (drawn as circle, not text)
    segments.push({ text: dotInline, color: e.color, isDot: true })
    const label = e.label ? `${e.label} ` : ''
    if (label) segments.push({ text: label, color: palette.gridLabel })
    segments.push({ text: formatValue(e.value), color: palette.tooltipText })
  }

  // Measure total width
  let totalW = 0
  const segWidths: number[] = []
  for (const seg of segments) {
    const w = seg.isDot ? 12 : ctx.measureText(seg.text).width
    segWidths.push(w)
    totalW += w
  }

  // Position — center on crosshair, clamp to chart bounds
  // Right edge of tooltip aligns with the right edge of live dots (matching single-series)
  let tx = hoverX - totalW / 2
  const minX = pad.left + 4
  const dotRightEdge = liveDotX != null ? liveDotX + 7 : layout.w - pad.right
  const maxX = dotRightEdge - totalW
  if (tx < minX) tx = minX
  if (tx > maxX) tx = maxX

  const ty = pad.top + (tooltipY ?? 14) + 10

  // Outline pass
  if (tooltipOutline !== false) {
    ctx.strokeStyle = palette.tooltipBg
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    let ox = tx
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (!seg.isDot) {
        ctx.strokeText(seg.text, ox, ty)
      }
      ox += segWidths[i]
    }
  }

  // Fill pass
  let ox = tx
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg.isDot) {
      // Draw small colored circle inline
      ctx.beginPath()
      ctx.arc(ox + 4, ty - 4, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = seg.color
      ctx.fill()
    } else {
      ctx.fillStyle = seg.color
      ctx.fillText(seg.text, ox, ty)
    }
    ox += segWidths[i]
  }

  ctx.restore()
}
