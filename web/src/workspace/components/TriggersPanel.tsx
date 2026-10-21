import { useEffect, useState } from 'react'
import type { Drawing, Rule, WatchPart, WatchRule } from '../api/types'
import { fmtPrice, shortSymbol } from '../lib/format'
import { describeCondition, describeExit } from '../lib/rules'
import { useApp, useSel } from './context'

const KIND_LABEL: Record<string, string> = {
  horizontal_line: 'H-Line',
  trend_line: 'Trend',
  ray: 'Ray',
  rectangle: 'Zone',
  text: 'Text',
}
const PRODUCT: Record<string, string> = { I: 'Intraday', F: 'MTF', M: 'NRML' }

/** Where in a rule a drawing is used: the entry condition, an exit level, the stop or the trail. */
function usesOf(rule: Rule, drawingId: string): string[] {
  const has = (x: unknown) => JSON.stringify(x ?? null).includes(`"${drawingId}"`)
  const out: string[] = []
  if (has(rule.condition)) out.push('entry')
  if (has(rule.exit_condition)) out.push('exit 1')
  if (has(rule.exit_condition_2)) out.push('exit 2')
  if (has(rule.stop)) out.push('stop')
  if (has(rule.trail)) out.push('trail')
  return out
}

/** The line's value now, as the server evaluated it for a rule (exact), from the first leaf that compares against it. */
function serverLevel(p: WatchPart | undefined, label = 'line'): number | null {
  if (!p) return null
  if (p.children) for (const c of p.children) { const v = serverLevel(c, label); if (v !== null) return v }
  return p.label?.includes(label) && p.b !== undefined ? p.b : null
}

/** A straight line through the drawing's two points, at `now` (an estimate: it ignores market-closed gaps). */
function estimateNow(d: Drawing, nowSec: number): number | null {
  const [a, b] = d.points
  if (!a) return null
  if (d.kind === 'horizontal_line' || !b || b.time === a.time) return a.price
  return a.price + ((b.price - a.price) * (nowSec - a.time)) / (b.time - a.time)
}

function state(w: WatchRule): string {
  if (w.positions.length) return `in position (${w.positions.map((p) => `${p.side} ${p.quantity} @ ${fmtPrice(p.entry_price)}, stop ${fmtPrice(p.stop)}`).join('; ')})`
  if (!w.rule.enabled) return 'rule is off'
  const d = w.entry.distance_pct
  if (w.entry.met) return 'condition met on the last candle'
  return d === null || d === undefined ? 'waiting' : `waiting · ${d.toFixed(2)}% away`
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
              const rules = watch.filter((w) => w.rule.symbol === d.symbol && usesOf(w.rule, d.id).length > 0)
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
                    {rules.length === 0 ? <span className="muted">drawing only: no rule acts on it</span> : rules.map((w) => {
                      const r = w.rule
                      return (
                        <div key={r.id} className="trigger-rule">
                          <div>
                            <b className={r.side === 'BUY' ? 'up' : 'down'}>{r.side === 'BUY' ? 'Buy' : 'Sell'} {r.quantity}</b>{' '}
                            <span className={r.execution ? 'badge live-on' : 'badge live-off'}>{r.execution ? `LIVE ${PRODUCT[r.execution.product] ?? r.execution.product}` : 'PAPER'}</span>{' '}
                            <span className="muted">{r.timeframe} · uses the line for {usesOf(r, d.id).join(', ')}</span>{' '}
                            <span>{r.name}</span>
                          </div>
                          <small className="muted">
                            entry: {describeCondition(r.condition, drawings)} (checked on each {r.timeframe} close)
                            {w.plan && <> · stop: {w.plan.stop}{w.plan.stop_if_now !== null ? ` (≈ ${fmtPrice(w.plan.stop_if_now)} if it fired now)` : ''}</>}
                            {w.plan?.trail && <> · trail: {w.plan.trail}</>}
                            {r.exit_condition && <> · exit 1: {describeExit(r.exit_condition, r.exit_timeframe, drawings)}</>}
                            {r.exit_condition_2 && <> · exit 2: {describeExit(r.exit_condition_2, r.exit_timeframe_2, drawings)}</>}
                            {w.plan?.target && <> · target {w.plan.target}</>}
                          </small>
                          <div><small>{state(w)}</small></div>
                        </div>
                      )
                    })}
                  </td>
                </tr>
              )
            })}
        </tbody>
      </table>
    </div>
  )
}
