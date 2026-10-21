import { useCallback, useEffect, useState } from 'react'
import type { AccountLimits, LiveOrder, LiveSettings } from '../api/types'
import { fmtPrice, shortSymbol } from '../lib/format'
import { useApp } from './context'

const ACCOUNT = 'flattrade'
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const OPEN = new Set(['submitting', 'open'])

/** Live trading controls for the ticket: on/off and limits for the account, the kill switch, and today's orders. */
export function LiveOrders({ refreshKey }: { refreshKey: number }) {
  const { api } = useApp()
  const [settings, setSettings] = useState<LiveSettings | null>(null)
  const [orders, setOrders] = useState<LiveOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([api.liveSettings(), api.liveOrders()])
      setSettings(s); setOrders(o)
    } catch (e) { setError(errorText(e)) }
  }, [api])
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
  const kill = async () => {
    try { await api.killSwitch(!settings?.kill_switch); await load() } catch (e) { setError(errorText(e)) }
  }
  const cancel = async (id: string) => {
    try { await api.cancelOrder(id); await load() } catch (e) { setError(errorText(e)) }
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
        <button className={settings.kill_switch ? 'small' : 'small danger'} onClick={() => void kill()}>{settings.kill_switch ? 'Release kill switch' : 'Kill switch'}</button>
      </div>
      {error && <p className="ticket-error" role="alert">{error}</p>}
      {orders.length > 0 && (
        <table className="grid">
          <thead><tr><th>Time</th><th>Order</th><th>Price</th><th>Status</th><th /></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{new Date(o.created_at).toLocaleTimeString()}</td>
                <td>{o.side} {o.quantity} {shortSymbol(o.symbol)} <small className="muted">{o.product === 'I' ? 'Intraday' : o.product === 'F' ? 'MTF' : 'NRML'}</small></td>
                <td>{fmtPrice(o.price)}{o.avg_price ? <small className="muted"> filled {fmtPrice(o.avg_price)}</small> : null}</td>
                <td className={o.status === 'complete' ? 'up' : o.status === 'rejected' || o.status === 'failed' ? 'down' : ''} title={o.message ?? ''}>
                  {o.status}{o.filled_units && o.status !== 'complete' ? ` (${o.filled_units} filled)` : ''}{o.message ? ` · ${o.message}` : ''}
                </td>
                <td>{OPEN.has(o.status) && o.broker_order_id && <button className="small danger" onClick={() => void cancel(o.id)}>Cancel</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
