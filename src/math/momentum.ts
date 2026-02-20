import type { Momentum, LivelinePoint } from '../types'

/**
 * Auto-detect momentum from recent data points.
 * Only triggers during active movement — checks the last few points,
 * not the total delta over the full lookback window.
 */
export function detectMomentum(points: LivelinePoint[], lookback = 20): Momentum {
  if (points.length < 5) return 'flat'

  const start = Math.max(0, points.length - lookback)

  // Range of the full lookback for threshold calculation
  let min = Infinity
  let max = -Infinity
  for (let i = start; i < points.length; i++) {
    const v = points[i].value
    if (v < min) min = v
    if (v > max) max = v
  }
  const range = max - min
  if (range === 0) return 'flat'

  // Only look at the last 5 points for active velocity
  const tailStart = Math.max(start, points.length - 5)
  const first = points[tailStart].value
  const last = points[points.length - 1].value
  const delta = last - first

  const threshold = range * 0.12

  if (delta > threshold) return 'up'
  if (delta < -threshold) return 'down'
  return 'flat'
}
