import type { LivelinePalette, ChartLayout, OrderbookData } from '../types'

// Green: rgb(34, 197, 94), Red: rgb(239, 68, 68)
const GREEN: [number, number, number] = [34, 197, 94]
const RED: [number, number, number] = [239, 68, 68]

interface StreamLabel {
  y: number
  text: string
  green: boolean
  life: number
  maxLife: number
  intensity: number // 0-1, bigger orders = brighter
}

export interface OrderbookState {
  labels: StreamLabel[]
  spawnTimer: number
  smoothSpeed: number
  // Orderbook churn tracking
  prevBidTotal: number
  prevAskTotal: number
  churnRate: number // smoothed 0-1, how much the book is changing
}

export function createOrderbookState(): OrderbookState {
  return {
    labels: [], spawnTimer: 0, smoothSpeed: BASE_SPEED,
    prevBidTotal: 0, prevAskTotal: 0, churnRate: 0,
  }
}

const MAX_LABELS = 50
const LABEL_LIFETIME = 6 // seconds
const SPAWN_INTERVAL = 40 // ms
const MIN_LABEL_GAP = 22 // px
const BASE_SPEED = 60 // px/s calm
const MAX_SPEED = 160 // px/s during big activity

function mixColor(
  from: [number, number, number],
  to: [number, number, number],
  t: number,
): string {
  const r = Math.round(from[0] + (to[0] - from[0]) * t)
  const g = Math.round(from[1] + (to[1] - from[1]) * t)
  const b = Math.round(from[2] + (to[2] - from[2]) * t)
  return `rgb(${r},${g},${b})`
}

/**
 * Kalshi-style orderbook: left-aligned column spanning full chart height.
 * Labels decelerate as they rise — fast entry at bottom, slow drift at top.
 * Speed driven by two signals:
 *   1. swingMagnitude — price momentum (proxy for activity)
 *   2. orderbook churn — how much the bid/ask data itself is changing
 * Whichever signal is stronger wins. Works with both demo and production data.
 */
export function drawOrderbook(
  ctx: CanvasRenderingContext2D,
  layout: ChartLayout,
  palette: LivelinePalette,
  orderbook: OrderbookData,
  dt: number,
  state: OrderbookState,
  swingMagnitude: number,
): void {
  const { pad, h, chartH } = layout
  const dtSec = dt / 1000

  if (orderbook.bids.length === 0 && orderbook.asks.length === 0) return

  let maxSize = 0
  let bidTotal = 0
  let askTotal = 0
  for (const [, size] of orderbook.bids) { bidTotal += size; if (size > maxSize) maxSize = size }
  for (const [, size] of orderbook.asks) { askTotal += size; if (size > maxSize) maxSize = size }
  if (maxSize === 0) return

  // Measure orderbook churn: how much total size changed since last frame
  // Normalized by the total size so it's scale-independent
  const totalSize = bidTotal + askTotal
  const prevTotal = state.prevBidTotal + state.prevAskTotal
  let churnSignal = 0
  if (prevTotal > 0) {
    const delta = Math.abs(bidTotal - state.prevBidTotal) + Math.abs(askTotal - state.prevAskTotal)
    churnSignal = Math.min(delta / prevTotal, 1) // 0-1
  }
  state.prevBidTotal = bidTotal
  state.prevAskTotal = askTotal

  // Smooth the churn rate (fast attack, slower decay)
  const churnLerp = churnSignal > state.churnRate ? 0.3 : 0.05
  state.churnRate += (churnSignal - state.churnRate) * churnLerp

  // Activity = max of price momentum and orderbook churn
  const activity = Math.max(Math.min(swingMagnitude * 5, 1), state.churnRate)

  // Drive speed from activity
  const targetSpeed = BASE_SPEED + activity * (MAX_SPEED - BASE_SPEED)
  const speedLerp = 1 - Math.pow(0.95, dt / 16.67)
  state.smoothSpeed += (targetSpeed - state.smoothSpeed) * speedLerp
  const speed = state.smoothSpeed

  const labelX = pad.left + 8
  const bottomY = h - pad.bottom - 6
  const topY = pad.top
  const bg = palette.bgRgb

  // Spawn new labels at bottom
  state.spawnTimer += dt
  while (state.spawnTimer >= SPAWN_INTERVAL && state.labels.length < MAX_LABELS) {
    state.spawnTimer -= SPAWN_INTERVAL

    // Check overlap against ALL existing labels near spawn point
    let tooClose = false
    for (let j = 0; j < state.labels.length; j++) {
      if (Math.abs(state.labels[j].y - bottomY) < MIN_LABEL_GAP) {
        tooClose = true
        break
      }
    }
    if (tooClose) break

    // Weighted random pick
    const allLevels: { size: number; green: boolean }[] = []
    for (const [, size] of orderbook.bids) allLevels.push({ size, green: true })
    for (const [, size] of orderbook.asks) allLevels.push({ size, green: false })

    let totalWeight = 0
    for (const l of allLevels) totalWeight += l.size
    let r = Math.random() * totalWeight
    let picked = allLevels[0]
    for (const l of allLevels) {
      r -= l.size
      if (r <= 0) { picked = l; break }
    }

    const sizeRatio = picked.size / maxSize
    state.labels.push({
      y: bottomY,
      text: `+ ${formatSize(picked.size)}`,
      green: picked.green,
      life: LABEL_LIFETIME,
      maxLife: LABEL_LIFETIME,
      intensity: 0.5 + sizeRatio * 0.5,
    })
  }

  // Update positions — decelerate as labels rise (fast at bottom, slow at top)
  const range = bottomY - topY
  let writeIdx = 0
  for (let i = 0; i < state.labels.length; i++) {
    const l = state.labels[i]
    l.life -= dtSec
    if (l.life <= 0) continue
    const yProgress = range > 0 ? (l.y - topY) / range : 1 // 1 at bottom, 0 at top
    l.y -= speed * (0.7 + 0.3 * yProgress) * dtSec
    if (l.y < topY - 14) continue
    state.labels[writeIdx++] = l
  }
  state.labels.length = writeIdx

  // Draw
  const baseAlpha = ctx.globalAlpha
  ctx.save()
  ctx.font = '600 13px "SF Mono", Menlo, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.globalAlpha = baseAlpha

  const outlineColor = `rgb(${bg[0]},${bg[1]},${bg[2]})`

  for (let i = 0; i < state.labels.length; i++) {
    const l = state.labels[i]
    const lifeRatio = l.life / l.maxLife

    // Fade in quickly, fade out near top of chart
    const fadeIn = Math.min((1 - lifeRatio) * 10, 1)
    const yRatio = (l.y - topY) / chartH
    const fadeOut = yRatio < 0.45 ? yRatio / 0.45 : 1

    const colorStrength = l.intensity * fadeIn * fadeOut
    const baseColor = l.green ? GREEN : RED
    const fillColor = mixColor(baseColor, bg, 1 - colorStrength)

    ctx.strokeStyle = outlineColor
    ctx.lineWidth = 4
    ctx.lineJoin = 'round'
    ctx.strokeText(l.text, labelX, l.y)

    ctx.fillStyle = fillColor
    ctx.fillText(l.text, labelX, l.y)
  }

  ctx.restore()
}

function formatSize(size: number): string {
  if (size >= 10) return `$${Math.round(size)}`
  if (size >= 1) return `$${size.toFixed(1)}`
  return `$${size.toFixed(2)}`
}
