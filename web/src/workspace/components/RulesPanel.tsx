import { describeCondition, describeExit, describeStop, describeTarget, describeTrail, newDraft } from '../lib/rules'
import { shortSymbol } from '../lib/format'
import { useApp, useSel } from './context'

export function RulesPanel() {
  const { ctl } = useApp()
  const rules = useSel((s) => s.rules)
  const symbol = useSel((s) => s.symbol)
  const timeframe = useSel((s) => s.timeframe)
  return (
    <div className="panel" aria-label="Rules">
      <div className="panel-head">
        <b>Entry rules</b>
        <button className="small primary" onClick={() => ctl.openRuleDialog(newDraft(symbol, timeframe))}>+ New rule for {shortSymbol(symbol)}</button>
      </div>
      {rules.length === 0 ? <p className="empty">No rules. A rule watches completed candles and opens a paper position when its condition becomes true.</p> : (
        <ul className="cards">
          {rules.map((r) => (
            <li key={r.id} className={r.enabled ? 'card' : 'card off'}>
              <div className="card-head">
                <b>{r.name || 'Untitled rule'}</b>
                <span className="muted">{shortSymbol(r.symbol)} · {r.timeframe} · {r.side} {r.quantity}{r.once ? ' · once' : ''}</span>
              </div>
              <p>When {describeCondition(r.condition)}.</p>
              <p className="muted">{describeStop(r.stop)}, {describeTarget(r.target)}.</p>
              {(r.trail || r.exit_condition) && <p className="muted">{[r.trail && describeTrail(r.trail), r.exit_condition && describeExit(r.exit_condition, r.exit_timeframe)].filter(Boolean).join('; ')}.</p>}
              <div className="card-actions">
                <label><input type="checkbox" checked={r.enabled} onChange={(e) => void ctl.toggleRule(r.id, e.target.checked)} /> {r.enabled ? 'On' : 'Off'}</label>
                <button className="small" onClick={() => ctl.openRuleDialog(r)}>Edit</button>
                <button className="small danger" onClick={() => { if (window.confirm('Delete this rule?')) void ctl.deleteRule(r.id) }}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
