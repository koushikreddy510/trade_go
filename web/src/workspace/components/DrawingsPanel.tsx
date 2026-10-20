import { draftFromLine } from '../lib/rules'
import { fmtPrice } from '../lib/format'
import { useApp, useSel } from './context'

const NAMES = { trend_line: 'Trend line', ray: 'Ray', horizontal_line: 'Level', rectangle: 'Zone', text: 'Text' } as const

export function DrawingsPanel() {
  const { ctl } = useApp()
  const drawings = useSel((s) => s.drawings)
  const selected = useSel((s) => s.selectedDrawingId)
  const timeframe = useSel((s) => s.timeframe)
  return (
    <div className="panel" aria-label="Drawings">
      {drawings.length === 0 ? <p className="empty">Nothing drawn on this symbol. Pick “Trend line” or “Zone” in the toolbar and click two points on the chart.</p> : (
        <ul className="cards">
          {drawings.map((d) => (
            <li key={d.id} className={d.id === selected ? 'card selected' : 'card'} onClick={() => ctl.selectDrawing(d.id)}>
              <div className="card-head">
                <b>{NAMES[d.kind]}</b>
                <span className="muted">{d.points.map((p) => fmtPrice(p.price)).join(' → ')}</span>
              </div>
              <input
                className="label-input"
                defaultValue={d.label}
                placeholder="Label (optional)"
                aria-label="Line label"
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { if (e.target.value !== d.label) void ctl.labelDrawing(d.id, e.target.value) }}
              />
              <div className="card-actions">
                {d.kind !== 'text' && (
                  <>
                    <button className="small" onClick={(e) => { e.stopPropagation(); ctl.openRuleDialog(draftFromLine(d, timeframe, 'above')) }}>Enter when close crosses above{d.kind === 'rectangle' ? ' the top' : ''}</button>
                    <button className="small" onClick={(e) => { e.stopPropagation(); ctl.openRuleDialog(draftFromLine(d, timeframe, 'below')) }}>Enter when close crosses below{d.kind === 'rectangle' ? ' the bottom' : ''}</button>
                  </>
                )}
                <button className="small danger" onClick={(e) => { e.stopPropagation(); void ctl.deleteDrawing(d.id) }}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
