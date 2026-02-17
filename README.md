# Liveline

Real-time animated line chart for React. Canvas-rendered, 60fps, zero CSS imports.

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
- **Catmull-Rom splines** for smooth curves through data points
- **Frame-rate-independent lerp** on value, Y-axis range, badge color, and scrub opacity
- **ResizeObserver** tracks container size — no per-frame layout reads
- **Theme derivation** — full palette from one accent color + light/dark mode
- **Binary search interpolation** for hover value lookup

No CSS imports. No external dependencies beyond React.

## License

© 2026 Benji Taylor

Licensed under MIT
