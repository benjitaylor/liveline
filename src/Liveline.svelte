<script lang="ts">
  import { onDestroy, tick } from 'svelte'

  import { mountLivelineEngine, type LivelineEngineController } from './useLivelineEngine'
  import { resolveSeriesPalettes, resolveTheme, SERIES_COLORS } from './theme'
  import type { DegenOptions, LivelineProps, LivelineSeries, Momentum } from './types'

  const defaultFormatValue = (v: number) => v.toFixed(2)

  const defaultFormatTime = (t: number) => {
    const d = new Date(t * 1000)
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    const s = d.getSeconds().toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  let {
    data,
    value,
    series: seriesProp,
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
    emptyText,
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
    mode = 'line',
    candles,
    candleWidth,
    liveCandle,
    lineMode,
    lineData,
    lineValue,
    onModeChange,
    onSeriesToggle,
    seriesToggleCompact = false,
    lineWidth,
    class: className = '',
    ...rest
  }: LivelineProps = $props()

  let canvasEl: HTMLCanvasElement | null = $state(null)
  let containerEl: HTMLDivElement | null = $state(null)
  let valueDisplayEl: HTMLSpanElement | null = $state(null)
  let windowBarEl: HTMLDivElement | null = $state(null)
  let modeBarEl: HTMLDivElement | null = $state(null)
  let indicatorStyle = $state<{ left: number; width: number } | null>(null)
  let modeIndicatorStyle = $state<{ left: number; width: number } | null>(null)
  let hiddenSeriesIds = $state<string[]>([])
  let activeWindowSecs = $state((() => windows?.[0]?.secs ?? windowSecs)())
  let lastSeriesProp: LivelineSeries[] = $state.raw((() => seriesProp ?? [])())

  let controller: LivelineEngineController | null = null

  let isDark = $derived(theme === 'dark')
  let ws = $derived(windowStyle ?? 'default')
  let activeMode = $derived(lineMode ? 'line' : 'candle')
  let isMultiSeries = $derived((seriesProp?.length ?? 0) > 0)
  let showSeriesToggle = $derived(lastSeriesProp.length > 1)
  let showMomentum = $derived(momentum !== false)
  let momentumOverride = $derived(typeof momentum === 'string' ? momentum : undefined)
  let defaultRight = $derived(badge ? 80 : grid ? 54 : 12)
  let effectiveWindowSecs = $derived(windows?.length ? activeWindowSecs : windowSecs)
  let cursorStyle = $derived(scrub ? cursor : 'default')
  let hiddenSeriesSet = $derived(new Set(hiddenSeriesIds))
  let activeColor = $derived(isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)')
  let inactiveColor = $derived(isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.22)')

  let palette = $derived.by(() => {
    const resolved = resolveTheme(color, theme)
    return lineWidth == null ? resolved : { ...resolved, lineWidth }
  })

  let seriesPalettes = $derived.by(() => {
    if (!seriesProp?.length) return null
    return resolveSeriesPalettes(seriesProp, theme)
  })

  let multiSeries = $derived.by(() => {
    if (!seriesProp || !seriesPalettes) return undefined
    return seriesProp.map((series, index) => ({
      id: series.id,
      data: series.data,
      value: series.value,
      palette:
        seriesPalettes.get(series.id) ??
        resolveTheme(series.color || SERIES_COLORS[index % SERIES_COLORS.length], theme),
      label: series.label,
    }))
  })

  let pad = $derived({
    top: paddingOverride?.top ?? 12,
    right: paddingOverride?.right ?? defaultRight,
    bottom: paddingOverride?.bottom ?? 28,
    left: paddingOverride?.left ?? 12,
  })

  let degenOptions = $derived.by(() => {
    if (degenProp == null || degenProp === false) return undefined
    return typeof degenProp === 'object' ? degenProp : ({} satisfies DegenOptions)
  })

  function findButton(bar: HTMLDivElement | null, selector: string) {
    return bar?.querySelector<HTMLButtonElement>(selector) ?? null
  }

  function updateWindowIndicator() {
    const button = findButton(windowBarEl, `[data-window-secs="${activeWindowSecs}"]`)
    if (!button || !windowBarEl) {
      indicatorStyle = null
      return
    }

    const barRect = windowBarEl.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    indicatorStyle = {
      left: buttonRect.left - barRect.left,
      width: buttonRect.width,
    }
  }

  function updateModeIndicator() {
    if (!onModeChange) {
      modeIndicatorStyle = null
      return
    }

    const button = findButton(modeBarEl, `[data-mode="${activeMode}"]`)
    if (!button || !modeBarEl) {
      modeIndicatorStyle = null
      return
    }

    const barRect = modeBarEl.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    modeIndicatorStyle = {
      left: buttonRect.left - barRect.left,
      width: buttonRect.width,
    }
  }

  function handleSeriesToggle(id: string) {
    if (hiddenSeriesIds.includes(id)) {
      hiddenSeriesIds = hiddenSeriesIds.filter((seriesId) => seriesId !== id)
      onSeriesToggle?.(id, true)
      return
    }

    const totalSeries = seriesProp?.length ?? 0
    const visibleCount = totalSeries - hiddenSeriesIds.length
    if (visibleCount <= 1) return

    hiddenSeriesIds = [...hiddenSeriesIds, id]
    onSeriesToggle?.(id, false)
  }

  function baseBarStyle() {
    return [
      'position:relative',
      'display:inline-flex',
      `gap:${ws === 'text' ? 4 : 2}px`,
      `background:${ws === 'text' ? 'transparent' : isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}`,
      `border-radius:${ws === 'rounded' ? 999 : 6}px`,
      `padding:${ws === 'text' ? 0 : ws === 'rounded' ? 3 : 2}px`,
    ].join(';')
  }

  function indicatorStyles(indicator: { left: number; width: number }) {
    return [
      'position:absolute',
      `top:${ws === 'rounded' ? 3 : 2}px`,
      `left:${indicator.left}px`,
      `width:${indicator.width}px`,
      `height:${ws === 'rounded' ? 'calc(100% - 6px)' : 'calc(100% - 4px)'}`,
      `background:${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)'}`,
      `border-radius:${ws === 'rounded' ? 999 : 4}px`,
      'transition:left 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      'pointer-events:none',
    ].join(';')
  }

  function windowButtonStyle(isActive: boolean) {
    return [
      'position:relative',
      'z-index:1',
      `font-size:11px`,
      `padding:${ws === 'text' ? '2px 6px' : '3px 10px'}`,
      `border-radius:${ws === 'rounded' ? 999 : 4}px`,
      'border:none',
      'cursor:pointer',
      'font-family:system-ui, -apple-system, sans-serif',
      `font-weight:${isActive ? 600 : 400}`,
      'background:transparent',
      `color:${isActive ? activeColor : inactiveColor}`,
      'transition:color 0.2s, background 0.15s',
      'line-height:16px',
    ].join(';')
  }

  function modeButtonStyle() {
    return [
      'position:relative',
      'z-index:1',
      'padding:5px 7px',
      `border-radius:${ws === 'rounded' ? 999 : 4}px`,
      'border:none',
      'cursor:pointer',
      'background:transparent',
      'display:flex',
      'align-items:center',
    ].join(';')
  }

  function seriesButtonStyle(isHidden: boolean) {
    return [
      'position:relative',
      'z-index:1',
      'font-size:11px',
      `padding:${seriesToggleCompact ? (ws === 'text' ? '2px 4px' : '5px 7px') : ws === 'text' ? '2px 6px' : '3px 8px'}`,
      `border-radius:${ws === 'rounded' ? 999 : 4}px`,
      'border:none',
      'cursor:pointer',
      'font-family:system-ui, -apple-system, sans-serif',
      'font-weight:500',
      `background:${isHidden ? 'transparent' : ws === 'text' ? 'transparent' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)'}`,
      `color:${isHidden ? inactiveColor : activeColor}`,
      `opacity:${isHidden ? 0.4 : 1}`,
      'transition:opacity 0.2s, background 0.15s, color 0.2s',
      'line-height:16px',
      'display:flex',
      'align-items:center',
      `gap:${seriesToggleCompact ? 0 : 4}px`,
    ].join(';')
  }

  $effect(() => {
    if (seriesProp?.length) {
      lastSeriesProp = seriesProp
    }
  })

  $effect(() => {
    if (!windows?.length) return
    if (windows.some((option) => option.secs === activeWindowSecs)) return
    activeWindowSecs = windows[0].secs
  })

  $effect(() => {
    activeWindowSecs
    windows?.length
    tick().then(updateWindowIndicator)
  })

  $effect(() => {
    activeMode
    onModeChange
    tick().then(updateModeIndicator)
  })

  $effect(() => {
    if (!windowBarEl) return
    const observer = new ResizeObserver(() => updateWindowIndicator())
    observer.observe(windowBarEl)
    return () => observer.disconnect()
  })

  $effect(() => {
    if (!modeBarEl || !onModeChange) return
    const observer = new ResizeObserver(() => updateModeIndicator())
    observer.observe(modeBarEl)
    return () => observer.disconnect()
  })

  $effect(() => {
    if (!canvasEl || !containerEl) return

    const nextConfig = {
      data,
      value,
      palette,
      windowSecs: effectiveWindowSecs,
      lerpSpeed,
      showGrid: grid,
      showBadge: isMultiSeries ? false : badge,
      showMomentum: isMultiSeries ? false : showMomentum,
      momentumOverride: momentumOverride as Momentum | undefined,
      showFill: isMultiSeries ? false : fill,
      referenceLine,
      formatValue,
      formatTime,
      padding: pad,
      onHover,
      showPulse: pulse,
      scrub,
      exaggerate,
      degenOptions: isMultiSeries ? undefined : degenOptions,
      badgeTail,
      badgeVariant,
      tooltipY,
      tooltipOutline,
      valueMomentumColor,
      valueDisplayElement: showValue ? valueDisplayEl : null,
      orderbookData: orderbook,
      loading,
      paused,
      emptyText,
      mode,
      candles,
      candleWidth,
      liveCandle: liveCandle ?? undefined,
      lineMode,
      lineData,
      lineValue,
      multiSeries,
      isMultiSeries,
      hiddenSeriesIds: hiddenSeriesSet,
    }

    if (!controller) {
      controller = mountLivelineEngine(canvasEl, containerEl, nextConfig)
      return
    }

    controller.update(nextConfig)
  })

  onDestroy(() => {
    controller?.destroy()
    controller = null
  })
</script>

{#if showValue}
  <span
    bind:this={valueDisplayEl}
    style={`display:block;font-size:20px;font-weight:500;font-family:"SF Mono", Menlo, monospace;color:${isDark ? 'rgba(255,255,255,0.85)' : '#111'};transition:color 0.3s;letter-spacing:-0.01em;margin-bottom:8px;padding-top:4px;padding-left:${pad.left}px;`}
  ></span>
{/if}

{#if (windows?.length ?? 0) > 0 || onModeChange || showSeriesToggle}
  <div style={`display:flex;align-items:center;gap:6px;margin-bottom:6px;margin-left:${pad.left}px;`}>
    {#if windows?.length}
      <div bind:this={windowBarEl} style={baseBarStyle()}>
        {#if ws !== 'text' && indicatorStyle}
          <div style={indicatorStyles(indicatorStyle)}></div>
        {/if}

        {#each windows as option (option.secs)}
          <button
            type="button"
            data-window-secs={option.secs}
            onclick={() => {
              activeWindowSecs = option.secs
              onWindowChange?.(option.secs)
            }}
            style={windowButtonStyle(option.secs === activeWindowSecs)}
          >
            {option.label}
          </button>
        {/each}
      </div>
    {/if}

    {#if onModeChange}
      <div bind:this={modeBarEl} style={baseBarStyle()}>
        {#if ws !== 'text' && modeIndicatorStyle}
          <div style={indicatorStyles(modeIndicatorStyle)}></div>
        {/if}

        <button
          type="button"
          aria-label="Show line chart"
          data-mode="line"
          onclick={() => onModeChange('line')}
          style={modeButtonStyle()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M1 8.5C2.5 8.5 3 4 5.5 4S7.5 7 8.5 7C9.5 7 10 3.5 11 3.5"
              stroke={activeMode === 'line' ? activeColor : inactiveColor}
              stroke-width={activeMode === 'line' ? 1.5 : 1.2}
              stroke-linecap="round"
              fill="none"
            />
          </svg>
        </button>

        <button
          type="button"
          aria-label="Show candlestick chart"
          data-mode="candle"
          onclick={() => onModeChange('candle')}
          style={modeButtonStyle()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <line
              x1="3.5"
              y1="1"
              x2="3.5"
              y2="11"
              stroke={activeMode === 'candle' ? activeColor : inactiveColor}
              stroke-width="1"
            />
            <rect
              x="2"
              y="3"
              width="3"
              height="5"
              rx="0.5"
              fill={activeMode === 'candle' ? activeColor : inactiveColor}
            />
            <line
              x1="8.5"
              y1="2"
              x2="8.5"
              y2="10"
              stroke={activeMode === 'candle' ? activeColor : inactiveColor}
              stroke-width="1"
            />
            <rect
              x="7"
              y="4"
              width="3"
              height="4"
              rx="0.5"
              fill={activeMode === 'candle' ? activeColor : inactiveColor}
            />
          </svg>
        </button>
      </div>
    {/if}

    {#if showSeriesToggle}
      <div
        style={`display:inline-flex;gap:${ws === 'text' ? 4 : 2}px;background:${ws === 'text' ? 'transparent' : isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'};border-radius:${ws === 'rounded' ? 999 : 6}px;padding:${ws === 'text' ? 0 : ws === 'rounded' ? 3 : 2}px;opacity:${isMultiSeries ? 1 : 0};transition:opacity 0.4s;pointer-events:${isMultiSeries ? 'auto' : 'none'};`}
      >
        {#each lastSeriesProp as series, index (series.id)}
          {@const isHidden = hiddenSeriesIds.includes(series.id)}
          {@const seriesColor = series.color || SERIES_COLORS[index % SERIES_COLORS.length]}

          <button
            type="button"
            aria-label={`Toggle ${series.label ?? series.id}`}
            onclick={() => handleSeriesToggle(series.id)}
            style={seriesButtonStyle(isHidden)}
          >
            <span
              style={`width:${seriesToggleCompact ? 8 : 6}px;height:${seriesToggleCompact ? 8 : 6}px;border-radius:50%;background:${seriesColor};flex-shrink:0;opacity:${isHidden ? 0.4 : 1};transition:opacity 0.2s;`}
            ></span>
            {#if !seriesToggleCompact}
              {series.label ?? series.id}
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<div {...rest} bind:this={containerEl} class={['liveline-root', className]}>
  <canvas bind:this={canvasEl} class="liveline-canvas" style={`cursor:${cursorStyle};`}></canvas>
</div>

<style>
  .liveline-root {
    width: 100%;
    height: 100%;
    position: relative;
  }

  .liveline-canvas {
    display: block;
  }
</style>
