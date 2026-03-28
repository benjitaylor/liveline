<script lang="ts">
  import type { LivelineTransitionProps } from './types'

  let {
    active,
    duration = 300,
    children,
    class: className = '',
    ...rest
  }: LivelineTransitionProps = $props()

  let mounted = $state([(() => active)()])
  let visible = $state((() => active)())
  let previous = $state((() => active)())

  $effect(() => {
    if (active === previous) return

    const outgoing = previous
    previous = active

    if (!mounted.includes(active)) {
      mounted = [...mounted, active]
    }

    let raf1 = requestAnimationFrame(() => {
      raf1 = requestAnimationFrame(() => {
        visible = active
      })
    })

    const timeout = window.setTimeout(() => {
      mounted = mounted.filter((key) => key !== outgoing)
    }, duration + 50)

    return () => {
      cancelAnimationFrame(raf1)
      clearTimeout(timeout)
    }
  })
</script>

<div {...rest} class={['liveline-transition', className]}>
  {#each mounted as key (key)}
    <div
      class="liveline-transition__layer"
      aria-hidden={key === visible ? undefined : true}
      style={`opacity:${key === visible ? 1 : 0};transition:opacity ${duration}ms ease;pointer-events:${key === visible ? 'auto' : 'none'};`}
    >
      {@render children?.(key)}
    </div>
  {/each}
</div>

<style>
  .liveline-transition {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .liveline-transition__layer {
    position: absolute;
    inset: 0;
  }
</style>
