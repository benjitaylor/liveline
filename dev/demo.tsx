import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { Liveline } from 'liveline'
import type { LivelinePoint, CandlePoint, BarPoint } from 'liveline'

// --- Data generators ---

type Volatility = 'calm' | 'normal' | 'spiky' | 'chaos'

function generatePoint(prev: number, time: number, volatility: Volatility, baseValue = 100): LivelinePoint {
  const v: Record<Volatility, number> = { calm: 0.15, normal: 0.8, spiky: 3, chaos: 8 }
  const bias: Record<Volatility, number> = { calm: 0.49, normal: 0.48, spiky: 0.47, chaos: 0.45 }
  const priceScale = baseValue / 100
  const scale = v[volatility] * priceScale
  const spike = (volatility === 'spiky' || volatility === 'chaos') && Math.random() < 0.08
    ? (Math.random() - 0.5) * scale * 3
    : 0
  const delta = (Math.random() - bias[volatility]) * scale + spike
  return { time, value: prev + delta }
}

/** Aggregate tick data into OHLC candles by time bucket. */
function aggregateCandles(ticks: LivelinePoint[], width: number): { candles: CandlePoint[]; live: CandlePoint | null } {
  if (ticks.length === 0) return { candles: [], live: null }
  const candles: CandlePoint[] = []
  let slot = Math.floor(ticks[0].time / width) * width
  let o = ticks[0].value, h = o, l = o, c = o
  for (let i = 1; i < ticks.length; i++) {
    const t = ticks[i]
    if (t.time >= slot + width) {
      candles.push({ time: slot, open: o, high: h, low: l, close: c })
      slot = Math.floor(t.time / width) * width
      o = t.value; h = o; l = o; c = o
    } else {
      c = t.value
      if (c > h) h = c
      if (c < l) l = c
    }
  }
  return { candles, live: { time: slot, open: o, high: h, low: l, close: c } }
}

/** Generate initial volume bars from seed data */
function generateBars(data: LivelinePoint[], bucketSecs: number): BarPoint[] {
  if (data.length === 0) return []
  const bars: BarPoint[] = []
  const startTime = Math.floor(data[0].time / bucketSecs) * bucketSecs
  let bucketStart = startTime
  let bucketVolume = 0
  let prevValue = data[0].value
  for (const pt of data) {
    while (pt.time >= bucketStart + bucketSecs) {
      if (bucketVolume > 0) bars.push({ time: bucketStart, value: bucketVolume })
      bucketStart += bucketSecs
      bucketVolume = 0
    }
    const change = Math.abs(pt.value - prevValue)
    bucketVolume += 10 + change * 20 + Math.random() * 5
    prevValue = pt.value
  }
  if (bucketVolume > 0) bars.push({ time: bucketStart, value: bucketVolume })
  return bars
}

/** Incrementally update bars with a new data point — only touches the last bucket */
function addTickToBars(bars: BarPoint[], pt: LivelinePoint, prevValue: number, bucketSecs: number): BarPoint[] {
  const bucketStart = Math.floor(pt.time / bucketSecs) * bucketSecs
  const change = Math.abs(pt.value - prevValue)
  const volume = 10 + change * 20 + Math.random() * 5
  if (bars.length === 0 || bars[bars.length - 1].time < bucketStart) {
    return [...bars, { time: bucketStart, value: volume }]
  }
  const updated = bars.slice()
  const last = updated[updated.length - 1]
  updated[updated.length - 1] = { time: last.time, value: last.value + volume }
  return updated
}

// --- Constants ---

const TIME_WINDOWS = [
  { label: '10s', secs: 10 },
  { label: '30s', secs: 30 },
  { label: '1m', secs: 60 },
  { label: '5m', secs: 300 },
]

const CRYPTO_WINDOWS = [
  { label: '5m', secs: 300 },
  { label: '15m', secs: 900 },
  { label: '1h', secs: 3600 },
]

const TICK_RATES: { label: string; ms: number }[] = [
  { label: '50ms', ms: 50 },
  { label: '100ms', ms: 100 },
  { label: '300ms', ms: 300 },
  { label: '1s', ms: 1000 },
]

const VOLATILITIES: Volatility[] = ['calm', 'normal', 'spiky', 'chaos']

const CANDLE_WIDTHS = [
  { label: '1s', secs: 1 },
  { label: '2s', secs: 2 },
  { label: '5s', secs: 5 },
  { label: '10s', secs: 10 },
]

