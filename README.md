# Liveline

Real-time animated charts for React. Line, multi-series, and candlestick modes, canvas-rendered, 60fps, zero CSS imports.

## Install

```bash
pnpm add liveline
```

Peer dependency: `react >=18`.

## Quick Start

```tsx
import { Liveline } from 'liveline'
import type { LivelinePoint } from 'liveline'

function Chart() {
  const [data, setData] = useState<LivelinePoint[]>([])
  const [value, setValue] = useState(0)

  // Feed data from WebSocket, polling, etc.
  // Each point: { time: unixSeconds, value: number }

  return (
    <div style={{ height: 300 }}>
      <Liveline data={data} value={value} color="#3b82f6" theme="dark" />
    </div>
  )
}
```

The component fills its parent container. Set a height on the parent. Pass `data` as a growing array of points and `value` as the latest number — Liveline handles smooth interpolation between updates.

## Props

**Data**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `LivelinePoint[]` | required | Array of `{ time, value }` points |
| `value` | `number` | required | Latest value (smoothly interpolated) |

**Appearance**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `theme` | `'light' \| 'dark'` | `'dark'` | Color scheme |
| `color` | `string` | `'#3b82f6'` | Accent color — all palette colors derived from this |
| `grid` | `boolean` | `true` | Y-axis grid lines + labels |
| `badge` | `boolean` | `true` | Value pill tracking chart tip |
| `badgeVariant` | `'default' \| 'minimal'` | `'default'` | Badge style: accent-colored or white with grey text |
| `badgeTail` | `boolean` | `true` | Pointed tail on badge pill |
| `fill` | `boolean` | `true` | Gradient under the curve |
| `pulse` | `boolean` | `true` | Pulsing ring on live dot |

**Features**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `momentum` | `boolean \| Momentum` | `true` | Dot glow + arrows. `true` = auto-detect, or `'up' \| 'down' \| 'flat'` |
| `scrub` | `boolean` | `true` | Crosshair scrubbing on hover |
| `exaggerate` | `boolean` | `false` | Tight Y-axis — small moves fill chart height |
| `showValue` | `boolean` | `false` | Large live value overlay (60fps DOM update, no re-renders) |
| `valueMomentumColor` | `boolean` | `false` | Color the value text green/red by momentum |
| `degen` | `boolean \| DegenOptions` | `false` | Burst particles + chart shake on momentum swings |

**Candlestick**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `mode` | `'line' \| 'candle'` | `'line'` | Chart type |
| `candles` | `CandlePoint[]` | — | OHLC candle data `{ time, open, high, low, close }` |
| `candleWidth` | `number` | — | Seconds per candle |
| `liveCandle` | `CandlePoint` | — | Current in-progress candle with real-time OHLC |
| `lineMode` | `boolean` | `false` | Morph candles into a line display |
| `lineData` | `LivelinePoint[]` | — | Tick-level data for line mode density |
| `lineValue` | `number` | — | Current tick value for line mode |
| `onModeChange` | `(mode) => void` | — | Callback for built-in line/candle toggle |

When `mode="candle"`, pass `candles` (committed OHLC bars) and `liveCandle` (the current bar, updated every tick). `candleWidth` sets the time bucket in seconds. The `lineMode` prop smoothly morphs between candle and line views — candle bodies collapse to close price, then the line extends outward. Provide `lineData` and `lineValue` (tick-level resolution) for a smooth density transition during the morph.

The `onModeChange` prop renders a built-in line/candle toggle next to the time window buttons.

**Multi-series**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `series` | `LivelineSeries[]` | — | Multiple overlapping lines `{ id, data, value, color, label? }` |
| `onSeriesToggle` | `(id, visible) => void` | — | Callback when a series is toggled via built-in chips |
| `seriesToggleCompact` | `boolean` | `false` | Show only colored dots in toggle (no text labels) |

Pass `series` instead of `data`/`value` to draw multiple lines sharing the same axes. Each series gets its own color, label, and endpoint dot. Toggle chips appear automatically when there are 2+ series — clicking one hides/shows that line with a smooth fade. The Y-axis range adjusts when series are hidden. Badge, momentum arrows, and fill are disabled in multi-series mode.

**State**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `loading` | `boolean` | `false` | Breathing line animation — use while waiting for data |
| `paused` | `boolean` | `false` | Smoothly freeze chart scrolling; resume catches up to real time |
| `emptyText` | `string` | `'No data to display'` | Text shown in the empty state |

When `loading` flips to `false` with data present, the loading line morphs into the actual chart shape. In line mode, the fill, grid, and badge animate in. In candle mode, flat lines expand into full OHLC bodies while the morph line fades out. When `data` is empty and `loading` is `false`, a minimal "No data" empty state is shown.

**Time**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `window` | `number` | `30` | Visible time window in seconds |
| `windows` | `WindowOption[]` | — | Time horizon buttons `[{ label, secs }]` |
| `onWindowChange` | `(secs) => void` | — | Called when a window button is clicked |
| `windowStyle` | `'default' \| 'rounded' \| 'text'` | `'default'` | Window button visual style |

