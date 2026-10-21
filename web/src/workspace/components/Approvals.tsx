import { useCallback, useEffect, useState } from 'react'
import type { Approval } from '../api/types'
import { fmtPrice, shortSymbol } from '../lib/format'
import { useApp, useSel } from './context'

const PRODUCT: Record<string, string> = { I: 'Intraday', F: 'MTF', M: 'NRML' }
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Pending approvals, refreshed every 5 s (shared by the top-bar badge and the Orders tab). */
export function usePendingApprovals(): Approval[] {
  const { api } = useApp()
  const [rows, setRows] = useState<Approval[]>([])
  useEffect(() => {
    let live = true
    const load = () => api.approvals(true).then((r) => { if (live) setRows(r) }, () => {})
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => { live = false; clearInterval(t) }
  }, [api])
  return rows
}

function left(expires: string, now: number): string {
  const s = Math.max(0, Math.round((Date.parse(expires) - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Live rule entries waiting for a person: approve sends the real order (stop and exits then follow), reject sends nothing. */
export function Approvals() {
  const { api } = useApp()
  const quotes = useSel((s) => s.quotes)
  const [rows, setRows] = useState<Approval[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const load = useCallback(() => api.approvals(false).then(setRows, (e) => setError(errorText(e))), [api])
  useEffect(() => {
    void load()
    const poll = setInterval(() => void load(), 5000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  const decide = async (a: Approval, approve: boolean) => {
    if (approve && !window.confirm(`Send this LIVE order now?\n\n${a.side} ${a.quantity} ${shortSymbol(a.symbol)} · ${PRODUCT[a.product] ?? a.product} · at market\nstop ${fmtPrice(a.stop)} (placed automatically after the fill)`)) return
    setBusy(a.id); setError(null)
    try { await api.decideApproval(a.id, approve); await load() } catch (e) { setError(errorText(e)); await load() } finally { setBusy(null) }
  }

  const pending = rows.filter((a) => a.status === 'pending')
  const recent = rows.filter((a) => a.status !== 'pending').slice(0, 5)
  if (rows.length === 0 && !error) return null
  return (
    <div className="approvals" aria-label="Approvals">
      <div className="panel-head"><b>Approvals</b><small className="muted">A live rule's entry waits here; its stop and exits never wait.</small></div>
      {error && <p className="ticket-error" role="alert">{error}</p>}
      {pending.map((a) => {
        const live = quotes[a.symbol]?.price
        return (
          <div key={a.id} className="approval pending">
            <div>
              <b className={a.side === 'BUY' ? 'up' : 'down'}>{a.side === 'BUY' ? 'Buy' : 'Sell'} {a.quantity} {shortSymbol(a.symbol)}</b>{' '}
              <span className="badge live-on">LIVE {PRODUCT[a.product] ?? a.product}</span>{' '}
              <span className="muted">rule “{a.rule_name ?? a.rule_id}”</span>
            </div>
            <small className="muted">
              signal @ {fmtPrice(a.signal_price)}{live ? ` · now ${fmtPrice(live)}` : ''} · stop {fmtPrice(a.stop)}{a.target ? ` · target ${fmtPrice(a.target)}` : ''}
              {a.reason ? ` · ${a.reason}` : ''}
            </small>
            <div className="approval-actions">
              <span className="amber">expires in {left(a.expires_at, now)}</span>
              <button className="primary live" disabled={busy !== null} onClick={() => void decide(a, true)}>{busy === a.id ? 'Sending…' : 'Approve'}</button>
              <button className="small" disabled={busy !== null} onClick={() => void decide(a, false)}>Reject</button>
            </div>
          </div>
        )
      })}
      {recent.length > 0 && (
        <small className="muted">recent: {recent.map((a) => `${a.side} ${a.quantity} ${shortSymbol(a.symbol)} ${a.status}${a.note ? ` (${a.note})` : ''}`).join(' · ')}</small>
      )}
    </div>
  )
}

/** Top-bar badge: how many live entries wait for approval; a click opens the Orders tab. */
export function ApprovalBadge() {
  const { ctl } = useApp()
  const pending = usePendingApprovals()
  if (pending.length === 0) return null
  return (
    <button className="badge approval-badge" title="Live rule entries waiting for your approval" onClick={() => { ctl.setView('chart'); ctl.setDock('orders') }}>
      ⏳ {pending.length} approval{pending.length > 1 ? 's' : ''}
    </button>
  )
}
