import type { CandlePoint, LivelinePoint } from '../src'

export type Volatility = 'calm' | 'normal' | 'spiky'

export const VOLATILITIES: Volatility[] = ['calm', 'normal', 'spiky']

export const TIME_WINDOWS = [
  { label: '15s', secs: 15 },
  { label: '30s', secs: 30 },
  { label: '2m', secs: 120 },
  { label: '5m', secs: 300 },
]

export const TICK_RATES = [
  { label: '80ms', ms: 80 },
  { label: '200ms', ms: 200 },
  { label: '500ms', ms: 500 },
]

export const CANDLE_WIDTHS = [
  { label: '2s', secs: 2 },
  { label: '5s', secs: 5 },
  { label: '10s', secs: 10 },
]

export function generatePoint(
  previousValue: number,
  time: number,
  volatility: Volatility,
  baseValue = 100,
): LivelinePoint {
  const movement = { calm: 0.12, normal: 0.65, spiky: 1.8 }[volatility] * (baseValue / 100)
  const bias = { calm: 0.49, normal: 0.48, spiky: 0.46 }[volatility]
  const spike =
    volatility === 'spiky' && Math.random() < 0.08
      ? (Math.random() - 0.5) * movement * 4
      : 0
  const delta = (Math.random() - bias) * movement + spike
  return { time, value: previousValue + delta }
}

export function seedLine(
  startValue: number,
  seconds: number,
  intervalSeconds: number,
  volatility: Volatility,
): LivelinePoint[] {
  const now = Date.now() / 1000
  const points: LivelinePoint[] = []
  let value = startValue

  for (let i = seconds / intervalSeconds; i >= 0; i--) {
    const point = generatePoint(value, now - i * intervalSeconds, volatility, startValue)
    points.push(point)
    value = point.value
  }

  return points
}

export function aggregateCandles(
  ticks: LivelinePoint[],
  widthSeconds: number,
): { candles: CandlePoint[]; live: CandlePoint | null } {
  if (ticks.length === 0) return { candles: [], live: null }

  const candles: CandlePoint[] = []
  let slot = Math.floor(ticks[0].time / widthSeconds) * widthSeconds
  let open = ticks[0].value
  let high = open
  let low = open
  let close = open

  for (let i = 1; i < ticks.length; i++) {
    const tick = ticks[i]
    if (tick.time >= slot + widthSeconds) {
      candles.push({ time: slot, open, high, low, close })
      slot = Math.floor(tick.time / widthSeconds) * widthSeconds
      open = tick.value
      high = open
      low = open
      close = open
      continue
    }

    close = tick.value
    if (close > high) high = close
    if (close < low) low = close
  }

  return {
    candles,
    live: { time: slot, open, high, low, close },
  }
}
