import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { Liveline } from 'liveline'
import type { LivelinePoint } from 'liveline'

// --- Data generators ---

type Volatility = 'calm' | 'normal' | 'spiky' | 'chaos'

function generatePoint(prev: number, time: number, volatility: Volatility): LivelinePoint {
  const v: Record<Volatility, number> = { calm: 0.15, normal: 0.8, spiky: 3, chaos: 8 }
  const bias: Record<Volatility, number> = { calm: 0.49, normal: 0.48, spiky: 0.47, chaos: 0.45 }
  const scale = v[volatility]
  // Occasional large spikes in spiky/chaos modes
  const spike = (volatility === 'spiky' || volatility === 'chaos') && Math.random() < 0.08
    ? (Math.random() - 0.5) * scale * 3
    : 0
  const delta = (Math.random() - bias[volatility]) * scale + spike
  return { time, value: prev + delta }
}

// --- Constants ---

const TIME_WINDOWS = [
  { label: '10s', secs: 10 },
  { label: '30s', secs: 30 },
  { label: '1m', secs: 60 },
  { label: '5m', secs: 300 },
]

const TICK_RATES: { label: string; ms: number }[] = [
  { label: '50ms', ms: 50 },
  { label: '100ms', ms: 100 },
  { label: '300ms', ms: 300 },
  { label: '1s', ms: 1000 },
]

const VOLATILITIES: Volatility[] = ['calm', 'normal', 'spiky', 'chaos']

// --- Demo ---

