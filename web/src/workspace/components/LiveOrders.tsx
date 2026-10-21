import { useCallback, useEffect, useState } from 'react'
import type { AccountLimits, LiveOrder, LiveSettings } from '../api/types'
import { fmtPrice, shortSymbol } from '../lib/format'
import { useApp } from './context'

const ACCOUNT = 'flattrade'
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const OPEN = new Set(['submitting', 'open'])

/** Live trading controls for the ticket: on/off and limits for the account, the kill switch, and today's orders. */
export function LiveOrders({ refreshKey = 0, symbol, product, days = 1 }: { refreshKey?: number; symbol?: string; product?: string; days?: number }) {
  const { api } = useApp()
  const [settings, setSettings] = useState<LiveSettings | null>(null)
  const [orders, setOrders] = useState<LiveOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [stopSide, setStopSide] = useState<'SELL' | 'BUY'>('SELL')
  const [stopQty, setStopQty] = useState(1)
  const [stopTrigger, setStopTrigger] = useState('')
  const [moves, setMoves] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([api.liveSettings(), api.liveOrders(days)])
      setSettings(s); setOrders(o)
    } catch (e) { setError(errorText(e)) }
  }, [api, days])
  useEffect(() => { void load() }, [load, refreshKey])
  const anyOpen = orders.some((o) => OPEN.has(o.status))
  useEffect(() => {
    if (!anyOpen) return
    const t = setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [anyOpen, load])

  const limits: AccountLimits | undefined = settings?.accounts[ACCOUNT]
  const toggle = async () => {
    if (!limits) return
    if (!limits.live_enabled && !window.confirm('Turn ON live orders for Flattrade? Orders from the ticket will then be sent to the exchange with real money.')) return
    try { await api.setLiveSettings(ACCOUNT, { live_enabled: !limits.live_enabled }); await load() } catch (e) { setError(errorText(e)) }
  }
  const setApproval = async (on: boolean) => {
    if (!on && !window.confirm('Turn OFF approval? Live rules will then send real entries by themselves, with nobody approving each one.')) return
    try { await api.setLiveSettings(ACCOUNT, { require_approval: on }); await load() } catch (e) { setError(errorText(e)) }
  }
  const kill = async () => {
    try { await api.killSwitch(!settings?.kill_switch); await load() } catch (e) { setError(errorText(e)) }
  }
  const cancel = async (id: string) => {
    try { await api.cancelOrder(id); await load() } catch (e) { setError(errorText(e)) }
  }

  const protect = async () => {
    if (!symbol || !product || !stopTrigger) return
    if (!window.confirm(`Send a LIVE stop-loss?\n\n${stopSide} ${stopQty} ${shortSymbol(symbol)} if the price reaches ${stopTrigger}`)) return
    try {
      await api.placeOrder({ account: ACCOUNT, symbol, side: stopSide, quantity: stopQty, product, price_type: 'SL', trigger_price: Number(stopTrigger) })
      setStopTrigger(''); await load()
    } catch (e) { setError(errorText(e)) }
  }
  const move = async (o: LiveOrder) => {
    const to = Number(moves[o.id])
    if (!to || !window.confirm(`Move the LIVE stop for ${shortSymbol(o.symbol)} from ${o.trigger_price} to ${to}?`)) return
    try { await api.moveStop(o.id, to); setMoves({ ...moves, [o.id]: '' }); await load() } catch (e) { setError(errorText(e)) }
  }

  if (!settings || !limits) return error ? <p className="ticket-error">{error}</p> : null
  return (
    <div className="live-orders" aria-label="Live orders">
      <div className="live-bar">
        <span className={limits.live_enabled && !settings.kill_switch ? 'badge live-on' : 'badge live-off'}>
          LIVE ORDERS {settings.kill_switch ? 'STOPPED' : limits.live_enabled ? 'ON' : 'OFF'}
        </span>
        <small className="muted">max ₹{fmtPrice(limits.max_order_value, 0)} per order · {limits.max_orders_per_day} orders a day</small>
        <button className="small" onClick={() => void toggle()}>{limits.live_enabled ? 'Turn off' : 'Turn on'}</button>
        <label className="approval-toggle" title="When on, a live rule's entry waits for you in Orders → Approvals">
          <input type="checkbox" checked={limits.require_approval !== false} onChange={() => void setApproval(!(limits.require_approval !== false))} />
          approval required{limits.require_approval !== false ? ` (${limits.approval_minutes ?? 5} min)` : ''}
        </label>
        <button className={settings.kill_switch ? 'small' : 'small danger'} onClick={() => void kill()}>{settings.kill_switch ? 'Release kill switch' : 'Kill switch'}</button>
      </div>
      {error && <p className="ticket-error" role="alert">{error}</p>}
      {symbol && product && (
        <div className="stop-form" aria-label="Protect with a stop-loss">
          <small className="muted">Protect with a stop-loss</small>
          <select aria-label="Stop side" value={stopSide} onChange={(e) => setStopSide(e.target.value as 'SELL' | 'BUY')}><option value="SELL">Sell (protects a buy)</option><option value="BUY">Buy (protects a sell)</option></select>
          <input aria-label="Stop quantity" type="number" min={1} step={1} value={stopQty} onChange={(e) => setStopQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          <input aria-label="Stop trigger" type="number" step={0.05} placeholder="trigger" value={stopTrigger} onChange={(e) => setStopTrigger(e.target.value)} />
          <button className="small" disabled={!stopTrigger} onClick={() => void protect()}>Place stop</button>
        </div>
      )}
      {orders.length > 0 && (
        <table className="grid orders-table">
          <thead><tr><th>Time</th><th>Side</th><th>Symbol</th><th>Qty</th><th>Type</th><th>Product</th><th>Price</th><th>Status</th><th>From</th><th /></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{days > 1 ? new Date(o.created_at).toLocaleString() : new Date(o.created_at).toLocaleTimeString()}</td>
                <td className={o.side === 'BUY' ? 'up' : 'down'}><b>{o.side === 'BUY' ? 'Buy' : 'Sell'}</b></td>
                <td>{shortSymbol(o.symbol)}</td>
                <td>{o.quantity}{o.units !== o.quantity ? <small className="muted"> ({o.units})</small> : null}</td>
                <td>{orderType(o)}</td>
                <td>{o.product === 'I' ? 'Intraday' : o.product === 'F' ? 'MTF' : o.product === 'M' ? 'NRML' : o.product}</td>
                <td>{o.trigger_price ? <>stop {fmtPrice(o.trigger_price)} <small className="muted">lmt {fmtPrice(o.price)}</small></> : fmtPrice(o.price)}{o.avg_price ? <small className="muted"> filled {fmtPrice(o.avg_price)}</small> : null}</td>
                <td className={o.status === 'complete' ? 'up' : o.status === 'rejected' || o.status === 'failed' ? 'down' : ''} title={o.message ?? ''}>
                  {o.status}{o.filled_units && o.status !== 'complete' ? ` (${o.filled_units} filled)` : ''}{o.message ? ` · ${o.message}` : ''}
                </td>
                <td><small className="muted">{o.source === 'ticket' ? 'ticket' : o.source.startsWith('rule:') ? `rule${o.purpose ? ` · ${o.purpose}` : ''}` : o.source}</small></td>
                <td className="order-actions">
                  {OPEN.has(o.status) && o.trigger_price && o.broker_order_id && (
                    <span className="move-stop">
                      <input aria-label={`Move stop ${o.id}`} type="number" step={0.05} placeholder="new stop" value={moves[o.id] ?? ''} onChange={(e) => setMoves({ ...moves, [o.id]: e.target.value })} />
                      <button className="small" disabled={!moves[o.id]} onClick={() => void move(o)}>Move</button>
                    </span>
                  )}
                  {OPEN.has(o.status) && o.broker_order_id && <button className="small danger" onClick={() => void cancel(o.id)}>Cancel</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** What was asked for: a market order is sent as a limit just through the spread, so say both. */
function orderType(o: LiveOrder): string {
  if (o.trigger_price || o.order_type === 'SL') return 'Stop-loss'
  return o.order_type === 'MKT' ? 'Market' : 'Limit'
}
