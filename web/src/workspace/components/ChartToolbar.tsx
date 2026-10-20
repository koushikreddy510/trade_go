import { useState } from 'react'
import { TIMEFRAMES, type IndicatorName } from '../api/types'
import { INDICATORS, indicatorLabel } from '../lib/indicators'
import { fmtPct, fmtPrice, shortSymbol, sign } from '../lib/format'
import { useApp, useSel } from './context'

type EditingIndicator = { name: IndicatorName; params: Record<string, number> }

export function ChartToolbar() {
  const { ctl } = useApp()
  const symbol = useSel((s) => s.symbol)
  const timeframe = useSel((s) => s.timeframe)
  const indicators = useSel((s) => s.indicators)
  const showResults = useSel((s) => s.showResults)
  const showPe = useSel((s) => s.showPe)
  const quote = useSel((s) => s.quotes[s.symbol])
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState<EditingIndicator | null>(null)

  function startEdit(name: IndicatorName) {
    setMenu(false)
    setEditing({ name, params: { ...INDICATORS[name].defaults } })
  }

  function confirmAdd() {
    if (!editing) return
    ctl.addIndicator(editing.name, editing.params)
    setEditing(null)
  }

  function updateParam(key: string, raw: string) {
    if (!editing) return
    const val = parseFloat(raw)
    if (!Number.isNaN(val)) setEditing({ ...editing, params: { ...editing.params, [key]: val } })
  }

  return (
    <div className="chart-toolbar">
      <div className="title">
        <b>{shortSymbol(symbol)}</b>
        {quote && (
          <span className={`px ${sign(quote.change)}`}>
            {fmtPrice(quote.price)} <small>{fmtPct(quote.change_pct)}</small>
          </span>
        )}
      </div>

      <div className="group" role="group" aria-label="Timeframe">
        {TIMEFRAMES.map((tf) => (
          <button key={tf} className={tf === timeframe ? 'chip active' : 'chip'} aria-pressed={tf === timeframe} onClick={() => void ctl.setTimeframe(tf)}>{tf}</button>
        ))}
      </div>

      <div className="group" role="group" aria-label="Fundamentals">
        <button className={showResults ? 'chip active' : 'chip'} aria-pressed={showResults} title="Mark each result day on the chart" onClick={() => ctl.toggleResults()}>Results</button>
        <button className={showPe ? 'chip active' : 'chip'} aria-pressed={showPe} title="P/E (TTM) pane: price over trailing-year EPS as known at the time" onClick={() => ctl.togglePe()}>P/E</button>
      </div>

      <div className="group indicators">
        {indicators.map((i) => (
          <span key={i.id} className="chip tag">
            {indicatorLabel(i.name, i.params)}
            <button aria-label={`Remove ${indicatorLabel(i.name, i.params)}`} onClick={() => ctl.removeIndicator(i.id)}>×</button>
          </span>
        ))}

        <span className="menu-anchor">
          <button className="chip" aria-haspopup="menu" aria-expanded={menu} onClick={() => { setEditing(null); setMenu((m) => !m) }}>+ Indicator</button>

          {menu && !editing && (
            <ul className="menu" role="menu">
              {(Object.keys(INDICATORS) as IndicatorName[]).map((name) => (
                <li key={name} role="menuitem" tabIndex={0}
                  onClick={() => startEdit(name)}
                  onKeyDown={(e) => { if (e.key === 'Enter') startEdit(name) }}>
                  {INDICATORS[name].label}
                  <small>{Object.entries(INDICATORS[name].defaults).map(([k, v]) => `${k} ${v}`).join(', ')}</small>
                </li>
              ))}
            </ul>
          )}

          {editing && (
            <div className="menu indicator-editor" role="dialog" aria-label={`Configure ${INDICATORS[editing.name].label}`}>
              <div className="indicator-editor-title">{INDICATORS[editing.name].label}</div>
              {Object.entries(editing.params).map(([key, val]) => (
                <label key={key} className="indicator-editor-row">
                  <span>{key.replace(/_/g, ' ')}</span>
                  <input
                    type="number"
                    defaultValue={val}
                    step={key.includes('mult') || key.includes('step') ? 0.1 : 1}
                    onChange={(e) => updateParam(key, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmAdd() }}
                  />
                </label>
              ))}
              <div className="indicator-editor-actions">
                <button className="chip" onClick={() => setEditing(null)}>Cancel</button>
                <button className="chip active" onClick={confirmAdd}>Add</button>
              </div>
            </div>
          )}
        </span>
      </div>
    </div>
  )
}
