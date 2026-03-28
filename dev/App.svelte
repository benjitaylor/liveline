<script lang="ts">
  import Liveline from '../src/Liveline.svelte'

  import type { LivelinePoint, LivelineSeries } from '../src'
  import { TICK_RATES, TIME_WINDOWS, VOLATILITIES, generatePoint, seedLine, type Volatility } from './shared'

  function buildSiblingSeries(points: LivelinePoint[], baseValue: number) {
    return points.map((point, index) => ({
      time: point.time,
      value: baseValue + (point.value - points[0].value) * 0.65 + Math.sin(index / 6) * 0.9,
    }))
  }

  const seededPrimary = seedLine(102, 180, 0.5, 'normal')
  const seededSecondary = buildSiblingSeries(seededPrimary, 78)

  let theme = $state<'dark' | 'light'>('dark')
  let displayMode = $state<'line' | 'multi'>('line')
  let volatility = $state<Volatility>('normal')
  let tickRate = $state(200)
  let windowSecs = $state(30)
  let loading = $state(true)
  let paused = $state(false)
  let data: LivelinePoint[] = $state.raw(seededPrimary)
  let secondaryData: LivelinePoint[] = $state.raw(seededSecondary)
  let value = $state(seededPrimary[seededPrimary.length - 1]?.value ?? 102)
  let secondaryValue = $state(seededSecondary[seededSecondary.length - 1]?.value ?? 78)

  let series = $derived<LivelineSeries[]>([
    { id: 'alpha', label: 'Alpha', data, value, color: '#3b82f6' },
    { id: 'beta', label: 'Beta', data: secondaryData, value: secondaryValue, color: '#f97316' },
  ])

  function reset() {
    const nextPrimary = seedLine(102, 180, 0.5, volatility)
    const nextSecondary = buildSiblingSeries(nextPrimary, 78)
    data = nextPrimary
    secondaryData = nextSecondary
    value = nextPrimary[nextPrimary.length - 1]?.value ?? 102
    secondaryValue = nextSecondary[nextSecondary.length - 1]?.value ?? 78
  }

  function step() {
    const now = Date.now() / 1000
    const nextPrimary = generatePoint(value, now, volatility, 102)
    const nextSecondary = generatePoint(secondaryValue, now, volatility === 'spiky' ? 'normal' : 'calm', 78)

    value = nextPrimary.value
    secondaryValue = nextSecondary.value
    data = [...data, nextPrimary].slice(-1800)
    secondaryData = [...secondaryData, nextSecondary].slice(-1800)
  }

  $effect(() => {
    volatility
    reset()
  })

  $effect(() => {
    if (loading) {
      const timeout = window.setTimeout(() => {
        loading = false
      }, 1200)
      return () => window.clearTimeout(timeout)
    }

    if (paused) return

    const interval = window.setInterval(step, tickRate)
    return () => window.clearInterval(interval)
  })
</script>

<svelte:head>
  <title>Liveline Dev</title>
</svelte:head>

<div class:light={theme === 'light'} class="page">
  <div class="header">
    <div>
      <p class="eyebrow">Svelte 5 library playground</p>
      <h1>Liveline</h1>
    </div>
    <div class="button-row">
      <button type="button" class:active={theme === 'dark'} onclick={() => (theme = 'dark')}>Dark</button>
      <button type="button" class:active={theme === 'light'} onclick={() => (theme = 'light')}>Light</button>
    </div>
  </div>

  <div class="controls">
    <div class="control-group">
      <span>Mode</span>
      <div class="button-row">
        <button type="button" class:active={displayMode === 'line'} onclick={() => (displayMode = 'line')}>Line</button>
        <button type="button" class:active={displayMode === 'multi'} onclick={() => (displayMode = 'multi')}>Multi</button>
      </div>
    </div>

    <div class="control-group">
      <span>State</span>
      <div class="button-row">
        <button type="button" class:active={loading} onclick={() => {
          loading = true
          reset()
        }}>
          Reload
        </button>
        <button type="button" class:active={paused} onclick={() => (paused = !paused)}>
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
    </div>

    <div class="control-group">
      <span>Volatility</span>
      <div class="button-row">
        {#each VOLATILITIES as option (option)}
          <button type="button" class:active={volatility === option} onclick={() => (volatility = option)}>
            {option}
          </button>
        {/each}
      </div>
    </div>

    <div class="control-group">
      <span>Tick rate</span>
      <div class="button-row">
        {#each TICK_RATES as option (option.ms)}
          <button type="button" class:active={tickRate === option.ms} onclick={() => (tickRate = option.ms)}>
            {option.label}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="chart-shell">
    {#if displayMode === 'line'}
      <Liveline
        {data}
        {value}
        {loading}
        {paused}
        theme={theme}
        color="#22c55e"
        window={windowSecs}
        windows={TIME_WINDOWS}
        onWindowChange={(secs: number) => (windowSecs = secs)}
        showValue
        valueMomentumColor
        degen={{ scale: 1.25 }}
        badgeVariant="minimal"
        fill
      />
    {:else}
      <Liveline
        {data}
        {value}
        {loading}
        {paused}
        theme={theme}
        window={windowSecs}
        windows={TIME_WINDOWS}
        onWindowChange={(secs: number) => (windowSecs = secs)}
        {series}
        seriesToggleCompact
      />
    {/if}
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
  }

  .page {
    min-height: 100vh;
    padding: 32px;
    background:
      radial-gradient(circle at top left, rgba(34, 197, 94, 0.14), transparent 30%),
      radial-gradient(circle at top right, rgba(59, 130, 246, 0.16), transparent 28%),
      #08110e;
    color: #ecfdf5;
    font-family: "Inter Variable", Inter, system-ui, sans-serif;
  }

  .page.light {
    background:
      radial-gradient(circle at top left, rgba(34, 197, 94, 0.12), transparent 28%),
      radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 24%),
      #f8fafc;
    color: #0f172a;
  }

  .header,
  .controls,
  .button-row,
  .control-group {
    display: flex;
    gap: 12px;
  }

  .header,
  .controls {
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .eyebrow {
    margin: 0 0 6px;
    color: rgba(236, 253, 245, 0.72);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .light .eyebrow {
    color: rgba(15, 23, 42, 0.6);
  }

  h1 {
    margin: 0;
    font-size: clamp(2rem, 4vw, 3.5rem);
    line-height: 0.92;
  }

  .controls {
    margin: 28px 0 20px;
  }

  .control-group {
    flex-direction: column;
    min-width: 180px;
  }

  .control-group span {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.7;
  }

  .button-row {
    flex-wrap: wrap;
  }

  button {
    border: none;
    border-radius: 999px;
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    cursor: pointer;
    transition: background 160ms ease, transform 160ms ease, opacity 160ms ease;
  }

  .light button {
    background: rgba(15, 23, 42, 0.08);
  }

  button:hover {
    transform: translateY(-1px);
  }

  button.active {
    background: rgba(34, 197, 94, 0.26);
  }

  .light button.active {
    background: rgba(34, 197, 94, 0.16);
  }

  .chart-shell {
    height: min(480px, 62vh);
    padding: 18px;
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(18px);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .light .chart-shell {
    background: rgba(255, 255, 255, 0.72);
    box-shadow:
      0 24px 60px rgba(15, 23, 42, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }
</style>
