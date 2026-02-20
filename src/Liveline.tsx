import { useRef, useState, useLayoutEffect, useMemo } from 'react'
import type { LivelineProps, Momentum, DegenOptions } from './types'
import { resolveTheme } from './theme'
import { useLivelineEngine } from './useLivelineEngine'

const defaultFormatValue = (v: number) => v.toFixed(2)

const defaultFormatTime = (t: number) => {
  const d = new Date(t * 1000)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  const s = d.getSeconds().toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

export function Liveline({
  data,
  value,
  theme = 'dark',
  color = '#3b82f6',
  window: windowSecs = 30,
  grid = true,
  badge = true,
  momentum = true,
  fill = true,
  scrub = true,
  loading = false,
  paused = false,
  exaggerate = false,
  degen: degenProp,
  badgeTail = true,
  badgeVariant = 'default',
  showValue = false,
  valueMomentumColor = false,
  windows,
  onWindowChange,
  windowStyle,
  tooltipY = 14,
  tooltipOutline = true,
  orderbook,
  referenceLine,
  formatValue = defaultFormatValue,
  formatTime = defaultFormatTime,
  lerpSpeed = 0.08,
  padding: paddingOverride,
  onHover,
  cursor = 'crosshair',
  pulse = true,
  className,
  style,
}: LivelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const valueDisplayRef = useRef<HTMLSpanElement>(null)
  const windowBarRef = useRef<HTMLDivElement>(null)
  const windowBtnRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null)

  const palette = useMemo(() => resolveTheme(color, theme), [color, theme])
  const isDark = theme === 'dark'

  // Resolve momentum prop: boolean enables auto-detect, string overrides
  const showMomentum = momentum !== false
  const momentumOverride: Momentum | undefined =
    typeof momentum === 'string' ? momentum : undefined

  const pad = {
    top: paddingOverride?.top ?? 12,
    right: paddingOverride?.right ?? 80,
    bottom: paddingOverride?.bottom ?? 28,
    left: paddingOverride?.left ?? 12,
  }

  // Degen mode: explicit prop wins
  const degenEnabled = degenProp != null
    ? degenProp !== false
    : false
  const degenOptions: DegenOptions | undefined = degenEnabled
    ? (typeof degenProp === 'object' ? degenProp : {})
    : undefined

  // Window buttons state
  const [activeWindowSecs, setActiveWindowSecs] = useState(
    windows && windows.length > 0 ? windows[0].secs : windowSecs
  )
  const effectiveWindowSecs = windows ? activeWindowSecs : windowSecs

  // Measure active window button for sliding indicator
  useLayoutEffect(() => {
    if (!windows || windows.length === 0) return
    const btn = windowBtnRefs.current.get(activeWindowSecs)
    const bar = windowBarRef.current
    if (btn && bar) {
      const barRect = bar.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      setIndicatorStyle({
        left: btnRect.left - barRect.left,
        width: btnRect.width,
      })
    }
  }, [activeWindowSecs, windows])

  const ws = windowStyle ?? 'default'

  useLivelineEngine(canvasRef, containerRef, {
    data,
    value,
    palette,
    windowSecs: effectiveWindowSecs,
    lerpSpeed,
    showGrid: grid,
    showBadge: badge,
    showMomentum,
    momentumOverride,
    showFill: fill,
    referenceLine,
    formatValue,
    formatTime,
    padding: pad,
    onHover,
    showPulse: pulse,
    scrub,
    exaggerate,
    degenOptions,
    badgeTail,
    badgeVariant,
    tooltipY,
    tooltipOutline,
    valueMomentumColor,
    valueDisplayRef: showValue ? valueDisplayRef : undefined,
    orderbookData: orderbook,
    loading,
    paused,
  })

  const cursorStyle = scrub ? cursor : 'default'

  return (
    <>
      {/* Live value display — above the chart */}
      {showValue && (
        <span
          ref={valueDisplayRef}
          style={{
            display: 'block',
            fontSize: 20,
            fontWeight: 500,
            fontFamily: '"SF Mono", Menlo, monospace',
            color: isDark ? 'rgba(255,255,255,0.85)' : '#111',
            transition: 'color 0.3s',
            letterSpacing: '-0.01em',
            marginBottom: 8,
            paddingTop: 4,
            paddingLeft: pad.left,
          }}
        />
      )}

      {/* Time window controls — above chart, not overlapping data */}
      {windows && windows.length > 0 && (
        <div
          ref={windowBarRef}
          style={{
            position: 'relative',
            display: 'inline-flex',
            gap: ws === 'text' ? 4 : 2,
            background: ws === 'text' ? 'transparent'
              : isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            borderRadius: ws === 'rounded' ? 999 : 6,
            padding: ws === 'text' ? 0 : ws === 'rounded' ? 3 : 2,
            marginBottom: 6,
            marginLeft: pad.left,
          }}
        >
          {/* Sliding indicator (default + rounded) */}
          {ws !== 'text' && indicatorStyle && (
            <div style={{
              position: 'absolute',
              top: ws === 'rounded' ? 3 : 2,
              left: indicatorStyle.left,
              width: indicatorStyle.width,
              height: ws === 'rounded' ? 'calc(100% - 6px)' : 'calc(100% - 4px)',
              background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
              borderRadius: ws === 'rounded' ? 999 : 4,
              transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              pointerEvents: 'none' as const,
            }} />
          )}
          {windows.map((w) => {
            const isActive = w.secs === activeWindowSecs
            return (
              <button
                key={w.secs}
                ref={(el) => {
                  if (el) windowBtnRefs.current.set(w.secs, el)
                  else windowBtnRefs.current.delete(w.secs)
                }}
                onClick={() => {
                  setActiveWindowSecs(w.secs)
                  onWindowChange?.(w.secs)
                }}
                style={{
                  position: 'relative',
                  zIndex: 1,
                  fontSize: 11,
                  padding: ws === 'text' ? '2px 6px' : '3px 10px',
                  borderRadius: ws === 'rounded' ? 999 : 4,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontWeight: isActive ? 600 : 400,
                  background: 'transparent',
                  color: isActive
                    ? (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)')
                    : (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.22)'),
                  transition: 'color 0.2s, background 0.15s',
                  lineHeight: '16px',
                }}
              >
                {w.label}
              </button>
            )
          })}
        </div>
      )}

      <div
        ref={containerRef}
        className={className}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          ...style,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', cursor: cursorStyle }}
        />
      </div>
    </>
  )
}
