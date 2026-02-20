import type { ThemeMode, LivelinePalette } from './types'

/** Parse any CSS color string to [r, g, b]. Handles hex (#rgb, #rrggbb), rgb(), rgba(). */
export function parseColorRgb(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
  }
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]]
  return [128, 128, 128]
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/**
 * Derive a full palette from a single accent color + theme mode.
 * Momentum colors are always semantic green/red regardless of accent.
 */
export function resolveTheme(color: string, mode: ThemeMode): LivelinePalette {
  const [r, g, b] = parseColorRgb(color)
  const isDark = mode === 'dark'

  return {
    // Line
    line: color,
    lineWidth: 2,

    // Fill gradient
    fillTop: rgba(r, g, b, isDark ? 0.12 : 0.08),
    fillBottom: rgba(r, g, b, 0),

    // Grid
    gridLine: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
    gridLabel: isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.35)',

    // Dot — always semantic
    dotUp: '#22c55e',
    dotDown: '#ef4444',
    dotFlat: color,
    glowUp: 'rgba(34, 197, 94, 0.18)',
    glowDown: 'rgba(239, 68, 68, 0.18)',
    glowFlat: rgba(r, g, b, 0.12),

    // Badge
    badgeOuterBg: isDark ? 'rgba(40, 40, 40, 0.95)' : 'rgba(255, 255, 255, 0.95)',
    badgeOuterShadow: isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.15)',
    badgeBg: color,
    badgeText: '#ffffff',

    // Dash line
    dashLine: rgba(r, g, b, 0.4),

    // Reference line
    refLine: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)',
    refLabel: isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.4)',

    // Time axis
    timeLabel: isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.3)',

    // Crosshair
    crosshairLine: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.12)',
    tooltipBg: isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
    tooltipText: isDark ? '#e5e5e5' : '#1a1a1a',
    tooltipBorder: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',

    // Background
    bgRgb: isDark ? [10, 10, 10] as [number, number, number] : [255, 255, 255] as [number, number, number],

    // Fonts
    labelFont: '11px "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
    valueFont: '600 11px "SF Mono", Menlo, monospace',
    badgeFont: '500 11px "SF Mono", Menlo, monospace',
  }
}
