import { useCallback, useEffect, useState } from 'react'
import type { BrokerStatus } from '../api/types'
import { useApp } from './context'

const NAME: Record<string, string> = { flattrade: 'Flattrade', paytm: 'Paytm Money' }
const STATUS: Record<string, string> = { valid: 'Logged in', rejected: 'Token expired', unknown: 'Could not check', not_configured: 'No token yet' }
const SOURCE: Record<string, string> = { auto: 'unattended login', manual: 'manual login', env: 'server settings' }
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '')

/** Today's broker logins: status, an unattended "Log in now", and a manual fallback (log in on the broker's page, paste where it lands). */
export function BrokerLogins() {
  const { api } = useApp()
  const [rows, setRows] = useState<BrokerStatus[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pasted, setPasted] = useState<Record<string, string>>({})
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const load = useCallback(() => api.brokers().then(setRows, (e) => setNote({ ok: false, text: String(e instanceof Error ? e.message : e) })), [api])
  useEffect(() => { void load() }, [load])

  const login = async (broker: string, code?: string) => {
    setBusy(broker); setNote(null)
    try {
      await api.brokerLogin(broker, code)
      setNote({ ok: true, text: `${NAME[broker]}: logged in; the live feed reconnects with the new token.` })
      setPasted({ ...pasted, [broker]: '' })
      await load()
    } catch (e) {
      setNote({ ok: false, text: `${NAME[broker]}: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  if (!rows) return <p className="muted">Checking broker logins…</p>
  return (
    <div className="broker-logins" aria-label="Broker logins">
      {note && <p className={note.ok ? 'up' : 'error'} role="status">{note.text}</p>}
      <table className="grid">
        <thead><tr><th>Broker</th><th>Today's token</th><th>Log in</th></tr></thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.broker}>
              <td><b>{NAME[b.broker] ?? b.broker}</b><br /><small className="muted">{b.auto_login ? 'Logs in by itself at 07:45 (Mon-Fri)' : 'Unattended login not set up'}</small></td>
              <td>
                <span className={b.status === 'valid' ? 'up' : 'down'}>{STATUS[b.status] ?? b.status}</span>
                {b.detail && <small className="muted"> · {b.detail}</small>}
                {b.obtained_at && <><br /><small className="muted">{SOURCE[b.source ?? ''] ?? b.source}, {when(b.obtained_at)}</small></>}
              </td>
              <td className="broker-actions">
                {b.auto_login && <button className="primary" disabled={busy !== null} onClick={() => void login(b.broker)}>{busy === b.broker ? 'Logging in…' : 'Log in now'}</button>}
                {b.login_url ? (
                  <span className="broker-manual">
                    <a href={b.login_url} target="_blank" rel="noreferrer">Open {NAME[b.broker]} login</a>
                    <input aria-label={`${NAME[b.broker]} redirect URL`} placeholder="then paste the address it lands on" value={pasted[b.broker] ?? ''} onChange={(e) => setPasted({ ...pasted, [b.broker]: e.target.value })} />
                    <button disabled={busy !== null || !(pasted[b.broker] ?? '').trim()} onClick={() => void login(b.broker, pasted[b.broker].trim())}>Use it</button>
                  </span>
                ) : <small className="muted">No API key on the server ({b.broker.toUpperCase()}_API_KEY)</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
