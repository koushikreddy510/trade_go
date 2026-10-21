import { useEffect, useState } from 'react'
import type { Drawing, WatchRule } from '../api/types'
import { fmtPrice, shortSymbol } from '../lib/format'
import { useApp, useSel } from './context'
import { LineRules, rulesOnLine, serverLevel } from './LineRules'

const KIND_LABEL: Record<string, string> = {
  horizontal_line: 'H-Line',
  trend_line: 'Trend',
  ray: 'Ray',
  rectangle: 'Zone',
  text: 'Text',
}
/** A straight line through the drawing's two points, at `now` (an estimate: it ignores market-closed gaps). */
function estimateNow(d: Drawing, nowSec: number): number | null {
  const [a, b] = d.points
  if (!a) return null
  if (d.kind === 'horizontal_line' || !b || b.time === a.time) return a.price
  return a.price + ((b.price - a.price) * (nowSec - a.time)) / (b.time - a.time)
}

/** Drawn price levels and, for each, the rules that act on it: direction, size, live or paper, conditions, stop and trail. */
export function TriggersPanel() {
  const { api, ctl } = useApp()
  const quotes = useSel((s) => s.quotes)
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [watch, setWatch] = useState<WatchRule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    const load = () => Promise.all([api.allDrawings(), api.rulesWatch().catch(() => [] as WatchRule[])])
      .then(([ds, w]) => { if (live) { setDrawings(ds); setWatch(w); setLoading(false) } })
      .catch(() => { if (live) setLoading(false) })
    void load()
    const t = setInterval(() => void load(), 15_000)
    return () => { live = false; clearInterval(t) }
  }, [api])

  if (loading) return <div className="panel"><p className="empty">Loading…</p></div>

  const priceLevels = drawings.filter((d) => d.kind === 'horizontal_line' || d.kind === 'ray' || d.kind === 'trend_line')
  if (priceLevels.length === 0) {
    return (
      <div className="panel" aria-label="Triggers">
        <p className="empty">No drawn levels yet. Draw a line on a chart, then create a rule on it to turn it into a trigger.</p>
      </div>
    )
  }
  const nowSec = Date.now() / 1000

  return (
    <div className="panel" aria-label="Triggers">
      <div className="panel-head">
        <b>Price levels across all charts</b>
        <span className="count-label">{priceLevels.length} level{priceLevels.length !== 1 ? 's' : ''}</span>
        <small className="muted">A line only trades when a rule uses it; lines without a rule are drawings only.</small>
      </div>
      <table className="grid triggers-table">
        <thead>
          <tr><th>Symbol</th><th>Type</th><th>Level now</th><th>Label</th><th>Dist %</th><th>What acts on it</th></tr>
        </thead>
        <tbody>
          {priceLevels
            .slice()
            .sort((a, b) => a.symbol.localeCompare(b.symbol))
            .map((d) => {
              const rules = rulesOnLine(watch, d)
              const exact = rules.map((w) => serverLevel(w.entry)).find((v) => v !== null) ?? null
              const level = exact ?? estimateNow(d, nowSec)
              const quote = quotes[d.symbol]
              const dist = level != null && quote ? ((level - quote.price) / quote.price) * 100 : null
              return (
                <tr key={d.id} className="trigger-row">
                  <td>
                    <button className="link" onClick={() => void ctl.selectSymbol(d.symbol)}>{shortSymbol(d.symbol)}</button>
                  </td>
                  <td>{KIND_LABEL[d.kind] ?? d.kind}</td>
                  <td>{level != null ? `${exact === null && d.kind !== 'horizontal_line' ? '≈ ' : ''}${fmtPrice(level)}` : '—'}</td>
                  <td className="trigger-label">{d.label || '—'}</td>
                  <td className={dist == null ? '' : dist >= 0 ? 'up' : 'down'}>{dist == null ? '—' : `${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%`}</td>
                  <td className="trigger-rules">
                    <LineRules drawing={d} drawings={drawings} watch={watch} />
                  </td>
                </tr>
              )
            })}
        </tbody>
      </table>
    </div>
  )
}
