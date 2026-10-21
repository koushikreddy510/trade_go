import { useCallback, useEffect, useState } from 'react'
import type { LivePosition } from '../api/types'
import { fmtPnl, fmtPrice, shortSymbol, sign } from '../lib/format'
import { useApp, useSel } from './context'

const PRODUCT: Record<string, string> = { I: 'Intraday', F: 'MTF', M: 'NRML' }
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** What this app holds on the real account (from its own fills), with live P&L, its stops, and a close button. */
export function LivePositions() {
  const { api } = useApp()
  const quotes = useSel((s) => s.quotes)
  const [rows, setRows] = useState<LivePosition[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => api.livePositions().then((r) => { setRows(r); setError(null) }, (e) => setError(errorText(e))), [api])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  const close = async (p: LivePosition) => {
    const side = p.units > 0 ? 'SELL' : 'BUY'
    if (!window.confirm(`Close this LIVE position at market?\n\n${side} ${p.quantity} ${shortSymbol(p.symbol)} (${PRODUCT[p.product] ?? p.product})`)) return
    try {
      for (const s of p.stops) await api.cancelOrder(s.id)          // its stops first, so they cannot fire after the close
      await api.placeOrder({ account: p.account, symbol: p.symbol, side, quantity: p.quantity, product: p.product, price_type: 'MKT' })
      await load()
    } catch (e) { setError(errorText(e)) }
  }

  const open = rows.filter((p) => p.units !== 0)
  const closedToday = rows.filter((p) => p.units === 0)
  if (rows.length === 0 && !error) return null
  return (
    <div aria-label="Live positions">
      <div className="panel-head"><b>Live positions (placed from this app)</b>
        {closedToday.length > 0 && <small className="muted">closed: {closedToday.map((p) => `${shortSymbol(p.symbol)} ${fmtPnl(p.realized)}`).join(' · ')}</small>}
      </div>
      {error && <p className="ticket-error" role="alert">{error}</p>}
      {open.length > 0 && (
        <table className="grid">
          <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Product</th><th>Avg</th><th>LTP</th><th>P&amp;L</th><th>Stops</th><th /></tr></thead>
          <tbody>
            {open.map((p) => {
              const ltp = quotes[p.symbol]?.price ?? p.ltp
              const pnl = ltp ? (ltp - p.avg_price) * p.units : p.unrealized
              return (
                <tr key={`${p.account}:${p.symbol}:${p.product}`}>
                  <td>{shortSymbol(p.symbol)}</td>
                  <td className={p.units > 0 ? 'up' : 'down'}>{p.units > 0 ? 'BUY' : 'SELL'}</td>
                  <td>{p.quantity}</td>
                  <td>{PRODUCT[p.product] ?? p.product}</td>
                  <td>{fmtPrice(p.avg_price)}</td>
                  <td>{fmtPrice(ltp)}</td>
                  <td className={sign(pnl)}>{fmtPnl(pnl)}{p.realized ? <small className="muted"> (booked {fmtPnl(p.realized)})</small> : null}</td>
                  <td>{p.stops.length ? p.stops.map((s) => `${s.quantity} @ ${fmtPrice(s.trigger_price)}`).join(', ') : <span className="down">none</span>}</td>
                  <td><button className="small danger" onClick={() => void close(p)}>Close</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
