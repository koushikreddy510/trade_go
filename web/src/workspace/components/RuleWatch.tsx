import { useCallback, useEffect, useState } from 'react'
import type { WatchPart, WatchRule } from '../api/types'
import { fmtPrice, shortSymbol } from '../lib/format'
import { useApp } from './context'

const POLL_MS = 10_000
const num = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '-' : fmtPrice(n, d))

function countdown(at: number | null, now: number): string {
  if (!at) return 'market closed'
  const s = Math.max(0, Math.round(at - now / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** One condition (or group) with its values and how far it is from triggering. */
function Part({ p, depth = 0 }: { p: WatchPart; depth?: number }) {
  if (p.children) {
    return (
      <div className="watch-group" style={{ marginLeft: depth * 14 }}>
        <div className="watch-line"><span className={p.met ? 'up' : 'muted'}>{p.met ? '✓' : '○'}</span> <b>{p.type === 'all' ? 'all of' : 'any of'}</b>
          {!p.met && p.distance_pct !== null && p.distance_pct !== undefined && <small className="muted"> · {p.distance_pct.toFixed(2)}% away</small>}</div>
        {p.children.map((c, i) => <Part key={i} p={c} depth={depth + 1} />)}
      </div>
    )
  }
  const close = p.distance_pct === null || p.distance_pct === undefined ? 0 : Math.max(0, 1 - Math.min(p.distance_pct, 5) / 5)   // 5% away = empty bar
  return (
    <div className="watch-line" style={{ marginLeft: depth * 14 }}>
      <span className={p.met ? 'up' : p.on_trigger_side ? 'amber' : 'muted'}>{p.met ? '✓' : '○'}</span> {p.label}
      {p.a !== undefined && <small className="muted"> · now {num(p.a_live ?? p.a)} vs {num(p.b)}</small>}
      {p.state === 'crossed_earlier' && <small className="muted"> · crossed earlier; waits for price to go back and cross again</small>}
      {!p.met && p.distance !== undefined && p.distance !== null && p.distance_pct !== null && p.distance_pct !== undefined && (
        <small className={p.on_trigger_side ? 'amber' : ''}>
          {p.on_trigger_side ? ' · on the trigger side now, waiting for the candle to close' : ` · needs ${p.side === 'below' ? '−' : '+'}${num(Math.abs(p.distance))} (${p.distance_pct.toFixed(2)}%)`}
        </small>
      )}
      {!p.met && p.distance_pct !== null && p.distance_pct !== undefined && <span className="watch-bar"><i style={{ width: `${close * 100}%` }} /></span>}
    </div>
  )
}

/** Every enabled rule: its conditions evaluated now, how close each part is to triggering, the next check, its position. */
export function RuleWatch() {
  const { api, ctl } = useApp()
  const [rows, setRows] = useState<WatchRule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const load = useCallback(() => api.rulesWatch().then((r) => { setRows(r); setError(null) }, (e) => setError(e instanceof Error ? e.message : String(e))), [api])
  useEffect(() => {
    void load()
    const poll = setInterval(() => void load(), POLL_MS)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  if (error) return <div className="panel"><p className="ticket-error">{error}</p></div>
  if (!rows) return <div className="panel"><p className="empty">Evaluating rules…</p></div>
  if (rows.length === 0) return <div className="panel"><p className="empty">No enabled rules.</p></div>
  return (
    <div className="panel rule-watch" aria-label="Rule watch">
      {rows.map((w) => (
        <div key={w.rule.id} className="watch-card">
          <div className="watch-head">
            <button className="link" onClick={() => void ctl.selectSymbol(w.rule.symbol)}>{shortSymbol(w.rule.symbol)}</button>
            <span className="muted">{w.rule.timeframe}</span>
            <span className={w.rule.side === 'BUY' ? 'up' : 'down'}>{w.rule.side === 'BUY' ? 'Buy' : 'Sell'} {w.rule.quantity}</span>
            <span className={w.rule.execution ? 'badge live-on' : 'badge live-off'}>{w.rule.execution ? `LIVE ${w.rule.execution.product === 'I' ? 'Intraday' : w.rule.execution.product === 'F' ? 'MTF' : 'NRML'}` : 'PAPER'}</span>
            <span className="watch-name">{w.rule.name}</span>
            <span className="muted">price {num(w.live)}</span>
            <span className="muted">next check {countdown(w.next_check, now)}</span>
            {!w.rule.enabled && <span className="muted">(rule off; managing its position)</span>}
          </div>
          {w.plan && (
            <div className="watch-plan">
              <div><small className="muted">Stop:</small> {w.plan.stop}
                {w.plan.stop_if_now !== null && <small className="muted"> · if it fired on the last candle: {w.rule.side === 'BUY' ? 'buy' : 'sell'} @ {num(w.plan.entry_if_now)}, stop {num(w.plan.stop_if_now)} (risk {num(Math.abs((w.plan.entry_if_now ?? 0) - w.plan.stop_if_now))}){w.plan.target_if_now !== null ? `, target ${num(w.plan.target_if_now)}` : ''}</small>}
                {w.plan.target && <small className="muted"> · target {w.plan.target}</small>}
              </div>
              <div><small className="muted">Trailing:</small> {w.plan.trail ?? <span className="muted">none (the stop stays where it starts)</span>}</div>
            </div>
          )}
          {w.positions.length === 0 ? <Part p={w.entry} /> : w.positions.map((p) => (
            <div key={p.id} className="watch-position">
              <div className="watch-line">
                <b>In position</b>: {p.side} {p.quantity} @ {num(p.entry_price)} · stop {num(p.stop)}{p.target ? ` · target ${num(p.target)}` : ''}
                {p.unrealized_pnl !== undefined && <span className={p.unrealized_pnl >= 0 ? 'up' : 'down'}> · P&amp;L {num(p.unrealized_pnl)}</span>}
                {p.live_link && <small className="muted"> · live: {p.live_link.state}{p.live_link.note ? ` (${p.live_link.note})` : ''}</small>}
              </div>
              {p.exits.map((e, i) => <div key={i}><small className="muted">exit level {e.level} on {e.timeframe}:</small><Part p={e} depth={1} /></div>)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
