import { describe, it, expect } from 'vitest'
import { lerp } from '../lerp'
import { computeRange } from '../range'
import { detectMomentum } from '../momentum'
import { interpolateAtTime } from '../interpolate'
import { niceTimeInterval } from '../intervals'
import type { LivelinePoint } from '../../types'

// -- lerp --

describe('lerp', () => {
  it('returns target when speed is 1', () => {
    expect(lerp(0, 100, 1, 16.67)).toBeCloseTo(100)
  })

  it('returns current when speed is 0', () => {
    expect(lerp(50, 100, 0, 16.67)).toBe(50)
  })

  it('moves toward target at default dt', () => {
    const result = lerp(0, 100, 0.1)
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(100)
    expect(result).toBeCloseTo(10, 0)
  })

  it('moves more at higher dt (lower framerate)', () => {
    const at60fps = lerp(0, 100, 0.1, 16.67)
    const at30fps = lerp(0, 100, 0.1, 33.33)
    expect(at30fps).toBeGreaterThan(at60fps)
  })

  it('converges after many frames', () => {
    let v = 0
    for (let i = 0; i < 200; i++) v = lerp(v, 100, 0.08, 16.67)
    expect(v).toBeCloseTo(100, 1)
  })
})

// -- computeRange --

describe('computeRange', () => {
  const pts = (values: number[]): LivelinePoint[] =>
    values.map((v, i) => ({ time: i, value: v }))

  it('adds margin around data', () => {
    const { min, max } = computeRange(pts([10, 20]), 15)
    expect(min).toBeLessThan(10)
    expect(max).toBeGreaterThan(20)
  })

  it('includes current value in range', () => {
    const { min, max } = computeRange(pts([10, 20]), 25)
    expect(max).toBeGreaterThan(25)
  })

  it('includes reference value in range', () => {
    const { min, max } = computeRange(pts([10, 20]), 15, 5)
    expect(min).toBeLessThan(5)
  })

  it('enforces minimum range for flat data', () => {
    const { min, max } = computeRange(pts([10, 10, 10]), 10)
    expect(max - min).toBeGreaterThan(0)
  })

  it('returns symmetric range for single-value data', () => {
    const { min, max } = computeRange(pts([50]), 50)
    const mid = (min + max) / 2
    expect(mid).toBeCloseTo(50, 1)
  })

  it('uses absolute floor only for zero-span data', () => {
    const { min, max } = computeRange(pts([10, 10]), 10)
    expect(max - min).toBeCloseTo(0.4)
  })

  it('does not force absolute floor for tiny nonzero spans', () => {
    // Forcing 0.4 for every tiny span over-pads micro volatility into a
    // flat-looking chart. Keep relative domain + margin; grid guards (#19)
    // prevent hangs when the step size is denormal.
    const rawRange = 1e-8
    const { min, max } = computeRange(pts([9, 9 + rawRange]), 9)
    expect(max - min).toBeCloseTo(rawRange * (1 + 2 * 0.12), 12)
    expect(max - min).toBeLessThan(0.4)
  })
})

// -- detectMomentum --

describe('detectMomentum', () => {
  const pts = (values: number[]): LivelinePoint[] =>
    values.map((v, i) => ({ time: i, value: v }))

  it('returns flat with fewer than 5 points', () => {
    expect(detectMomentum(pts([1, 2, 3]))).toBe('flat')
  })

  it('detects upward momentum', () => {
    expect(detectMomentum(pts([10, 11, 12, 13, 14, 15, 20]))).toBe('up')
  })

  it('detects downward momentum', () => {
    expect(detectMomentum(pts([20, 19, 18, 17, 16, 15, 10]))).toBe('down')
  })

  it('returns flat for stable data', () => {
    // Tail (last 5) delta must be < 30% of lookback range to be flat
    expect(detectMomentum(pts([10, 10.1, 10.2, 10.05, 10.15, 10.1]))).toBe('flat')
  })

  it('returns flat for all identical values', () => {
    expect(detectMomentum(pts([5, 5, 5, 5, 5, 5]))).toBe('flat')
  })
})

// -- interpolateAtTime --

describe('interpolateAtTime', () => {
  const pts: LivelinePoint[] = [
    { time: 0, value: 0 },
    { time: 1, value: 10 },
    { time: 2, value: 20 },
    { time: 3, value: 30 },
  ]

  it('returns null for empty array', () => {
    expect(interpolateAtTime([], 1)).toBeNull()
  })

  it('clamps to first value before range', () => {
    expect(interpolateAtTime(pts, -1)).toBe(0)
  })

  it('clamps to last value after range', () => {
    expect(interpolateAtTime(pts, 5)).toBe(30)
  })

  it('interpolates midpoint', () => {
    expect(interpolateAtTime(pts, 0.5)).toBeCloseTo(5)
  })

  it('returns exact value at data point', () => {
    expect(interpolateAtTime(pts, 2)).toBeCloseTo(20)
  })

  it('interpolates between non-uniform points', () => {
    const irregular: LivelinePoint[] = [
      { time: 0, value: 0 },
      { time: 10, value: 100 },
    ]
    expect(interpolateAtTime(irregular, 3)).toBeCloseTo(30)
  })
})

// -- niceTimeInterval --

describe('niceTimeInterval', () => {
  it('returns 2s for very short windows', () => {
    expect(niceTimeInterval(10)).toBe(2)
  })

  it('returns 5s for 30s window', () => {
    expect(niceTimeInterval(30)).toBe(5)
  })

  it('returns 10s for 1min window', () => {
    expect(niceTimeInterval(60)).toBe(10)
  })

  it('returns 1hr for 12hr window', () => {
    expect(niceTimeInterval(43200)).toBe(3600)
  })

  it('returns 1day for 1week window', () => {
    expect(niceTimeInterval(604800)).toBe(86400)
  })

  it('always returns a positive number', () => {
    for (const w of [1, 10, 60, 300, 3600, 86400, 604800, 999999]) {
      expect(niceTimeInterval(w)).toBeGreaterThan(0)
    }
  })
})
