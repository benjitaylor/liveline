/**
 * Shared squiggly line shape and breathing alpha used by both the loading
 * state and the chart morph transition. Keeping it in one place guarantees
 * the loading line and chart's starting shape + brightness are identical.
 */

export const LOADING_AMPLITUDE_RATIO = 0.07
export const LOADING_SCROLL_SPEED = 0.001

/**
 * Returns the squiggly Y position for a loading line.
 * @param t         Normalized x position across chart width (0–1)
 * @param centerY   Vertical center of the chart area
 * @param amplitude Wave height in pixels (chartH * LOADING_AMPLITUDE_RATIO)
 * @param scroll    Time-based scroll offset (now_ms * LOADING_SCROLL_SPEED)
 */
export function loadingY(
  t: number,
  centerY: number,
  amplitude: number,
  scroll: number,
): number {
  return centerY + amplitude * (
    Math.sin(t * 9.4 + scroll) * 0.55 +
    Math.sin(t * 15.7 + scroll * 1.3) * 0.3 +
    Math.sin(t * 4.2 + scroll * 0.7) * 0.15
  )
}

/** Breathing alpha for the loading line and chart line at reveal=0. */
export function loadingBreath(now_ms: number): number {
  return 0.22 + 0.08 * Math.sin(now_ms / 1200 * Math.PI)
}