type Preset = 'dev' | 'crypto'

const formatCrypto = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// --- Demo ---

function Demo() {
  const [preset, setPreset] = useState<Preset>('dev')
  const [data, setData] = useState<LivelinePoint[]>([])
  const [value, setValue] = useState(100)
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)
  const [scenario, setScenario] = useState<'loading' | 'loading-hold' | 'live' | 'empty'>('loading')

  const [windowSecs, setWindowSecs] = useState(30)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [grid, setGrid] = useState(true)
  const [scrub, setScrub] = useState(true)

  const [volatility, setVolatility] = useState<Volatility>('normal')
  const [tickRate, setTickRate] = useState(300)
  const [bars, setBars] = useState<BarPoint[]>([])
  const [barMode, setBarMode] = useState<'default' | 'overlay'>('default')
  const [barLabels, setBarLabels] = useState(false)
  const barBucketSecs = 2

  const [chartType, setChartType] = useState<'line' | 'candle'>('candle')
  const [candleSecs, setCandleSecs] = useState(2)
  const [candles, setCandles] = useState<CandlePoint[]>([])
  const [liveCandle, setLiveCandle] = useState<CandlePoint | null>(null)

  const candleSecsRef = useRef(candleSecs)
  candleSecsRef.current = candleSecs
  const [startValue, setStartValue] = useState(100)
  const lastValueRef = useRef(100)
  const liveCandleRef = useRef<CandlePoint | null>(null)
  const dataRef = useRef<LivelinePoint[]>([])
  const intervalRef = useRef<number>(0)
  const volatilityRef = useRef(volatility)
  volatilityRef.current = volatility
  const startValueRef = useRef(startValue)
  startValueRef.current = startValue
  // Tick buffer covers widest window: crypto 1h=3600 ticks, dev 5m≈1000 ticks
  const maxTicksRef = useRef(1200)

  const tickAndAggregate = (pt: LivelinePoint) => {
    const width = candleSecsRef.current
    const lc = liveCandleRef.current
    if (!lc) {
      const slot = Math.floor(pt.time / width) * width
      liveCandleRef.current = { time: slot, open: pt.value, high: pt.value, low: pt.value, close: pt.value }
      setLiveCandle({ ...liveCandleRef.current })
    } else if (pt.time >= lc.time + width) {
      const committed = { ...lc }
      setCandles(prev => {
        const next = [...prev, committed]
        return next.length > maxTicksRef.current ? next.slice(-maxTicksRef.current) : next
      })
      const slot = Math.floor(pt.time / width) * width
      liveCandleRef.current = { time: slot, open: pt.value, high: pt.value, low: pt.value, close: pt.value }
      setLiveCandle({ ...liveCandleRef.current })
    } else {
      lc.close = pt.value
      if (pt.value > lc.high) lc.high = pt.value
      if (pt.value < lc.low) lc.low = pt.value
      setLiveCandle({ ...lc })
    }
  }

  const startLive = useCallback(() => {
    clearInterval(intervalRef.current)
    setLoading(false)

    const now = Date.now() / 1000
    const base = startValueRef.current
    const isCrypto = base > 1000
    const seedTickInterval = isCrypto ? 1 : 0.3
    // Cover the widest time window with margin: crypto 1h=3600s, dev 5m=300s
    const seedCount = isCrypto ? 3800 : 500
    const seed: LivelinePoint[] = []
    let v = base
    for (let i = seedCount; i >= 0; i--) {
      const pt = generatePoint(v, now - i * seedTickInterval, volatilityRef.current, base)
      seed.push(pt)
      v = pt.value
    }
    setData(seed)
    dataRef.current = seed
    setValue(v)
    lastValueRef.current = v

    const agg = aggregateCandles(seed, candleSecsRef.current)
    setCandles(agg.candles)
    setLiveCandle(agg.live)
    liveCandleRef.current = agg.live ? { ...agg.live } : null
    setBars(generateBars(seed, barBucketSecs))

    intervalRef.current = window.setInterval(() => {
      const now = Date.now() / 1000
      const prevVal = lastValueRef.current
      const pt = generatePoint(prevVal, now, volatilityRef.current, startValueRef.current)
      lastValueRef.current = pt.value
      setValue(pt.value)
      setData(prev => {
        const next = [...prev, pt]
        const trimmed = next.length > maxTicksRef.current ? next.slice(-maxTicksRef.current) : next
        dataRef.current = trimmed
        return trimmed
      })
      tickAndAggregate(pt)
      setBars(prev => addTickToBars(prev, pt, prevVal, barBucketSecs))
    }, tickRate)
  }, [tickRate])

  useEffect(() => {
    if (scenario === 'loading') {
      setLoading(true)
      setData([]); dataRef.current = []
      setCandles([]); setLiveCandle(null); liveCandleRef.current = null; setBars([])
      clearInterval(intervalRef.current)
      const timer = setTimeout(() => setScenario('live'), 3000)
      return () => clearTimeout(timer)
    }

    if (scenario === 'loading-hold') {
      setLoading(true)
      setData([]); dataRef.current = []
      setCandles([]); setLiveCandle(null); liveCandleRef.current = null; setBars([])
      clearInterval(intervalRef.current)
      return
    }

    if (scenario === 'empty') {
      setLoading(false)
      setData([]); dataRef.current = []
      setCandles([]); setLiveCandle(null); liveCandleRef.current = null; setBars([])
      clearInterval(intervalRef.current)
      return
    }

    startLive()
    return () => clearInterval(intervalRef.current)
  }, [scenario, startLive])

  useEffect(() => {
    if (scenario !== 'live') return
    clearInterval(intervalRef.current)
    intervalRef.current = window.setInterval(() => {
      const now = Date.now() / 1000
      const prevVal = lastValueRef.current
      const pt = generatePoint(prevVal, now, volatilityRef.current, startValueRef.current)
      lastValueRef.current = pt.value
      setValue(pt.value)
      setData(prev => {
        const next = [...prev, pt]
        const trimmed = next.length > maxTicksRef.current ? next.slice(-maxTicksRef.current) : next
        dataRef.current = trimmed
        return trimmed
      })
      tickAndAggregate(pt)
      setBars(prev => addTickToBars(prev, pt, prevVal, barBucketSecs))
    }, tickRate)
    return () => clearInterval(intervalRef.current)
  }, [tickRate, scenario])

  useEffect(() => {
    if (scenario !== 'live' || dataRef.current.length === 0) return
    const agg = aggregateCandles(dataRef.current, candleSecs)
    setCandles(agg.candles)
    setLiveCandle(agg.live)
    liveCandleRef.current = agg.live ? { ...agg.live } : null
  }, [candleSecs, scenario])

  // Preset switch — reset all dependent state
  useEffect(() => {
    if (preset === 'crypto') {
      setStartValue(65000)
      startValueRef.current = 65000
      setTickRate(1000)
      setCandleSecs(60)
      candleSecsRef.current = 60
      setWindowSecs(300)
      setVolatility('calm')
      setChartType('candle')
      maxTicksRef.current = 4000 // covers 1h window at 1 tick/sec
    } else {
      setStartValue(100)
      startValueRef.current = 100
      setTickRate(300)
      setCandleSecs(2)
      candleSecsRef.current = 2
      setWindowSecs(30)
      setVolatility('normal')
      setChartType('candle')
      maxTicksRef.current = 1200 // covers 5m window at ~3 ticks/sec
    }
    // Force re-seed by cycling to loading
    setData([]); dataRef.current = []
    setCandles([]); setLiveCandle(null); liveCandleRef.current = null; setBars([])
    lastValueRef.current = preset === 'crypto' ? 65000 : 100
    clearInterval(intervalRef.current)
    setLoading(true)
    setScenario('loading')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  const isDark = theme === 'dark'
  const fgBase = isDark ? '255,255,255' : '0,0,0'
  const pageBg = isDark ? '#111' : '#f5f5f5'

  return (
    <div style={{
      padding: 32, maxWidth: 960, margin: '0 auto',
      color: isDark ? '#fff' : '#111',
      background: pageBg,
      minHeight: '100vh',
      transition: 'background 0.3s, color 0.3s',
      '--fg-02': `rgba(${fgBase},0.02)`,
      '--fg-06': `rgba(${fgBase},0.06)`,
      '--fg-08': `rgba(${fgBase},0.08)`,
      '--fg-20': `rgba(${fgBase},0.2)`,
      '--fg-25': `rgba(${fgBase},0.25)`,
      '--fg-30': `rgba(${fgBase},0.3)`,
      '--fg-35': `rgba(${fgBase},0.35)`,
      '--fg-45': `rgba(${fgBase},0.45)`,
    } as React.CSSProperties}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>
        Liveline Candlestick
      </h1>
      <p style={{ fontSize: 12, color: 'var(--fg-30)', marginBottom: 20 }}>Candlestick chart with line mode morph</p>

      <Section label="Preset">
        <Btn active={preset === 'dev'} onClick={() => setPreset('dev')}>Dev</Btn>
        <Btn active={preset === 'crypto'} onClick={() => setPreset('crypto')}>Crypto</Btn>
      </Section>

      <Section label="State">
        <Btn active={scenario === 'loading'} onClick={() => setScenario('loading')}>Loading → Live</Btn>
        <Btn active={scenario === 'loading-hold'} onClick={() => setScenario('loading-hold')}>Loading</Btn>
        <Btn active={scenario === 'live'} onClick={() => setScenario('live')}>Live</Btn>
        <Btn active={scenario === 'empty'} onClick={() => setScenario('empty')}>No Data</Btn>
        <Sep />
        <Btn active={paused} onClick={() => setPaused(p => !p)}>
          {paused ? '▶ Play' : '⏸ Pause'}
        </Btn>
      </Section>

      <Section label="Chart">
        <Btn active={chartType === 'candle'} onClick={() => setChartType('candle')}>Candle</Btn>
        <Btn active={chartType === 'line'} onClick={() => setChartType('line')}>Line</Btn>
        <Sep />
        <Label text="Width">
          {CANDLE_WIDTHS.map(cw => (
            <Btn key={cw.secs} active={candleSecs === cw.secs} onClick={() => setCandleSecs(cw.secs)}>{cw.label}</Btn>
          ))}
        </Label>
      </Section>

      <Section label="Data">
        <Label text="Volatility">
          {VOLATILITIES.map(v => (
            <Btn key={v} active={volatility === v} onClick={() => setVolatility(v)}>{v}</Btn>
          ))}
        </Label>
        <Sep />
        <Label text="Tick rate">
          {TICK_RATES.map(t => (
            <Btn key={t.ms} active={tickRate === t.ms} onClick={() => setTickRate(t.ms)}>{t.label}</Btn>
          ))}
        </Label>
      </Section>

      <Section label="Window">
        {TIME_WINDOWS.map(w => (
          <Btn key={w.secs} active={windowSecs === w.secs} onClick={() => setWindowSecs(w.secs)}>
            {w.label}
          </Btn>
        ))}
      </Section>

      <Section label="Features">
        <Btn active={theme === 'dark'} onClick={() => setTheme('dark')}>Dark</Btn>
        <Btn active={theme === 'light'} onClick={() => setTheme('light')}>Light</Btn>
        <Sep />
        <Toggle on={grid} onToggle={setGrid}>Grid</Toggle>
        <Toggle on={scrub} onToggle={setScrub}>Scrub</Toggle>
      </Section>

      {/* Main chart */}
      <div style={{
        height: 320,
        background: 'var(--fg-02)',
        borderRadius: 12,
        border: '1px solid var(--fg-06)',
        padding: 8,
        overflow: 'hidden',
        marginTop: 16,
      }}>
        <Liveline
          mode="candle"
          data={data}
          value={value}
          candles={candles}
          candleWidth={candleSecs}
          liveCandle={liveCandle ?? undefined}
          lineMode={chartType === 'line'}
          lineData={data}
          lineValue={value}
          loading={loading}
          paused={paused}
          theme={theme}
          color={preset === 'crypto' ? '#f7931a' : undefined}
          window={windowSecs}
          windows={preset === 'crypto' ? CRYPTO_WINDOWS : undefined}
          formatValue={preset === 'crypto' ? formatCrypto : undefined}
          onModeChange={(mode) => setChartType(mode)}
          grid={grid}
          scrub={scrub}
        />
      </div>

      {/* Size variants */}
      <p style={{ fontSize: 12, color: 'var(--fg-30)', marginTop: 24, marginBottom: 8 }}>Size variants</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { w: 320, h: 180, label: '320×180' },
          { w: 240, h: 120, label: '240×120' },
          { w: 160, h: 100, label: '160×100' },
          { w: 120, h: 80, label: '120×80' },
        ].map(size => (
          <div key={size.label}>
            <span style={{ fontSize: 10, color: 'var(--fg-25)', display: 'block', marginBottom: 4 }}>
              {size.label}
            </span>
            <div style={{
              width: size.w,
              height: size.h,
              background: 'var(--fg-02)',
              borderRadius: 8,
              border: '1px solid var(--fg-06)',
              overflow: 'hidden',
            }}>
              <Liveline
                mode="candle"
                data={data}
                value={value}
                candles={candles}
                candleWidth={candleSecs}
                liveCandle={liveCandle ?? undefined}
                lineMode={chartType === 'line'}
                lineData={data}
                lineValue={value}
                loading={loading}
                paused={paused}
                theme={theme}
                color={preset === 'crypto' ? '#f7931a' : undefined}
                window={windowSecs}
                formatValue={preset === 'crypto' ? formatCrypto : undefined}
                grid={grid && size.w >= 200}
                scrub={scrub}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Volume bars */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 8 }}>
        <p style={{ fontSize: 12, color: 'var(--fg-30)', margin: 0 }}>Volume bars</p>
        <Btn active={barMode === 'default'} onClick={() => setBarMode('default')}>Default</Btn>
        <Btn active={barMode === 'overlay'} onClick={() => setBarMode('overlay')}>Overlay</Btn>
        <Sep />
        <Toggle on={barLabels} onToggle={setBarLabels}>Labels</Toggle>
      </div>
      <div style={{
        height: 320,
        background: 'var(--fg-02)',
        borderRadius: 12,
        border: '1px solid var(--fg-06)',
        padding: 8,
        overflow: 'hidden',
      }}>
        <Liveline
          mode="candle"
          data={data}
          value={value}
          candles={candles}
          candleWidth={candleSecs}
          liveCandle={liveCandle ?? undefined}
          lineMode={chartType === 'line'}
          lineData={data}
          lineValue={value}
          loading={loading}
          paused={paused}
          theme={theme}
          color={preset === 'crypto' ? '#f7931a' : undefined}
          window={windowSecs}
          windows={preset === 'crypto' ? CRYPTO_WINDOWS : undefined}
          formatValue={preset === 'crypto' ? formatCrypto : undefined}
          onModeChange={(mode) => setChartType(mode)}
          grid={grid}
          scrub={scrub}
          bars={bars}
          barMode={barMode}
          barWidth={barBucketSecs}
          barLabels={barLabels}
        />
      </div>

      {/* Status bar */}
      <div style={{
        marginTop: 10,
        fontSize: 11,
        fontFamily: '"SF Mono", Menlo, monospace',
        color: 'var(--fg-25)',
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <span>preset: {preset}</span>
        <span>ticks: {data.length}</span>
        <span>candles: {candles.length}</span>
        <span>loading: {String(loading)}</span>
        <span>paused: {String(paused)}</span>
        <span>value: {value.toFixed(2)}</span>
        <span>window: {windowSecs}s</span>
        <span>candle: {candleSecs}s</span>
        <span>tick: {tickRate}ms</span>
        <span>volatility: {volatility}</span>
        <span>mode: {chartType}</span>
      </div>
    </div>
  )
}

// --- UI components ---

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, color: 'var(--fg-30)', width: 56, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--fg-20)', marginRight: 2 }}>{text}:</span>
      {children}
    </div>
  )
}

function Sep() {
  return <div style={{ width: 1, height: 16, background: 'var(--fg-08)', margin: '0 2px' }} />
}

function Toggle({ on, onToggle, children }: { on: boolean; onToggle: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      onClick={() => onToggle(!on)}
      style={{
        fontSize: 11,
        padding: '4px 10px',
        borderRadius: 5,
        border: '1px solid',
        borderColor: on ? 'rgba(59,130,246,0.4)' : 'var(--fg-06)',
        background: on ? 'rgba(59,130,246,0.1)' : 'transparent',
        color: on ? '#3b82f6' : 'var(--fg-35)',
        cursor: 'pointer',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}

function Btn({ children, active, onClick }: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11,
        padding: '4px 10px',
        borderRadius: 5,
        border: '1px solid',
        borderColor: active ? 'rgba(59,130,246,0.5)' : 'var(--fg-08)',
        background: active ? 'rgba(59,130,246,0.12)' : 'var(--fg-02)',
        color: active ? '#3b82f6' : 'var(--fg-45)',
        cursor: 'pointer',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}

createRoot(document.getElementById('root')!).render(<Demo />)
