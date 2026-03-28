# liveline-svelte

`liveline-svelte` is a standalone Svelte fork of the original [liveline](https://github.com/benjitaylor/liveline) project by Benji Taylor, maintained by VastBlast.

Real-time animated charts for Svelte. Line, multi-series, and candlestick modes, canvas-rendered, 60fps, no CSS imports.

## Install

```bash
pnpm add liveline-svelte
```

Peer dependency: `svelte ^5`.

## Quick Start

```svelte
<script lang="ts">
  import { Liveline } from 'liveline-svelte'
  import type { LivelinePoint } from 'liveline-svelte'

  let data: LivelinePoint[] = []
  let value = 0
</script>

<div style="height: 320px;">
  <Liveline data={data} {value} color="#3b82f6" theme="dark" />
</div>
```

The component fills its parent container. Set a height on the parent, then pass a growing `data` array and the latest `value`. Liveline handles the interpolation and drawing loop internally.

## Props

Any standard `div` attributes such as `class`, `style`, `id`, `data-*`, or `aria-*` are forwarded to the root container.

### Data

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `LivelinePoint[]` | required | Array of `{ time, value }` points |
| `value` | `number` | required | Latest value |

### Appearance

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `theme` | `'light' \| 'dark'` | `'dark'` | Color scheme |
| `color` | `string` | `'#3b82f6'` | Accent color used to derive the palette |
| `grid` | `boolean` | `true` | Y-axis grid lines and labels |
| `badge` | `boolean` | `true` | Value pill tracking the chart tip |
| `badgeVariant` | `'default' \| 'minimal'` | `'default'` | Accent badge or neutral badge |
| `badgeTail` | `boolean` | `true` | Pointed tail on the badge pill |
| `fill` | `boolean` | `true` | Gradient under the curve |
| `pulse` | `boolean` | `true` | Pulsing ring on the live dot |
| `lineWidth` | `number` | `2` | Main line width in pixels |

### Features

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `momentum` | `boolean \| Momentum` | `true` | Dot glow and arrows. `true` auto-detects, or pass `'up' \| 'down' \| 'flat'` |
| `scrub` | `boolean` | `true` | Crosshair scrubbing on hover |
| `exaggerate` | `boolean` | `false` | Tight Y-axis range so smaller moves fill more height |
| `showValue` | `boolean` | `false` | Large live value overlay |
| `valueMomentumColor` | `boolean` | `false` | Colors the value overlay by momentum |
| `degen` | `boolean \| DegenOptions` | `false` | Particle bursts and shake on strong swings |

### Candlestick

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `mode` | `'line' \| 'candle'` | `'line'` | Chart type |
| `candles` | `CandlePoint[]` | — | Committed OHLC candles |
| `candleWidth` | `number` | — | Seconds per candle |
| `liveCandle` | `CandlePoint` | — | Current in-progress candle |
| `lineMode` | `boolean` | `false` | Morph candles toward a line view |
| `lineData` | `LivelinePoint[]` | — | Tick-level data for density blending in line mode |
| `lineValue` | `number` | — | Current tick value for line mode |
| `onModeChange` | `(mode) => void` | — | Callback for the built-in candle/line toggle |

When `mode="candle"`, pass `candles`, `liveCandle`, and `candleWidth`. If you also pass `lineMode`, `lineData`, and `lineValue`, Liveline smoothly morphs candle bodies into a denser line representation.

### Multi-series

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `series` | `LivelineSeries[]` | — | Overlapping line series `{ id, data, value, color, label? }` |
| `onSeriesToggle` | `(id, visible) => void` | — | Called when a built-in series chip is toggled |
| `seriesToggleCompact` | `boolean` | `false` | Dot-only series toggle chips |

When `series` is provided, Liveline disables single-series badge, fill, and momentum affordances automatically.

### State

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `loading` | `boolean` | `false` | Shows the breathing loading line |
| `paused` | `boolean` | `false` | Freezes scrolling while preserving visual continuity |
| `emptyText` | `string` | `'No data to display'` | Empty-state label |

### Time

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `window` | `number` | `30` | Visible time window in seconds |
| `windows` | `WindowOption[]` | — | Built-in time horizon buttons |
| `onWindowChange` | `(secs) => void` | — | Called when a horizon button is clicked |
| `windowStyle` | `'default' \| 'rounded' \| 'text'` | `'default'` | Time-button visual style |

### Crosshair

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tooltipY` | `number` | `14` | Tooltip vertical offset |
| `tooltipOutline` | `boolean` | `true` | Stroke outline on tooltip text |

### Orderbook

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `orderbook` | `OrderbookData` | — | Bid/ask depth data `{ bids, asks }` |

### Advanced

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `referenceLine` | `ReferenceLine` | — | Horizontal reference line `{ value, label? }` |
| `formatValue` | `(v: number) => string` | `v.toFixed(2)` | Value formatter |
| `formatTime` | `(t: number) => string` | `HH:MM:SS` | Time formatter |
| `lerpSpeed` | `number` | `0.08` | Interpolation speed |
| `padding` | `Padding` | `{ top: 12, right: auto, bottom: 28, left: 12 }` | Chart padding override |
| `onHover` | `(point \| null) => void` | — | Hover callback with `{ time, value, x, y }` |
| `cursor` | `string` | `'crosshair'` | Canvas hover cursor |

## Examples

### Basic line

```svelte
<script lang="ts">
  import { Liveline } from 'liveline-svelte'
  import type { LivelinePoint } from 'liveline-svelte'

  let data: LivelinePoint[] = []
  let value = 0
</script>

<div style="height: 300px;">
  <Liveline data={data} {value} color="#3b82f6" theme="dark" />
</div>
```

### Candlestick with built-in line toggle

```svelte
<script lang="ts">
  import { Liveline } from 'liveline-svelte'
  import type { CandlePoint, LivelinePoint } from 'liveline-svelte'

  let ticks: LivelinePoint[] = []
  let value = 0
  let candles: CandlePoint[] = []
  let liveCandle: CandlePoint | null = null
  let lineMode = true
</script>

<div style="height: 360px;">
  <Liveline
    data={ticks}
    {value}
    mode="candle"
    {candles}
    candleWidth={60}
    {liveCandle}
    {lineMode}
    lineData={ticks}
    lineValue={value}
    onModeChange={(mode) => (lineMode = mode === 'line')}
    color="#f97316"
    formatValue={(amount) =>
      `$${amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`
    }
  />
</div>
```

### Multi-series

```svelte
<script lang="ts">
  import { Liveline } from 'liveline-svelte'
  import type { LivelinePoint, LivelineSeries } from 'liveline-svelte'

  let alpha: LivelinePoint[] = []
  let beta: LivelinePoint[] = []
  let alphaValue = 0
  let betaValue = 0

  let series: LivelineSeries[] = [
    { id: 'alpha', label: 'Alpha', data: alpha, value: alphaValue, color: '#3b82f6' },
    { id: 'beta', label: 'Beta', data: beta, value: betaValue, color: '#f97316' }
  ]
</script>

<div style="height: 320px;">
  <Liveline data={alpha} value={alphaValue} {series} />
</div>
```

### Transitioning between chart scenes

`LivelineTransition` uses a Svelte snippet instead of React-style keyed children:

```svelte
<script lang="ts">
  import { Liveline, LivelineTransition } from 'liveline-svelte'

  let active: 'line' | 'candle' = 'line'
  let data = []
  let value = 0
  let candles = []
  let liveCandle = null
</script>

<div style="height: 360px;">
  <LivelineTransition {active}>
    {#snippet children(key)}
      {#if key === 'line'}
        <Liveline {data} {value} color="#22c55e" />
      {:else if key === 'candle'}
        <Liveline
          {data}
          {value}
          mode="candle"
          {candles}
          candleWidth={60}
          {liveCandle}
          color="#f97316"
        />
      {/if}
    {/snippet}
  </LivelineTransition>
</div>
```

## Notes

- Liveline ships as a Svelte 5 component library and forwards standard root `div` attributes.
- The package has no runtime dependencies beyond `svelte`.
- The drawing engine stays framework-neutral and runs outside Svelte’s templating work, which keeps updates cheap even under rapid tick streams.
- This repository is the independently maintained `liveline-svelte` fork by VastBlast, based on the original Liveline work by Benji Taylor.
