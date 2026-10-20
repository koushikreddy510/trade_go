import { useState } from 'react'
import { DEFAULT_THEME, PRESETS, THEME_KEYS, presetName, type Theme } from '../lib/theme'
import { useApp, useSel } from './context'

/** Pick a preset or edit any of the colours; the choice is remembered in this browser. */
export function ThemeMenu() {
  const { ctl } = useApp()
  const theme = useSel((s) => s.theme)
  const [open, setOpen] = useState(false)
  const name = presetName(theme)
  return (
    <div className="theme-menu">
      <button aria-expanded={open} onClick={() => setOpen(!open)}>Theme</button>
      {open && (
        <div className="theme-pop" role="dialog" aria-label="Theme">
          <label>Preset
            <select value={name} onChange={(e) => { if (PRESETS[e.target.value]) ctl.setTheme(PRESETS[e.target.value]) }}>
              {[...Object.keys(PRESETS), ...(name === 'Custom' ? ['Custom'] : [])].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          {THEME_KEYS.map(({ key, label }) => (
            <label key={key}>{label}
              <input type="color" aria-label={label} value={theme[key]} onChange={(e) => ctl.setTheme({ ...theme, [key]: e.target.value } as Theme)} />
            </label>
          ))}
          <button className="small" onClick={() => ctl.setTheme(DEFAULT_THEME)}>Reset to black</button>
        </div>
      )}
    </div>
  )
}
