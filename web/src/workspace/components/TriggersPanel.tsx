import { useEffect, useState } from 'react'
import type { Drawing } from '../api/types'
import { fmtPrice, shortSymbol } from '../lib/format'
import { useApp, useSel } from './context'

const KIND_LABEL: Record<string, string> = {
  horizontal_line: 'H-Line',
  trend_line: 'Trend',
  ray: 'Ray',
  rectangle: 'Zone',
  text: 'Text',
}

export function TriggersPanel() {
  const { api, ctl } = useApp()
  const quotes = useSel((s) => s.quotes)
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void api.allDrawings().then((ds) => { if (live) { setDrawings(ds); setLoading(false) } }).catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [api])

  if (loading) return <div className="panel"><p className="empty">Loading…</p></div>

  // Group by symbol, only horizontal lines and rays (actual price levels)
  const priceLevels = drawings.filter((d) => d.kind === 'horizontal_line' || d.kind === 'ray' || d.kind === 'trend_line')
  if (priceLevels.length === 0) {
    return (
      <div className="panel" aria-label="Triggers">
        <p className="empty">No drawn levels yet. Draw horizontal lines on any chart to see them here as price triggers.</p>
      </div>
    )
  }

  return (
    <div className="panel" aria-label="Triggers">
      <div className="panel-head">
        <b>Price levels across all charts</b>
        <span className="count-label">{priceLevels.length} level{priceLevels.length !== 1 ? 's' : ''}</span>
      </div>
      <table className="grid">
        <thead>
          <tr><th>Symbol</th><th>Type</th><th>Price</th><th>Label</th><th>Dist %</th></tr>
        </thead>
        <tbody>
          {priceLevels
            .slice()
            .sort((a, b) => a.symbol.localeCompare(b.symbol))
            .map((d) => {
              const price = d.points[0]?.price ?? null
              const quote = quotes[d.symbol]
              const dist = price != null && quote ? ((price - quote.price) / quote.price) * 100 : null
              return (
                <tr key={d.id} className="trigger-row">
                  <td>
                    <button className="link" onClick={() => void ctl.selectSymbol(d.symbol)}>
                      {shortSymbol(d.symbol)}
                    </button>
                  </td>
                  <td>{KIND_LABEL[d.kind] ?? d.kind}</td>
                  <td>{price != null ? fmtPrice(price) : '—'}</td>
                  <td className="trigger-label">{d.label || '—'}</td>
                  <td className={dist == null ? '' : dist >= 0 ? 'up' : 'down'}>
                    {dist == null ? '—' : `${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%`}
                  </td>
                </tr>
              )
            })}
        </tbody>
      </table>
    </div>
  )
}
