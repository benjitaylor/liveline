import type { ChartLayout, BarPoint } from '../types'

export interface BarLayout {
  /** Y pixel where bars are anchored (bottom of the bar region) */
  bottom: number
  /** Maximum bar height in pixels */
  maxHeight: number
  /** Maximum bar value — used to scale bar heights */
  maxValue: number
}

export interface BarDrawOptions {
  bars: BarPoint[]
  barWidthSecs: number
  fillColor: string
  labelColor: string
  scrubX: number | null
  scrubAmount: number
  revealProgress: number
  showLabels: boolean
}

/**
 * Draw vertical bars aligned to time buckets.
 * Bars grow upward from `barLayout.bottom`.
 * Pure drawing function — no state mutations.
 */
export function drawBars(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  barLayout: BarLayout,
  opts: BarDrawOptions,
): void {
  const { bars, barWidthSecs, fillColor, scrubX, scrubAmount, revealProgress } = opts
  if (bars.length === 0 || barLayout.maxValue <= 0) return

  const { pad, chartW } = layout
  const pxPerSec = chartW / (layout.rightEdge - layout.leftEdge)
  const barPxWidth = Math.max(1, barWidthSecs * pxPerSec - 2) // 2px gap between bars
  const halfBar = barPxWidth / 2
  const cornerR = barPxWidth > 6 ? 1.5 : 0
  const baseAlpha = ctx.globalAlpha

  ctx.fillStyle = fillColor

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]
    if (b.value <= 0) continue

    const centerX = layout.toX(b.time + barWidthSecs / 2)
    const x = centerX - halfBar

    // Skip bars fully outside visible area
    if (x + barPxWidth < pad.left || x > pad.left + chartW) continue

    const rawHeight = (b.value / barLayout.maxValue) * barLayout.maxHeight
    // During reveal, bars grow from zero height
    const barH = rawHeight * revealProgress
    if (barH < 0.5) continue

    const barY = barLayout.bottom - barH

    // Scrub dimming: bars to the right of scrubX are dimmed
    if (scrubX !== null && scrubAmount > 0.05) {
      const barCenter = centerX
      if (barCenter > scrubX) {
        ctx.globalAlpha = baseAlpha * (1 - scrubAmount * 0.6)
      } else {
        ctx.globalAlpha = baseAlpha
      }
    }

    if (cornerR > 0 && barH > cornerR * 2) {
      // Rounded top corners only
      ctx.beginPath()
      ctx.moveTo(x, barLayout.bottom)
      ctx.lineTo(x, barY + cornerR)
      ctx.arcTo(x, barY, x + cornerR, barY, cornerR)
      ctx.lineTo(x + barPxWidth - cornerR, barY)
      ctx.arcTo(x + barPxWidth, barY, x + barPxWidth, barY + cornerR, cornerR)
      ctx.lineTo(x + barPxWidth, barLayout.bottom)
      ctx.closePath()
      ctx.fill()
    } else {
      ctx.fillRect(x, barY, barPxWidth, barH)
    }
  }

  // Labels (optional) — drawn inside the bar, near the top
  if (opts.showLabels && revealProgress > 0.5) {
    ctx.save()
    const fontSize = layout.w > 500 ? 9 : 8
    ctx.font = `${fontSize}px "SF Mono", Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = opts.labelColor
    ctx.globalAlpha = baseAlpha * Math.min(1, (revealProgress - 0.5) * 4)

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i]
      if (b.value <= 0) continue
      const centerX = layout.toX(b.time + barWidthSecs / 2)
      if (centerX < pad.left || centerX > pad.left + chartW) continue
      const barH = (b.value / barLayout.maxValue) * barLayout.maxHeight * revealProgress
      if (barH < fontSize + 6) continue // skip labels on bars too short to fit text
      ctx.fillText(formatBarValue(b.value), centerX, barLayout.bottom - 3)
    }
    ctx.restore()
  }

  ctx.globalAlpha = baseAlpha
}

function formatBarValue(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  if (v >= 10) return Math.round(v).toString()
  if (v >= 1) return v.toFixed(1)
  return v.toFixed(2)
}
