import { fmtPrice, shortSymbol } from '../lib/format'
import { formatIst, tfSeconds } from '../lib/timeframes'
import { useApp, useSel } from './context'

export function SignalsPanel() {
  const { ctl } = useApp()
  const signals = useSel((s) => s.signals)
  const rules = useSel((s) => s.rules)
  const name = (id: string | null) => rules.find((r) => r.id === id)?.name || 'rule'
  return (
    <div className="panel" aria-label="Signals">
      {signals.length === 0 ? <p className="empty">No signals yet. Signals appear when a rule’s condition is true on a completed candle.</p> : (
        <table className="grid">
          <thead><tr><th>Candle closed</th><th>Symbol</th><th>TF</th><th>Rule</th><th>Side</th><th>Entry</th><th>SL</th><th>Target</th><th>Result</th></tr></thead>
          <tbody>
            {signals.map((s) => (
              <tr key={s.id}>
                <td>{formatIst(s.bar_time + tfSeconds(s.timeframe), true)}</td>
                <td><button className="link" onClick={() => void ctl.selectSymbol(s.symbol)}>{shortSymbol(s.symbol)}</button></td>
                <td>{s.timeframe}</td>
                <td>{name(s.rule_id)}</td>
                <td className={s.side === 'BUY' ? 'up' : 'down'}>{s.side}</td>
                <td>{fmtPrice(s.entry)}</td>
                <td>{fmtPrice(s.stop)}</td>
                <td>{fmtPrice(s.target)}</td>
                <td className={s.status === 'open' ? 'up' : 'muted'} title={s.reason}>{s.status === 'open' ? 'Entered' : `Skipped${s.reason ? `: ${s.reason}` : ''}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
