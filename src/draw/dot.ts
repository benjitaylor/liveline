import type { Momentum, LivelinePalette } from '../types'
import type { ArrowState } from './index'
import { parseColorRgb } from '../theme'
import { lerp } from '../math/lerp'

const PULSE_INTERVAL = 1500
const PULSE_DURATION = 900

function lerpColor(a: [number,number,number], b: [number,number,number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t)
  const g = Math.round(a[1] + (b[1] - a[1]) * t)
  const bl = Math.round(a[2] + (b[2] - a[2]) * t)
  return `rgb(${r},${g},${bl})`
}

/** Draw the live dot: expanding ring pulse, white outer circle, colored inner dot. */
export function drawDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  palette: LivelinePalette,
  pulse: boolean = true,
  scrubAmount: number = 0,
  now_ms: number = performance.now(),
): void {
  const baseAlpha = ctx.globalAlpha
  const dim = scrubAmount * 0.7

  // Expanding ring pulse (accent colored, every 1.5s) — suppress when dimmed
  if (pulse && dim < 0.3) {
    const t = (now_ms % PULSE_INTERVAL) / PULSE_DURATION
    if (t < 1) {
      const radius = 9 + t * 12
      const pulseAlpha = 0.35 * (1 - t) * (1 - dim * 3)
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.strokeStyle = palette.line
      ctx.lineWidth = 1.5
      ctx.globalAlpha = baseAlpha * pulseAlpha
      ctx.stroke()
    }
  }

  // Outer bg color for blending
  const outerRgb = parseColorRgb(palette.badgeOuterBg)

  // White outer circle with subtle shadow
  ctx.save()
  ctx.globalAlpha = baseAlpha
  ctx.shadowColor = palette.badgeOuterShadow
  ctx.shadowBlur = 6 * (1 - dim)
  ctx.shadowOffsetY = 1
  ctx.beginPath()
  ctx.arc(x, y, 6.5, 0, Math.PI * 2)
  ctx.fillStyle = palette.badgeOuterBg
  ctx.fill()
  ctx.restore()

  // Colored inner dot — blend toward outer bg when dimmed
  ctx.globalAlpha = baseAlpha
  ctx.beginPath()
  ctx.arc(x, y, 3.5, 0, Math.PI * 2)
  if (dim > 0.01) {
    const lineRgb = parseColorRgb(palette.line)
    ctx.fillStyle = lerpColor(lineRgb, outerRgb, dim)
  } else {
    ctx.fillStyle = palette.line
  }
  ctx.fill()
}

/** Draw momentum arrows (chevrons) next to the dot. */
export function drawArrows(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  momentum: Momentum,
  palette: LivelinePalette,
  arrows: ArrowState,
  dt: number,
  now_ms: number = performance.now(),
): void {
  const baseAlpha = ctx.globalAlpha

  // Update arrow opacities — fade out old direction fully before fading in new
  const upTarget = momentum === 'up' ? 1 : 0
  const downTarget = momentum === 'down' ? 1 : 0

  const canFadeInUp = arrows.down < 0.02
  const canFadeInDown = arrows.up < 0.02

  arrows.up = lerp(arrows.up, canFadeInUp ? upTarget : 0, upTarget > arrows.up ? 0.08 : 0.04, dt)
  arrows.down = lerp(arrows.down, canFadeInDown ? downTarget : 0, downTarget > arrows.down ? 0.08 : 0.04, dt)

  if (arrows.up < 0.01) arrows.up = 0
  if (arrows.down < 0.01) arrows.down = 0
  if (arrows.up > 0.99) arrows.up = 1
  if (arrows.down > 0.99) arrows.down = 1

  // Draw chevrons — directional cascade animation.
  // UP: bottom arrow fires first, then top (energy moves upward).
  // DOWN: top arrow fires first, then bottom.
  const cycle = (now_ms % 1400) / 1400
  const drawChevrons = (dir: -1 | 1, opacity: number) => {
    if (opacity < 0.01) return
    const baseX = x + 19
    const baseY = y

    ctx.save()
    ctx.strokeStyle = palette.gridLabel
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (let i = 0; i < 2; i++) {
      // Stagger: arrow 0 brightens at t=0, arrow 1 at t=0.2
      // Both always visible (min 0.3), cascade just brightens each in sequence
      const start = i * 0.2
      const dur = 0.35
      const localT = cycle - start
      const wave = (localT >= 0 && localT < dur)
        ? Math.sin((localT / dur) * Math.PI)
        : 0
      const pulse = 0.3 + 0.7 * wave

      ctx.globalAlpha = baseAlpha * opacity * pulse

      const nudge = dir === -1 ? -3 : 3
      const cy = baseY + dir * (i * 8 - 4) + nudge
      ctx.beginPath()
      ctx.moveTo(baseX - 5, cy - dir * 3.5)
      ctx.lineTo(baseX, cy)
      ctx.lineTo(baseX + 5, cy - dir * 3.5)
      ctx.stroke()
    }

    ctx.restore()
  }

  drawChevrons(-1, arrows.up)
  drawChevrons(1, arrows.down)

  ctx.globalAlpha = baseAlpha
}
