import { describe, it, expect } from 'vitest'
import { drawFrame, drawMultiFrame } from '../index'
import type { DrawOptions, MultiSeriesDrawOptions } from '../index'
import { resolveTheme } from '../../theme'
import type { ChartLayout, LivelinePoint } from '../../types'

// -- helpers --

const W = 600
const H = 200
const pad = { top: 10, right: 10, bottom: 10, left: 10 }

const layout: ChartLayout = {
  w: W,
  h: H,
  pad,
  chartW: W - pad.left - pad.right,
  chartH: H - pad.top - pad.bottom,
  leftEdge: 0,
  rightEdge: 100,
  minVal: 0,
  maxVal: 100,
  valRange: 100,
  toX: (t) => pad.left + (t / 100) * (W - pad.left - pad.right),
  toY: (v) => H - pad.bottom - (v / 100) * (H - pad.top - pad.bottom),
}

const visible: LivelinePoint[] = [
  { time: 0, value: 80 },
  { time: 50, value: 60 },
  { time: 100, value: 20 },
]

function recordingContext() {
  const dashedYs = new Set<number>()
  let dash: number[] = []
  let start: [number, number] | null = null
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (prop === 'setLineDash') return (d: number[]) => { dash = d }
      if (prop === 'getLineDash') return () => dash
      if (prop === 'moveTo') return (x: number, y: number) => { start = [x, y] }
      if (prop === 'lineTo') return (x: number, y: number) => {
        if (dash.length > 0 && start && start[1] === y && start[0] === pad.left && x === W - pad.right) {
          dashedYs.add(Math.round(y))
        }
      }
      if (prop === 'measureText') return () => ({ width: 10 })
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: () => {} })
      return () => {}
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, dashedYs }
}

function frameOptions(overrides: Partial<DrawOptions>): DrawOptions {
  return {
    visible,
    smoothValue: 20,
    now: 100,
    momentum: 'flat',
    arrowState: { up: 0, down: 0 },
    showGrid: false,
    showMomentum: false,
    showPulse: false,
    showFill: false,
    showValueLine: true,
    hoverX: null,
    hoverValue: null,
    hoverTime: null,
    scrubAmount: 0,
    windowSecs: 100,
    formatValue: (v) => v.toFixed(2),
    formatTime: (t) => String(t),
    gridState: { interval: 0, labels: new Map() },
    timeAxisState: { labels: new Map() },
    dt: 16,
    targetWindowSecs: 100,
    tooltipY: 14,
    tooltipOutline: false,
    swingMagnitude: 0,
    chartReveal: 1,
    pauseProgress: 0,
    now_ms: 0,
    ...overrides,
  }
}

function multiFrameOptions(overrides: Partial<MultiSeriesDrawOptions>): MultiSeriesDrawOptions {
  const palette = resolveTheme('#3b82f6', 'dark')
  return {
    series: [
      { visible, smoothValue: 20, palette },
      { visible: visible.map((p) => ({ ...p, value: p.value / 2 })), smoothValue: 10, palette: resolveTheme('#ef4444', 'dark') },
    ],
    now: 100,
    showGrid: false,
    showPulse: false,
    showValueLine: true,
    hoverX: null,
    hoverTime: null,
    hoverEntries: [],
    scrubAmount: 0,
    windowSecs: 100,
    formatValue: (v) => v.toFixed(2),
    formatTime: (t) => String(t),
    gridState: { interval: 0, labels: new Map() },
    timeAxisState: { labels: new Map() },
    dt: 16,
    targetWindowSecs: 100,
    tooltipY: 14,
    tooltipOutline: false,
    chartReveal: 1,
    pauseProgress: 0,
    now_ms: 0,
    primaryPalette: palette,
    ...overrides,
  }
}

// -- value line --

describe('drawFrame value line', () => {
  const palette = resolveTheme('#3b82f6', 'dark')

  it('draws a dashed line at the live value by default', () => {
    const { ctx, dashedYs } = recordingContext()
    drawFrame(ctx, layout, palette, frameOptions({}))
    expect([...dashedYs]).toEqual([Math.round(layout.toY(20))])
  })

  it('skips the live value line when showValueLine is false', () => {
    const { ctx, dashedYs } = recordingContext()
    drawFrame(ctx, layout, palette, frameOptions({ showValueLine: false }))
    expect([...dashedYs]).toEqual([])
  })

  it('still draws the reference line when showValueLine is false', () => {
    const { ctx, dashedYs } = recordingContext()
    drawFrame(ctx, layout, palette, frameOptions({ showValueLine: false, referenceLine: { value: 80 } }))
    expect([...dashedYs]).toEqual([Math.round(layout.toY(80))])
  })
})

describe('drawMultiFrame value line', () => {
  it('draws a dashed line at each live value by default', () => {
    const { ctx, dashedYs } = recordingContext()
    drawMultiFrame(ctx, layout, multiFrameOptions({}))
    expect([...dashedYs].sort()).toEqual([Math.round(layout.toY(20)), Math.round(layout.toY(10))].sort())
  })

  it('skips every live value line when showValueLine is false', () => {
    const { ctx, dashedYs } = recordingContext()
    drawMultiFrame(ctx, layout, multiFrameOptions({ showValueLine: false }))
    expect([...dashedYs]).toEqual([])
  })
})
