import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, PRESETS, chartPalette, cssVars, mix, parseTheme, presetName } from './theme'

describe('theme', () => {
  it('defaults to black', () => {
    expect(DEFAULT_THEME.bg).toBe('#000000')
    expect(presetName(DEFAULT_THEME)).toBe('Black')
    expect(presetName({ ...DEFAULT_THEME, accent: '#ff0000' })).toBe('Custom')
  })
  it('repairs whatever was saved: bad or missing colours fall back to black', () => {
    expect(parseTheme(null)).toEqual(DEFAULT_THEME)
    expect(parseTheme({ bg: 'red', up: '#00ff00', down: 5 })).toEqual({ ...DEFAULT_THEME, up: '#00ff00' })
  })
  it('blends colours', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
  it('gives dark text on a light accent and light text on a dark one', () => {
    expect((cssVars({ ...DEFAULT_THEME, accent: '#ffffff' }) as Record<string, string>)['--on-accent']).toBe('#000')
    expect((cssVars(PRESETS.Midnight) as Record<string, string>)['--on-accent']).toBe('#fff')
  })
  it('hands the chart its canvas colours', () => {
    expect(chartPalette(DEFAULT_THEME)).toMatchObject({ bg: '#000000', border: '#242424', volumeUp: 'rgba(38,166,154,0.35)' })
  })
})
