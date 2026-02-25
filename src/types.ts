import type { CSSProperties } from 'react'

export interface LivelinePoint {
  time: number  // unix seconds
  value: number
}

export type Momentum = 'up' | 'down' | 'flat'
export type ThemeMode = 'light' | 'dark'
export type WindowStyle = 'default' | 'rounded' | 'text'
export type BadgeVariant = 'default' | 'minimal'

export interface ReferenceLine {
  value: number
  label?: string
}

export interface HoverPoint {
  time: number
  value: number
  x: number
  y: number
}

export interface Padding {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export interface WindowOption {
  label: string
  secs: number
}

export interface OrderbookData {
  bids: [number, number][]  // [price, size][]
  asks: [number, number][]  // [price, size][]
}

export interface DegenOptions {
  /** Multiplier for particle count and size (default 1) */
  scale?: number
  /** Show particles on down-momentum swings (default false) */
  downMomentum?: boolean
}

export interface LivelineSeries {
  id: string
  data: LivelinePoint[]
  value: number
  color: string
  label?: string
}

export interface LivelineProps {
  data: LivelinePoint[]
  value: number

  // Multi-series mode — when provided, overrides data/value/color
  series?: LivelineSeries[]

  // Appearance
  theme?: ThemeMode
  color?: string

  // Time
  window?: number

  // Feature flags
  grid?: boolean
  badge?: boolean
  momentum?: boolean | Momentum
  fill?: boolean
  loading?: boolean         // Show loading animation — breathing line (default: false)
  paused?: boolean          // Pause chart scrolling (default: false)
  emptyText?: string        // Text shown in the empty state (default: 'No data to display')
  scrub?: boolean           // Enable crosshair scrubbing on hover (default: true)
  exaggerate?: boolean      // Tight Y-axis range — small moves fill chart height (default: false)
  showValue?: boolean       // Show live value as DOM text overlay (default: false)
  valueMomentumColor?: boolean // Color the value text by momentum — green/red (default: false)
  degen?: boolean | DegenOptions  // Degen mode — burst particles + chart shake on momentum swings (default: false)
  badgeTail?: boolean       // Show pointed tail on badge pill (default: true)

  // Time window buttons
  windows?: WindowOption[]
  onWindowChange?: (secs: number) => void
  windowStyle?: WindowStyle

  // Badge
  badgeVariant?: BadgeVariant  // Badge visual style: 'default' (accent) or 'minimal' (white + grey text)

  // Crosshair
  tooltipY?: number        // Vertical offset for crosshair tooltip text (default: 14)
  tooltipOutline?: boolean // Stroke outline around crosshair tooltip text for readability (default: true)

  // Orderbook
  orderbook?: OrderbookData

  // Optional
  referenceLine?: ReferenceLine
  formatValue?: (v: number) => string
  formatTime?: (t: number) => string
  lerpSpeed?: number
  padding?: Padding
  onHover?: (point: HoverPoint | null) => void
  cursor?: string          // CSS cursor on hover (default: 'crosshair')
  pulse?: boolean          // Pulsing ring on live dot (default: true)

  // Candlestick mode
  mode?: 'line' | 'candle'       // Chart type (default: 'line')
  candles?: CandlePoint[]         // OHLC candle data (required when mode='candle')
  candleWidth?: number            // Seconds per candle (required when mode='candle')
  liveCandle?: CandlePoint        // Current live candle with real-time OHLC
  lineMode?: boolean              // Morph candles into line display
  lineData?: LivelinePoint[]      // Tick-level data for density transition
  lineValue?: number              // Current tick value for density transition
  onModeChange?: (mode: 'line' | 'candle') => void  // Built-in toggle callback
  onSeriesToggle?: (id: string, visible: boolean) => void  // Multi-series toggle callback
  seriesToggleCompact?: boolean  // Show only colored dots (no labels) in series toggle (default: false)

  className?: string
  style?: CSSProperties
}

export interface CandlePoint {
  time: number   // unix seconds — candle open time
  open: number
  high: number
  low: number
  close: number
}

export interface LivelinePalette {
  // Line
  line: string
  lineWidth: number

  // Fill gradient
  fillTop: string
  fillBottom: string

  // Grid
  gridLine: string
  gridLabel: string

  // Dot
  dotUp: string
  dotDown: string
  dotFlat: string
  glowUp: string
  glowDown: string
  glowFlat: string

  // Badge
  badgeOuterBg: string
  badgeOuterShadow: string
  badgeBg: string
  badgeText: string

  // Dash line
  dashLine: string

  // Reference line
  refLine: string
  refLabel: string

  // Time axis
  timeLabel: string

  // Crosshair
  crosshairLine: string
  tooltipBg: string
  tooltipText: string
  tooltipBorder: string

  // Background (for color fading — labels fade toward bg instead of alpha)
  bgRgb: [number, number, number]

  // Fonts
  labelFont: string
  valueFont: string
  badgeFont: string
}

export interface ChartLayout {
  w: number
  h: number
  pad: Required<Padding>
  chartW: number
  chartH: number
  leftEdge: number
  rightEdge: number
  minVal: number
  maxVal: number
  valRange: number
  toX: (t: number) => number
  toY: (v: number) => number
}
