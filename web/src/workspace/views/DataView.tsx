import { useCallback, useEffect, useState } from 'react'
import type { DataJobDef, DataOverview } from '../api/types'
import { BrokerLogins } from '../components/BrokerLogins'
import { useApp } from '../components/context'

export const DATA_POLL_MS = 3000
const when = (iso: string | null | undefined) => (iso ? iso.replace('T', ' ').slice(0, 16) : 'never')
const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '—')
/** Whole days between an ISO date and now. */
const age = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null)

/** The screener's own name for each job, to show its progress next to the button that starts it. */
const RUNNING_AS: Record<string, string> = { ohlcv: 'ohlcv', financials: 'financials', latest_results: 'latest_results', screener_latest: 'screener_latest', sectors: 'sectors' }

/** Data: how complete and fresh the market data is, and the buttons that run the scrapers. */
export function DataView() {
  const { api } = useApp()
  const [data, setData] = useState<DataOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [args, setArgs] = useState<Record<string, Record<string, string>>>({})
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))
  const load = useCallback(() => api.dataStatus().then((d) => { setData(d); setError(null) }, fail), [api])

  useEffect(() => { void load() }, [load])
  const busy = data?.jobs ? Object.values(data.jobs).some((j) => j.status === 'running' || j.status === 'starting') : false
  useEffect(() => {
    if (!busy) return
    const timer = setTimeout(() => void load(), DATA_POLL_MS)
    return () => clearTimeout(timer)
  }, [busy, data, load])

  const run = async (job: DataJobDef) => {
    setNote(null)
    try {
      const params = Object.fromEntries(Object.entries(args[job.id] ?? {}).filter(([, v]) => v !== ''))
      const r = await api.runDataJob({ job: job.id, ...params })
      setNote(`${job.label}: ${r.status ?? 'done'}`)
      await load()
    } catch (e) { fail(e) }
  }

  const s = data?.status
  const stale = age(s?.ohlcv_1d?.latest)
  const todo: string[] = []
  if (s?.symbols && s.symbols.total - s.symbols.with_sector > 0) todo.push(`${s.symbols.total - s.symbols.with_sector} stocks have no sector yet, so they are missing from sector analysis (run “Sectors and market cap”).`)
  if (s?.symbols && s.symbols.total > 0 && (s.financials?.companies ?? 0) < s.symbols.total / 2) todo.push('Financials exist for fewer than half the stocks (run “Financials”, then the screener’s ratios fill in).')
  if (stale !== null && stale > 4) todo.push(`The newest daily candle is ${stale} days old (run “Daily candles”).`)

  return (
    <div className="data-view">
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="bt-cards">
            <Card label="Stocks" value={s?.symbols ? String(s.symbols.total) : '—'} sub={s?.symbols ? `${pct(s.symbols.with_sector, s.symbols.total)} with a sector · ${pct(s.symbols.with_market_cap, s.symbols.total)} with market cap` : ''} />
            <Card label="Daily candles" value={s?.ohlcv_1d?.latest ?? '—'} sub={s?.ohlcv_1d ? `${s.ohlcv_1d.symbols_on_latest} stocks on that day · ${s.ohlcv_1d.symbols} in all` : ''} />
            <Card label="Financials" value={s?.financials ? String(s.financials.companies) : '—'} sub={`companies · last scraped ${when(s?.financials?.latest_scraped)}`} />
            <Card label="Results announced" value={s?.results?.latest ?? '—'} sub={s?.results ? `${s.results.last_7_days} in the last 7 days · ${s.results.total} in all` : ''} />
          </div>
          {todo.length > 0 && <ul className="data-todo" aria-label="What needs attention">{todo.map((t) => <li key={t}>{t}</li>)}</ul>}

          <h4>Broker logins</h4>
          <BrokerLogins />

          <h4>Jobs</h4>
          {data.jobs_error && <p className="error" role="alert">Job status unavailable: {data.jobs_error}</p>}
          {note && <p role="status">{note}</p>}
          <table className="grid data-jobs">
            <thead><tr><th>Job</th><th>Options</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.catalog.map((job) => {
                const st = data.jobs?.[RUNNING_AS[job.id]]
                const running = st?.status === 'running' || st?.status === 'starting'
                return (
                  <tr key={job.id}>
                    <td><b>{job.label}</b><br /><small className="muted">{job.help}</small></td>
                    <td>
                      {Object.entries(job.params).map(([name, allowed]) => (
                        <label key={name} className="data-param">{name}
                          {typeof allowed[0] === 'string'
                            ? <select value={args[job.id]?.[name] ?? ''} onChange={(e) => setArgs({ ...args, [job.id]: { ...args[job.id], [name]: e.target.value } })}><option value="">default</option>{(allowed as string[]).map((a) => <option key={a}>{a}</option>)}</select>
                            : <input type="number" min={allowed[0] as number} max={allowed[1] as number} placeholder="default" value={args[job.id]?.[name] ?? ''} onChange={(e) => setArgs({ ...args, [job.id]: { ...args[job.id], [name]: e.target.value } })} />}
                        </label>
                      ))}
                    </td>
                    <td>{st ? <span className={st.status === 'failed' ? 'down' : st.status === 'completed' ? 'up' : ''}>{st.status}{st.progress ? ` · ${st.progress}` : ''}{st.error ? ` · ${st.error}` : ''}{st.finished_at ? ` · ${when(st.finished_at)}` : ''}</span> : <span className="muted">—</span>}</td>
                    <td><button className="primary small" disabled={running} onClick={() => void run(job)}>{running ? 'Running…' : 'Run'}</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <h4>Symbol list changes</h4>
          {!s?.changes
            ? <p className="muted">Nothing to compare with yet: the first daily digest (or a symbol sync) records today’s list.</p>
            : s.changes.added_total + s.changes.removed_total === 0
              ? <p className="muted">No stocks added or removed since the last digest.</p>
              : (
                <div className="data-changes">
                  <div><b className="up">Added ({s.changes.added_total})</b><p>{s.changes.added.join(', ') || '—'}</p></div>
                  <div><b className="down">Removed ({s.changes.removed_total})</b><p>{s.changes.removed.join(', ') || '—'}</p></div>
                </div>
              )}
        </>
      )}
    </div>
  )
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="bt-card"><span className="muted">{label}</span><b>{value}</b><small className="muted">{sub}</small></div>
}
