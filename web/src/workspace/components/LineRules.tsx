import { useEffect, useState } from 'react'
import type { Drawing, Rule, WatchPart, WatchRule } from '../api/types'
import { fmtPrice } from '../lib/format'
import { describeCondition, describeExit } from '../lib/rules'
import { useApp } from './context'

const PRODUCT: Record<string, string> = { I: 'Intraday', F: 'MTF', M: 'NRML' }

/** The rule watch, refreshed every 15 s: shared by the Drawings and Triggers panels. */
export function useRuleWatch(): WatchRule[] {
  const { api } = useApp()
  const [rows, setRows] = useState<WatchRule[]>([])
  useEffect(() => {
    let live = true
    const load = () => api.rulesWatch().then((r) => { if (live) setRows(r) }, () => {})
    void load()
    const t = setInterval(() => void load(), 15_000)
    return () => { live = false; clearInterval(t) }
  }, [api])
  return rows
}

/** Where in a rule a drawing is used: the entry condition, an exit level, the stop or the trail. */
export function usesOf(rule: Rule, drawingId: string): string[] {
  const has = (x: unknown) => JSON.stringify(x ?? null).includes(`"${drawingId}"`)
  const out: string[] = []
  if (has(rule.condition)) out.push('entry')
  if (has(rule.exit_condition)) out.push('exit 1')
  if (has(rule.exit_condition_2)) out.push('exit 2')
  if (has(rule.stop)) out.push('stop')
  if (has(rule.trail)) out.push('trail')
  return out
}

export function rulesOnLine(watch: WatchRule[], d: Drawing): WatchRule[] {
  return watch.filter((w) => w.rule.symbol === d.symbol && usesOf(w.rule, d.id).length > 0)
}

/** The line's value now as the server evaluated it for a rule (exact), from the first part that compares against it. */
export function serverLevel(p: WatchPart | undefined): number | null {
  if (!p) return null
  if (p.children) for (const c of p.children) { const v = serverLevel(c); if (v !== null) return v }
  return p.label?.includes('line') && p.b !== undefined ? p.b : null
}

function state(w: WatchRule): string {
  if (w.positions.length) return `in position: ${w.positions.map((p) => `${p.side} ${p.quantity} @ ${fmtPrice(p.entry_price)}, stop ${fmtPrice(p.stop)}`).join('; ')}`
  if (!w.rule.enabled) return 'rule is off'
  if (w.entry.met) return 'condition met on the last candle'
  const d = w.entry.distance_pct
  return d === null || d === undefined ? 'waiting' : `waiting · ${d.toFixed(2)}% away`
}

/** Every rule that uses this drawing: direction, size, live or paper, conditions, stop-loss, trailing, exits, state. */
export function LineRules({ drawing, drawings, watch }: { drawing: Drawing; drawings: Drawing[]; watch: WatchRule[] }) {
  const rules = rulesOnLine(watch, drawing)
  if (rules.length === 0) return <small className="muted">Drawing only: no rule acts on this line.</small>
  return (
    <div className="line-rules">
      {rules.map((w) => {
        const r = w.rule
        return (
          <div key={r.id} className="trigger-rule">
            <div>
              <b className={r.side === 'BUY' ? 'up' : 'down'}>{r.side === 'BUY' ? 'Buy' : 'Sell'} {r.quantity}</b>{' '}
              <span className={r.execution ? 'badge live-on' : 'badge live-off'}>{r.execution ? `LIVE ${PRODUCT[r.execution.product] ?? r.execution.product}` : 'PAPER'}</span>{' '}
              <span className="muted">{r.timeframe} · line used for {usesOf(r, drawing.id).join(', ')}</span>{' '}
              <span>{r.name}</span>
            </div>
            <small className="muted">entry: {describeCondition(r.condition, drawings)} (checked on each {r.timeframe} close)</small>
            <div><small><span className="muted">Stop-loss:</span> {w.plan ? <>{w.plan.stop}{w.plan.stop_if_now !== null ? ` (≈ ${fmtPrice(w.plan.stop_if_now)} if it fired now)` : ''}</> : 'yes'}</small></div>
            <div><small><span className="muted">Trailing:</span> {w.plan?.trail ?? (r.trail ? 'yes' : <span className="down">none</span>)}</small></div>
            {(r.exit_condition || r.exit_condition_2 || w.plan?.target) && (
              <div><small className="muted">
                {r.exit_condition && <>exit 1: {describeExit(r.exit_condition, r.exit_timeframe, drawings)} · </>}
                {r.exit_condition_2 && <>exit 2: {describeExit(r.exit_condition_2, r.exit_timeframe_2, drawings)} · </>}
                {w.plan?.target && <>target {w.plan.target}</>}
              </small></div>
            )}
            <div><small>{state(w)}</small></div>
          </div>
        )
      })}
    </div>
  )
}
