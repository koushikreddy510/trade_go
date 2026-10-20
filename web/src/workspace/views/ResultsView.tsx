import { useEffect, useState } from 'react'
import type { RecentResult } from '../api/types'
import { fmtCrore, fmtPct, fmtPrice, shortSymbol, sign } from '../lib/format'
import { useApp } from '../components/context'

const RANGES = [3, 7, 14, 30]

/** Companies that announced quarterly results recently (from data-store's screener.in / NSE scrapers). */
export function ResultsView() {
  const { api, ctl } = useApp()
  const [days, setDays] = useState(7)
  const [rows, setRows] = useState<RecentResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setRows(null)
    setError(null)
    api.recentResults(days).then((r) => { if (live) setRows(r) }, (e) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [api, days])

  return (
    <div className="view results">
      <div className="screener-top">
        <b>Latest quarterly results</b>
        <div className="presets" role="group" aria-label="Period">
          {RANGES.map((d) => <button key={d} className={d === days ? 'chip active' : 'chip'} onClick={() => setDays(d)}>Last {d} days</button>)}
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows !== null && rows.length === 0 && <p className="empty">No results announced in the last {days} days (or the screener.in scraper hasn’t stored any).</p>}
      {rows !== null && rows.length > 0 && (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Company</th><th>Quarter</th><th>Announced</th><th>Sales (Cr)</th><th>Sales growth</th><th>Net profit (Cr)</th><th>Profit growth</th><th>OPM %</th><th>EPS</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.symbol}-${r.quarter}`}>
                  <td><button className="link" onClick={() => { ctl.setDock('financials'); void ctl.selectSymbol(r.symbol) }}>{shortSymbol(r.symbol)}</button> <span className="muted">{r.company}</span></td>
                  <td>{r.quarter}</td>
                  <td>{r.result_date ?? '—'}</td>
                  <td>{fmtCrore(r.revenue)}</td>
                  <td className={sign(r.revenue_growth_pct)}>{fmtPct(r.revenue_growth_pct, 1)}</td>
                  <td>{fmtCrore(r.net_profit)}</td>
                  <td className={sign(r.profit_growth_pct)}>{fmtPct(r.profit_growth_pct, 1)}</td>
                  <td>{r.opm_pct === null ? '—' : r.opm_pct.toFixed(1)}</td>
                  <td>{fmtPrice(r.eps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
