import type { Position } from '../api/types'
import { describeExit, describeTrail } from '../lib/rules'
import { distanceToExit, livePnl, totalPnl } from '../lib/positions'
import { fmtPnl, fmtPrice, shortSymbol, sign } from '../lib/format'
import { formatIst } from '../lib/timeframes'
import { useApp, useSel } from './context'

export function PositionsPanel() {
  const { ctl } = useApp()
  const open = useSel((s) => s.positions.open)
  const closed = useSel((s) => s.positions.closed)
  const quotes = useSel((s) => s.quotes)
  const { total, known } = totalPnl(open, quotes)

  return (
    <div className="panel" aria-label="Positions">
      <div className="panel-head">
        <b>Open paper positions</b>
        {open.length > 0 && <span className={`pnl ${sign(total)}`} data-testid="total-pnl">{fmtPnl(total)}{known < open.length ? ' (partial)' : ''}</span>}
      </div>
      {open.length === 0 ? <p className="empty">No open positions. A rule that fires on a completed candle opens one here.</p> : (
        <table className="grid">
          <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Last</th><th>SL</th><th>Target</th><th>P&amp;L</th><th /></tr></thead>
          <tbody>
            {open.map((p) => {
              const q = quotes[p.symbol]
              const price = q?.price ?? p.last_price
              const pnl = livePnl(p, q)
              const near = distanceToExit(p, price)
              return (
                <tr key={p.id}>
                  <td><button className="link" onClick={() => void ctl.selectSymbol(p.symbol)}>{shortSymbol(p.symbol)}</button></td>
                  <td className={p.side === 'BUY' ? 'up' : 'down'}>{p.side}</td>
                  <td>{p.quantity}</td>
                  <td>{fmtPrice(p.entry_price)}</td>
                  <td>{fmtPrice(price)}</td>
                  <td className="down" title={[near.stopPct === null ? '' : `${near.stopPct.toFixed(2)}% away`, p.trail ? describeTrail(p.trail) : '', p.initial_stop != null && p.initial_stop !== p.stop ? `started at ${fmtPrice(p.initial_stop)}` : '', p.exit_condition ? describeExit(p.exit_condition, p.exit_timeframe) : ''].filter(Boolean).join(' · ')}>
                    {fmtPrice(p.stop)}{p.trail ? ' ↗' : ''}
                  </td>
                  <td className="up" title={near.targetPct === null ? '' : `${near.targetPct.toFixed(2)}% away`}>{fmtPrice(p.target)}</td>
                  <td className={sign(pnl)} data-testid={`pnl-${p.id}`}>{fmtPnl(pnl)}</td>
                  <td><button className="small" onClick={() => void ctl.closePosition(p.id)} disabled={price === undefined} title={price === undefined ? 'Waiting for a price' : 'Close at the latest price'}>Close</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {closed.length > 0 && (
        <>
          <div className="panel-head"><b>Closed</b></div>
          <table className="grid">
            <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Why</th><th>P&amp;L</th><th>Closed</th></tr></thead>
            <tbody>
              {closed.map((p) => (
                <tr key={p.id}>
                  <td>{shortSymbol(p.symbol)}</td>
                  <td className={p.side === 'BUY' ? 'up' : 'down'}>{p.side}</td>
                  <td>{p.quantity + (p.exit_qty_1 ?? 0)}</td>
                  <td>{fmtPrice(p.entry_price)}</td>
                  <td>{p.exit_qty_1 ? <>{fmtPrice(p.exit_price_1)} / {fmtPrice(p.exit_price)}</> : fmtPrice(p.exit_price)}</td>
                  <td>{p.exit_reason ? p.exit_reason.replace(/_/g, ' ') : '—'}</td>
                  <td className={sign(closedResult(p))}>{fmtPnl(closedResult(p))}</td>
                  <td>{p.closed_at ? formatIst(p.closed_at, true) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

/** A closed position's whole result: a 2-level exit's first half (exit_pnl_1) plus the rest. */
function closedResult(p: Position): number | null {
  return p.realized_pnl === null ? null : p.realized_pnl + (p.exit_pnl_1 ?? 0)
}