**Crosshair**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tooltipY` | `number` | `14` | Vertical offset for crosshair tooltip text |
| `tooltipOutline` | `boolean` | `true` | Stroke outline on tooltip text for readability |

**Orderbook**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `orderbook` | `OrderbookData` | — | Bid/ask depth stream `{ bids, asks }` |

**Advanced**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `referenceLine` | `ReferenceLine` | — | Horizontal reference line `{ value, label? }` |
| `formatValue` | `(v: number) => string` | `v.toFixed(2)` | Value label formatter |
| `formatTime` | `(t: number) => string` | `HH:MM:SS` | Time axis formatter |
| `lerpSpeed` | `number` | `0.08` | Interpolation speed (0–1) |
| `padding` | `Padding` | `{ top: 12, right: 80, bottom: 28, left: 12 }` | Chart padding override |
| `onHover` | `(point \| null) => void` | — | Hover callback with `{ time, value, x, y }` |
| `cursor` | `string` | `'crosshair'` | CSS cursor on canvas hover |
| `className` | `string` | — | Container class |
| `style` | `CSSProperties` | — | Container styles |

## Examples

### Basic (line + badge)

```tsx
<Liveline data={data} value={value} color="#3b82f6" theme="dark" />
```

### Candlestick (minimal)

```tsx
<Liveline
  mode="candle"
  data={ticks}
  value={latestTick}
  candles={candles}
  candleWidth={60}
  liveCandle={liveCandle}
  color="#f7931a"
  formatValue={(v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
/>
```

### Candlestick (line mode toggle + time windows)

```tsx
<Liveline
  mode="candle"
  data={ticks}
  value={latestTick}
  candles={candles}
  candleWidth={60}
  liveCandle={liveCandle}
  lineMode={showLine}
  lineData={ticks}
  lineValue={latestTick}
  onModeChange={(mode) => setShowLine(mode === 'line')}
  color="#f7931a"
  formatValue={(v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
  windows={[
    { label: '5m', secs: 300 },
    { label: '15m', secs: 900 },
    { label: '1h', secs: 3600 },
  ]}
/>
```

### Crypto-style (momentum + degen + exaggerate)

```tsx
<Liveline
  data={data}
  value={value}
  color="#f7931a"
  exaggerate
  degen
  showValue
  valueMomentumColor
  formatValue={(v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
/>
```

### Dashboard (showValue + windows + no badge)

```tsx
<Liveline
  data={data}
  value={value}
  badge={false}
  showValue
  windows={[
    { label: '15s', secs: 15 },
    { label: '30s', secs: 30 },
    { label: '2m', secs: 120 },
    { label: '5m', secs: 300 },
  ]}
  onWindowChange={(secs) => console.log('window:', secs)}
/>
```

### Multi-series (prediction market)

```tsx
<Liveline
  data={[]}
  value={0}
  series={[
    { id: 'yes', data: yesData, value: yesValue, color: '#3b82f6', label: 'Yes' },
    { id: 'no', data: noData, value: noValue, color: '#ef4444', label: 'No' },
  ]}
  grid
  scrub
  pulse
  windowStyle="rounded"
  formatValue={(v) => v.toFixed(1) + '%'}
  onSeriesToggle={(id, visible) => console.log(id, visible)}
  windows={[
    { label: '10s', secs: 10 },
    { label: '30s', secs: 30 },
    { label: '1m', secs: 60 },
  ]}
/>
```

### Loading + pause

```tsx
<Liveline
  data={data}
  value={value}
  loading={isConnecting}
  paused={!isTabVisible}
/>
```

### Orderbook (orderbook data + particles)

```tsx
<Liveline
  data={data}
  value={value}
  color="#f7931a"
  orderbook={{ bids: [[100, 2], [99, 5]], asks: [[101, 3], [102, 4]] }}
  degen
  showValue
/>
```

## How It Works

- **Canvas rendering** — single `<canvas>` element, no DOM nodes per data point
- **requestAnimationFrame** loop pauses when the tab is hidden
- **Fritsch-Carlson monotone splines** for smooth curves — no overshoots beyond local min/max
- **Frame-rate-independent lerp** on value, Y-axis range, badge color, and scrub opacity
- **Candlestick rendering** — OHLC bodies + wicks with bull/bear coloring, smooth live candle updates
- **Line/candle morph** — candle bodies collapse to close price, morph line extends center-out, coordinated alpha crossfade
- **Multi-series** — overlapping lines with per-series toggle, smooth alpha fade, and dynamic Y-axis range
- **ResizeObserver** tracks container size — no per-frame layout reads
- **Theme derivation** — full palette from one accent color + light/dark mode
- **Binary search interpolation** for hover value lookup

No CSS imports. No external dependencies beyond React.

## License

© 2026 Benji Taylor

Licensed under MIT
