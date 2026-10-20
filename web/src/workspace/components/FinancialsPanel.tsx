import { useState } from 'react'
import type { FinancialRow } from '../api/types'
import { fmtCrore, fmtPct, fmtPrice, sign } from '../lib/format'
import { useSel } from './context'

type Metric = { key: keyof FinancialRow; label: string; fmt: (n: number | null) => string; growth?: boolean }
const METRICS: Metric[] = [
  { key: 'revenue', label: 'Sales', fmt: fmtCrore },
  { key: 'operating_profit', label: 'Operating profit', fmt: fmtCrore },
  { key: 'opm_pct', label: 'OPM %', fmt: (n) => fmtPct(n, 1).replace('+', '') },
  { key: 'net_profit', label: 'Net profit', fmt: fmtCrore },
  { key: 'eps', label: 'EPS', fmt: (n) => fmtPrice(n) },
  { key: 'revenue_growth_pct', label: 'Sales growth', fmt: (n) => fmtPct(n, 1), growth: true },
  { key: 'profit_growth_pct', label: 'Profit growth', fmt: (n) => fmtPct(n, 1), growth: true },
]
const RATIO_LABELS: Record<string, string> = {
  pe_ratio: 'P/E', pb_ratio: 'P/B', market_cap_cr: 'Market cap (Cr)', dividend_yield: 'Div yield %', roce_pct: 'ROCE %', roe_pct: 'ROE %',
}

export function FinancialsPanel() {
  const f = useSel((s) => s.financials)
  const loading = useSel((s) => s.financialsLoading)
  const [mode, setMode] = useState<'quarterly' | 'annual'>('quarterly')

  if (loading && !f) return <div className="panel"><p className="empty">Loading financials…</p></div>
  if (!f || !f.available) {
    return <div className="panel" aria-label="Financials"><p className="empty">No financial data for this symbol. Fundamentals come from the screener.in scraper in data-store; indices and symbols it hasn’t covered have none.</p></div>
  }
  const rows = (mode === 'quarterly' ? f.quarterly : f.annual).slice(-8)
  const ratios = Object.entries(f.ratios).filter(([, v]) => v !== null && v !== undefined)

  return (
    <div className="panel financials" aria-label="Financials">
      <div className="panel-head">
        <b>{f.company}</b>
        <span className="seg">
          <button className={mode === 'quarterly' ? 'chip active' : 'chip'} onClick={() => setMode('quarterly')}>Quarterly</button>
          <button className={mode === 'annual' ? 'chip active' : 'chip'} onClick={() => setMode('annual')}>Annual</button>
        </span>
        {f.announcements.length > 0 && (
          <span className="announce">
            {f.announcements.slice(0, 3).map((a) => <span key={`${a.result_date}-${a.quarter}`} className="chip tag" title="Announced results date">{a.quarter} results {a.result_date ?? ''}</span>)}
          </span>
        )}
      </div>
      {ratios.length > 0 && (
        <div className="ratios">
          {ratios.map(([k, v]) => <span key={k}><small>{RATIO_LABELS[k] ?? k.replace(/_/g, ' ')}</small> <b>{fmtPrice(v as number, Math.abs(v as number) >= 100 ? 0 : 2)}</b></span>)}
        </div>
      )}
      {rows.length === 0 ? <p className="empty">No {mode} figures stored.</p> : (
        <table className="grid fin">
          <thead><tr><td />{rows.map((r) => <th scope="col" key={r.period}>{r.period}</th>)}</tr></thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.key}>
                <th scope="row">{m.label}</th>
                {rows.map((r) => {
                  const v = r[m.key] as number | null
                  return <td key={r.period} className={m.growth ? sign(v) : ''}>{m.fmt(v)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