function Demo() {
  const [data, setData] = useState<LivelinePoint[]>([])
  const [value, setValue] = useState(100)
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)
  const [scenario, setScenario] = useState<'loading' | 'loading-hold' | 'live' | 'empty'>('loading')

  // Prop controls
  const [windowSecs, setWindowSecs] = useState(30)
  const [degen, setDegen] = useState(false)
  const [degenScale, setDegenScale] = useState(1)
  const [degenDown, setDegenDown] = useState(false)
  const [fill, setFill] = useState(true)
  const [grid, setGrid] = useState(true)
  const [badge, setBadge] = useState(true)
  const [badgeVariant, setBadgeVariant] = useState<'default' | 'minimal'>('default')
  const [momentum, setMomentum] = useState(true)
  const [pulse, setPulse] = useState(true)
  const [scrub, setScrub] = useState(true)
  const [exaggerate, setExaggerate] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  // Data controls
  const [volatility, setVolatility] = useState<Volatility>('normal')
  const [tickRate, setTickRate] = useState(300)

  const intervalRef = useRef<number>(0)
  const volatilityRef = useRef(volatility)
  volatilityRef.current = volatility

  const startLive = useCallback(() => {
    clearInterval(intervalRef.current)
    setLoading(false)

    const now = Date.now() / 1000
    const seed: LivelinePoint[] = []
    let v = 100
    for (let i = 60; i >= 0; i--) {
      const pt = generatePoint(v, now - i * 0.5, volatilityRef.current)
      seed.push(pt)
      v = pt.value
    }
    setData(seed)
    setValue(v)

    intervalRef.current = window.setInterval(() => {
      setData(prev => {
        const now = Date.now() / 1000
        const lastVal = prev.length > 0 ? prev[prev.length - 1].value : 100
        const pt = generatePoint(lastVal, now, volatilityRef.current)
        setValue(pt.value)
        const next = [...prev, pt]
        return next.length > 500 ? next.slice(-500) : next
      })
    }, tickRate)
  }, [tickRate])

  useEffect(() => {
    if (scenario === 'loading') {
      setLoading(true)
      setData([])
      clearInterval(intervalRef.current)
      const timer = setTimeout(() => setScenario('live'), 3000)
      return () => clearTimeout(timer)
    }

    if (scenario === 'loading-hold') {
      setLoading(true)
      setData([])
      clearInterval(intervalRef.current)
      return
    }

    if (scenario === 'empty') {
      setLoading(false)
      setData([])
      clearInterval(intervalRef.current)
      return
    }

    // scenario === 'live'
    startLive()
    return () => clearInterval(intervalRef.current)
  }, [scenario, startLive])

  // Restart interval when tick rate changes while live
  useEffect(() => {
    if (scenario !== 'live') return
    clearInterval(intervalRef.current)
    intervalRef.current = window.setInterval(() => {
      setData(prev => {
        const now = Date.now() / 1000
        const lastVal = prev.length > 0 ? prev[prev.length - 1].value : 100
        const pt = generatePoint(lastVal, now, volatilityRef.current)
        setValue(pt.value)
        const next = [...prev, pt]
        return next.length > 500 ? next.slice(-500) : next
      })
    }, tickRate)
    return () => clearInterval(intervalRef.current)
  }, [tickRate, scenario])

  const degenOpts = degen ? { scale: degenScale, downMomentum: degenDown } : undefined

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
      // CSS vars for child components
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
        Liveline Dev
      </h1>
      <p style={{ fontSize: 12, color: 'var(--fg-30)', marginBottom: 20 }}>Stress-test playground</p>

      {/* Scenario row */}
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

      {/* Data controls */}
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

      {/* Time window */}
      <Section label="Window">
        {TIME_WINDOWS.map(w => (
          <Btn key={w.secs} active={windowSecs === w.secs} onClick={() => setWindowSecs(w.secs)}>
            {w.label}
          </Btn>
        ))}
      </Section>

      {/* Feature toggles */}
      <Section label="Features">
        <Btn active={theme === 'dark'} onClick={() => setTheme('dark')}>Dark</Btn>
        <Btn active={theme === 'light'} onClick={() => setTheme('light')}>Light</Btn>
        <Sep />
        <Toggle on={grid} onToggle={setGrid}>Grid</Toggle>
        <Toggle on={fill} onToggle={setFill}>Fill</Toggle>
        <Toggle on={badge} onToggle={setBadge}>Badge</Toggle>
        <Toggle on={momentum} onToggle={setMomentum}>Momentum</Toggle>
        <Toggle on={pulse} onToggle={setPulse}>Pulse</Toggle>
        <Toggle on={scrub} onToggle={setScrub}>Scrub</Toggle>
        <Toggle on={exaggerate} onToggle={setExaggerate}>Exaggerate</Toggle>
        <Sep />
        <Label text="Badge style">
          <Btn active={badgeVariant === 'default'} onClick={() => setBadgeVariant('default')}>Default</Btn>
          <Btn active={badgeVariant === 'minimal'} onClick={() => setBadgeVariant('minimal')}>Minimal</Btn>
        </Label>
      </Section>

      {/* Degen */}
      <Section label="Degen">
        <Toggle on={degen} onToggle={setDegen}>Enable</Toggle>
        {degen && (
          <>
            <Sep />
            <Toggle on={degenDown} onToggle={setDegenDown}>Down momentum</Toggle>
            <Sep />
            <Label text="Scale">
              {[0.5, 1, 2, 4].map(s => (
                <Btn key={s} active={degenScale === s} onClick={() => setDegenScale(s)}>{s}x</Btn>
              ))}
            </Label>
          </>
        )}
      </Section>

      {/* Chart */}
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
          data={data}
          value={value}
          theme={theme}
          window={windowSecs}
          loading={loading}
          paused={paused}
          badge={badge}
          badgeVariant={badgeVariant}
          momentum={momentum}
          fill={fill}
          grid={grid}
          scrub={scrub}
          pulse={pulse}
          exaggerate={exaggerate}
          degen={degenOpts}
          windows={TIME_WINDOWS}
          onWindowChange={setWindowSecs}
        />
      </div>

      {/* Smaller sizes */}
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
                data={data}
                value={value}
                theme={theme}
                window={windowSecs}
                loading={loading}
                paused={paused}
                badge={badge && size.w >= 200}
                badgeVariant={badgeVariant}
                momentum={momentum && size.w >= 200}
                fill={fill}
                grid={grid && size.w >= 200}
                scrub={scrub}
                pulse={pulse}
                exaggerate={exaggerate}
                degen={degenOpts}
              />
            </div>
          </div>
        ))}
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
        <span>points: {data.length}</span>
        <span>loading: {String(loading)}</span>
        <span>paused: {String(paused)}</span>
        <span>value: {value.toFixed(2)}</span>
        <span>window: {windowSecs}s</span>
        <span>tick: {tickRate}ms</span>
        <span>volatility: {volatility}</span>
      </div>
    </div>
  )
}

// --- UI components ---

// Theme-aware helpers — use CSS vars set on the page wrapper

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
