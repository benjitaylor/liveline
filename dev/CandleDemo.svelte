<script lang="ts">
  import Liveline from '../src/Liveline.svelte'
  import LivelineTransition from '../src/LivelineTransition.svelte'

  import type { CandlePoint, LivelinePoint } from '../src'
  import { CANDLE_WIDTHS, TICK_RATES, TIME_WINDOWS, VOLATILITIES, aggregateCandles, generatePoint, seedLine, type Volatility } from './shared'

  const seededTicks = seedLine(2400, 600, 1, 'normal')
  const seededCandles = aggregateCandles(seededTicks, 5)

  let theme = $state<'dark' | 'light'>('dark')
  let view = $state<'line' | 'candle'>('candle')
  let volatility = $state<Volatility>('normal')
  let tickRate = $state(500)
  let candleWidth = $state(5)
  let lineMode = $state(true)
  let windowSecs = $state(300)
  let ticks: LivelinePoint[] = $state.raw(seededTicks)
  let value = $state(seededTicks[seededTicks.length - 1]?.value ?? 2400)
  let candles: CandlePoint[] = $state.raw(seededCandles.candles)
  let liveCandle = $state<CandlePoint | null>(seededCandles.live)

  function rebuildCandles() {
    const next = aggregateCandles(ticks, candleWidth)
    candles = next.candles
    liveCandle = next.live
  }

  function step() {
    const point = generatePoint(value, Date.now() / 1000, volatility, 2400)
    value = point.value
    ticks = [...ticks, point].slice(-4200)
    rebuildCandles()
  }

  $effect(() => {
    candleWidth
    rebuildCandles()
  })

  $effect(() => {
    const interval = window.setInterval(step, tickRate)
    return () => window.clearInterval(interval)
  })
</script>

<svelte:head>
  <title>Liveline Candle Demo</title>
</svelte:head>

<div class:light={theme === 'light'} class="page">
  <div class="header">
    <div>
      <p class="eyebrow">Transition + candlestick showcase</p>
      <h1>Mode Morphs</h1>
    </div>
    <div class="button-row">
      <button type="button" class:active={theme === 'dark'} onclick={() => (theme = 'dark')}>Dark</button>
      <button type="button" class:active={theme === 'light'} onclick={() => (theme = 'light')}>Light</button>
    </div>
  </div>

  <div class="controls">
    <div class="control-group">
      <span>Transition</span>
      <div class="button-row">
        <button type="button" class:active={view === 'line'} onclick={() => (view = 'line')}>Line scene</button>
        <button type="button" class:active={view === 'candle'} onclick={() => (view = 'candle')}>Candle scene</button>
      </div>
    </div>

    <div class="control-group">
      <span>Candle width</span>
      <div class="button-row">
        {#each CANDLE_WIDTHS as option (option.secs)}
          <button type="button" class:active={candleWidth === option.secs} onclick={() => (candleWidth = option.secs)}>
            {option.label}
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
  </div>

  <div class="chart-shell">
    <LivelineTransition active={view}>
      {#snippet children(key: string)}
        {#if key === 'line'}
          <Liveline
            data={ticks}
            {value}
            theme={theme}
            color="#a855f7"
            window={windowSecs}
            windows={TIME_WINDOWS}
            onWindowChange={(secs: number) => (windowSecs = secs)}
            badge={false}
            showValue
            valueMomentumColor
          />
        {:else if key === 'candle'}
          <Liveline
            data={ticks}
            {value}
            theme={theme}
            color="#f97316"
            mode="candle"
            {candles}
            candleWidth={candleWidth}
            liveCandle={liveCandle ?? undefined}
            lineMode={lineMode}
            lineData={ticks}
            lineValue={value}
            window={windowSecs}
            windows={TIME_WINDOWS}
            onWindowChange={(secs: number) => (windowSecs = secs)}
            onModeChange={(nextMode: 'line' | 'candle') => (lineMode = nextMode === 'line')}
            formatValue={(amount: number) => `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          />
        {/if}
      {/snippet}
    </LivelineTransition>
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
      radial-gradient(circle at top left, rgba(249, 115, 22, 0.14), transparent 30%),
      radial-gradient(circle at top right, rgba(168, 85, 247, 0.16), transparent 28%),
      #0b0d16;
    color: #f8fafc;
    font-family: "Inter Variable", Inter, system-ui, sans-serif;
  }

  .page.light {
    background:
      radial-gradient(circle at top left, rgba(249, 115, 22, 0.12), transparent 28%),
      radial-gradient(circle at top right, rgba(168, 85, 247, 0.14), transparent 24%),
      #f8fafc;
    color: #111827;
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
    color: rgba(248, 250, 252, 0.72);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .light .eyebrow {
    color: rgba(17, 24, 39, 0.6);
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
    transition: background 160ms ease, transform 160ms ease;
  }

  .light button {
    background: rgba(15, 23, 42, 0.08);
  }

  button:hover {
    transform: translateY(-1px);
  }

  button.active {
    background: rgba(249, 115, 22, 0.24);
  }

  .light button.active {
    background: rgba(249, 115, 22, 0.16);
  }

  .chart-shell {
    height: min(520px, 68vh);
    padding: 18px;
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(18px);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .light .chart-shell {
    background: rgba(255, 255, 255, 0.76);
    box-shadow:
      0 24px 60px rgba(15, 23, 42, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
  }
</style>
