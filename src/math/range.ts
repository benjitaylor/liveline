import type { LivelinePoint } from '../types'

/**
 * Compute visible Y range from data points + current value.
 * Returns { min, max } with margin applied.
 */
export function computeRange(
  visible: LivelinePoint[],
  currentValue: number,
  referenceValue?: number,
  exaggerate?: boolean,
): { min: number; max: number } {
  let targetMin = Infinity
  let targetMax = -Infinity

  for (const p of visible) {
    if (p.value < targetMin) targetMin = p.value
    if (p.value > targetMax) targetMax = p.value
  }

  if (currentValue < targetMin) targetMin = currentValue
  if (currentValue > targetMax) targetMax = currentValue

  // Include reference line so it's always visible
  if (referenceValue !== undefined) {
    if (referenceValue < targetMin) targetMin = referenceValue
    if (referenceValue > targetMax) targetMax = referenceValue
  }

  const rawRange = targetMax - targetMin
  const marginFactor = exaggerate ? 0.01 : 0.12
  // `rawRange * k || floor` skipped the absolute floor for any tiny nonzero
  // span (JS || only falls through on 0/falsy), which produced denormal Y
  // domains and could freeze the Y-grid loop. Apply the floor only when the
  // span is zero / non-finite; keep relative min for real nonzero ranges.
  const relativeMin = rawRange * (exaggerate ? 0.02 : 0.1)
  const absoluteFloor = exaggerate ? 0.04 : 0.4
  const minRange =
    rawRange > 0 && Number.isFinite(rawRange) ? relativeMin : absoluteFloor

  if (rawRange < minRange) {
    const mid = (targetMin + targetMax) / 2
    targetMin = mid - minRange / 2
    targetMax = mid + minRange / 2
  } else {
    const margin = rawRange * marginFactor
    targetMin -= margin
    targetMax += margin
  }

  return { min: targetMin, max: targetMax }
}
