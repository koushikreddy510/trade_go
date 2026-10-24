import { useEffect, useState } from 'react'
import { TIMEFRAMES, type IndicatorName } from '../api/types'
import { INDICATORS } from '../lib/indicators'
import { fmtPct, fmtPrice, shortSymbol, sign } from '../lib/format'
import { useApp, useSel } from './context'

type EditingIndicator = { name: IndicatorName; params: Record<string, number>; id?: string }   // id: editing an existing one

export function ChartToolbar() {
  const { ctl } = useApp()
  const symbol = useSel((s) => s.symbol)
  const timeframe = useSel((s) => s.timeframe)
  const indicators = useSel((s) => s.indicators)
  const tradeLines = useSel((s) => s.tradeLines)
  const showResults = useSel((s) => s.showResults)
  const showPe = useSel((s) => s.showPe)
  const quote = useSel((s) => s.quotes[s.symbol])
  const [menu, setMenu] = useState(false)
  const [more, setMore] = useState(false)     // phones: Results / P/E / trade lines live behind the ⋯ button
  const [editing, setEditing] = useState<EditingIndicator | null>(null)
  const editingId = useSel((s) => s.editingIndicator)
  // the legend's ⚙ opens this editor for that indicator
  useEffect(() => {
    const cfg = editingId ? indicators.find((i) => i.id === editingId) : undefined
    if (cfg) { setMenu(false); setEditing({ name: cfg.name, params: { ...cfg.params }, id: cfg.id }) }
  }, [editingId, indicators])
  const closeEditor = () => { setEditing(null); if (editingId) ctl.editIndicator(null) }

  function startEdit(name: IndicatorName) {
    setMenu(false)
    setEditing({ name, params: { ...INDICATORS[name].defaults } })
  }

  function confirmAdd() {
    if (!editing) return
    if (editing.id) ctl.updateIndicator(editing.id, editing.params)
    else ctl.addIndicator(editing.name, editing.params)
    closeEditor()
  }

  function updateParam(key: string, raw: string) {
    if (!editing) return
    const val = parseFloat(raw)
    if (!Number.isNaN(val)) setEditing({ ...editing, params: { ...editing.params, [key]: val } })
  }

  return (
    <div className={more ? 'chart-toolbar more-open' : 'chart-toolbar'}>
      <div className="title">
        <b>{shortSymbol(symbol)}</b>
        {quote && (
          <span className={`px ${sign(quote.change)}`}>
            {fmtPrice(quote.price)} <small>{fmtPct(quote.change_pct)}</small>
          </span>
        )}
      </div>

      {/* phones: one dropdown showing the current timeframe instead of nine buttons */}
      <select className="tf-select" aria-label="Timeframe" value={timeframe} onChange={(e) => void ctl.setTimeframe(e.target.value as typeof timeframe)}>
        {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
      </select>
      <div className="group tf-buttons" role="group" aria-label="Timeframe">
        {TIMEFRAMES.map((tf) => (
          <button key={tf} className={tf === timeframe ? 'chip active' : 'chip'} aria-pressed={tf === timeframe} onClick={() => void ctl.setTimeframe(tf)}>{tf}</button>
        ))}
      </div>

      <div className="group extra" role="group" aria-label="Fundamentals">
        <button className={showResults ? 'chip active' : 'chip'} aria-pressed={showResults} title="Mark each result day on the chart" onClick={() => ctl.toggleResults()}>Results</button>
        <button className={showPe ? 'chip active' : 'chip'} aria-pressed={showPe} title="P/E (TTM) pane: price over trailing-year EPS as known at the time" onClick={() => ctl.togglePe()}>P/E</button>
      </div>

      <div className="group trade-lines extra" role="group" aria-label="Trade lines">
        <span className="muted">Trade lines</span>
        {(['stop', 'target', 'entry'] as const).map((k) => (
          <button key={k} className={tradeLines[k] ? 'chip active' : 'chip'} aria-pressed={tradeLines[k]}
            title={{ stop: 'Stop-loss of each position, with every trailing move', target: 'Take-profit (target) of each position', entry: 'Entry price of each position' }[k]}
            onClick={() => ctl.toggleTradeLine(k)}>{{ stop: 'Stop / trail', target: 'Target', entry: 'Entry' }[k]}</button>
        ))}
      </div>
      <button className="chip more-btn" aria-label="More chart options" aria-expanded={more} onClick={() => setMore((m) => !m)}>⋯</button>
      <div className="group indicators">
        <span className="menu-anchor">
          <button className="chip" aria-haspopup="menu" aria-expanded={menu} onClick={() => { setEditing(null); setMenu((m) => !m) }}>+ Indicator</button>

          {menu && !editing && (
            <ul className="menu" role="menu">
              {indicators.length > 0 && <li className="menu-head" role="presentation">Applied</li>}
              {indicators.map((i) => (
                <li key={`on-${i.id}`} className="applied" role="presentation">
                  <span className={i.hidden ? 'muted' : ''}>{INDICATORS[i.name].label} <small>{Object.values(i.params).join(', ')}</small></span>
                  <span className="legend-actions">
                    <button aria-label={`${i.hidden ? 'Show' : 'Hide'} ${INDICATORS[i.name].label} ${Object.values(i.params).join(',')}`} onClick={() => ctl.toggleIndicatorHidden(i.id)}>{i.hidden ? '◌' : '👁'}</button>
                    <button aria-label={`Settings of ${INDICATORS[i.name].label} ${Object.values(i.params).join(',')}`} onClick={() => ctl.editIndicator(i.id)}>⚙</button>
                    <button aria-label={`Remove ${INDICATORS[i.name].label} ${Object.values(i.params).join(',')}`} onClick={() => ctl.removeIndicator(i.id)}>×</button>
                  </span>
                </li>
              ))}
              <li className="menu-head" role="presentation">Add</li>
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
            <div key={editing.id ?? editing.name} className="menu indicator-editor" role="dialog" aria-label={`Configure ${INDICATORS[editing.name].label}`}>
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
                <button className="chip" onClick={closeEditor}>Cancel</button>
                <button className="chip active" onClick={confirmAdd}>{editing.id ? 'Save' : 'Add'}</button>
              </div>
            </div>
          )}
        </span>
      </div>
    </div>
  )
}
