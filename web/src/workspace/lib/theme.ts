// The look of the workspace: eight colours the user can pick, everything else is derived from them.
import type { CSSProperties } from 'react'

export type Theme = { bg: string; panel: string; line: string; text: string; muted: string; accent: string; up: string; down: string }
export const THEME_KEYS: { key: keyof Theme; label: string }[] = [
  { key: 'bg', label: 'Background' }, { key: 'panel', label: 'Panels' }, { key: 'line', label: 'Borders' }, { key: 'text', label: 'Text' },
  { key: 'muted', label: 'Muted text' }, { key: 'accent', label: 'Accent' }, { key: 'up', label: 'Up candle' }, { key: 'down', label: 'Down candle' },
]

export const PRESETS: Record<string, Theme> = {
  Black: { bg: '#000000', panel: '#0a0a0a', line: '#242424', text: '#d9d9d9', muted: '#7a7a7a', accent: '#e8e8e8', up: '#26a69a', down: '#ef5350' },
  Midnight: { bg: '#131722', panel: '#1e222d', line: '#2a2e39', text: '#d1d4dc', muted: '#787b86', accent: '#2962ff', up: '#26a69a', down: '#ef5350' },
  Light: { bg: '#ffffff', panel: '#f0f3fa', line: '#e0e3eb', text: '#131722', muted: '#787b86', accent: '#2962ff', up: '#089981', down: '#f23645' },
}
export const DEFAULT_THEME = PRESETS.Black

const HEX = /^#[0-9a-f]{6}$/i
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
/** `a` blended `amount` of the way towards `b`. */
export const mix = (a: string, b: string, amount: number) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * amount))
export const alpha = (h: string, a: number) => `rgba(${rgb(h).join(',')},${a})`
const lightness = (h: string) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 }

/** Whatever was saved, made safe: any missing or invalid colour falls back to the default. */
export function parseTheme(raw: unknown): Theme {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...DEFAULT_THEME }
  for (const { key } of THEME_KEYS) if (typeof o[key] === 'string' && HEX.test(o[key] as string)) out[key] = o[key] as string
  return out
}

export const presetName = (t: Theme) => Object.keys(PRESETS).find((n) => THEME_KEYS.every(({ key }) => PRESETS[n][key].toLowerCase() === t[key].toLowerCase())) ?? 'Custom'

/** CSS variables for the page (see styles.css). */
export function cssVars(t: Theme): CSSProperties {
  return {
    '--bg': t.bg, '--panel': t.panel, '--panel2': mix(t.bg, t.panel, 0.5), '--line': t.line, '--hover': mix(t.panel, t.line, 0.6), '--text': t.text,
    '--muted': t.muted, '--accent': t.accent, '--blue': t.accent, '--up': t.up, '--down': t.down,
    '--on-accent': lightness(t.accent) > 0.55 ? '#000' : '#fff',
  } as CSSProperties
}

/** Colours the chart canvas needs. */
export const chartPalette = (t: Theme) => ({
  bg: t.bg, text: t.muted, grid: mix(t.bg, t.line, 0.6), border: t.line, level: mix(t.line, t.muted, 0.4), volumeUp: alpha(t.up, 0.35), volumeDown: alpha(t.down, 0.35),
})
