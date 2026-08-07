import { describe, it, expect } from 'vitest'
import { pickInterval } from '../grid'

describe('pickInterval', () => {
  it('returns a finite default for non-positive ranges', () => {
    expect(pickInterval(0, 100, 36, 0)).toBe(1)
    expect(pickInterval(-1, 100, 36, 0)).toBe(1)
    expect(pickInterval(Number.NaN, 100, 36, 0)).toBe(1)
  })

  it('returns a finite default for non-positive pxPerUnit', () => {
    expect(pickInterval(10, 0, 36, 0)).toBe(2)
    expect(pickInterval(10, -1, 36, 0)).toBe(2)
  })

  it('terminates for tiny valRange (no hang)', () => {
    const started = Date.now()
    const interval = pickInterval(1e-20, 1e20, 36, 0)
    expect(Date.now() - started).toBeLessThan(100)
    expect(Number.isFinite(interval)).toBe(true)
    expect(interval).toBeGreaterThan(0)
  })

  it('keeps a previous interval within hysteresis', () => {
    // prev * pxPerUnit = 50, within [18, 144] for minGap 36
    expect(pickInterval(10, 100, 36, 0.5)).toBe(0.5)
  })
})
