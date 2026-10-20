// Strategy screener -> watchlist. Pick one of the strategies defined in the strategy-screener, say how
// close a stock may be to qualifying, preview who would be on the list, then sync it to a watchlist.
import { useCallback, useEffect, useState } from 'react'
import type { SyncCandidate, SyncFilter, SyncLink, SyncPlan, SyncSettings, SyncStrategy } from '../api/types'
import { fmtPct, fmtPrice, shortSymbol, sign } from '../lib/format'
import { useApp } from '../components/context'

const RATIOS = ['pe_ratio', 'pb_ratio', 'roce_pct', 'roe_pct', 'dividend_yield', 'market_cap_cr']
const RESULT_METRICS = ['revenue', 'net_profit', 'opm_pct', 'npm_pct', 'eps', 'revenue_growth_pct', 'profit_growth_pct']
const METRICS: Record<SyncFilter['source'], string[]> = { ratio: RATIOS, quarter: RESULT_METRICS, year: RESULT_METRICS }
const SOURCE_LABEL: Record<SyncFilter['source'], string> = { ratio: 'Ratio', quarter: 'Latest quarter', year: 'Latest year' }
const OPS: SyncFilter['op'][] = ['>', '>=', '<', '<=']

const blankFilter = (): SyncFilter => ({ source: 'quarter', metric: 'profit_growth_pct', op: '>', value: 0 })

export function describeFilter(f: SyncFilter): string {
  return `${SOURCE_LABEL[f.source].toLowerCase()} ${f.metric.replace(/_/g, ' ')} ${f.op} ${f.value}`
}

export function StrategiesView() {
  const { api, ctl } = useApp()
  const [strategies, setStrategies] = useState<SyncStrategy[]>([])
  const [links, setLinks] = useState<SyncLink[]>([])
  const [strategyId, setStrategyId] = useState<number | null>(null)
  const [tolerance, setTolerance] = useState(3)
  const [maxFailing, setMaxFailing] = useState(1)
  const [maxSymbols, setMaxSymbols] = useState(100)
  const [filters, setFilters] = useState<SyncFilter[]>([])
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))
  const loadLinks = useCallback(async () => setLinks(await api.syncLinks()), [api])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [list, linked] = await Promise.all([api.syncStrategies(), api.syncLinks()])
        if (!live) return
        setStrategies(list)
        setLinks(linked)
        setStrategyId((cur) => cur ?? list.find((s) => s.is_active)?.id ?? list[0]?.id ?? null)
      } catch (e) { if (live) fail(e) }
    })()
    return () => { live = false }
  }, [api])

  const strategy = strategies.find((s) => s.id === strategyId)
  const settings = (): SyncSettings => ({ strategy_id: strategyId as number, tolerance_pct: tolerance, max_failing: maxFailing, max_symbols: maxSymbols, filters })
  // Changing any setting makes the shown preview stale; clearing it avoids syncing something other than what was previewed.
  const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPlan(null) }

  const preview = async () => {
    setBusy('Asking the strategy screener… the first run of a day can take a minute')
    setError(null)
    try { setPlan(await api.syncPreview(settings())) } catch (e) { fail(e) } finally { setBusy(null) }
  }

  const apply = async () => {
    setBusy('Syncing…')
    setError(null)
    try {
      const res = await api.syncApply(settings())
      await ctl.reloadWatchlists(res.watchlist.id)
      await loadLinks()
      const bits = [`${res.added.length} added`, `${res.removed.length} removed`]
      if (res.kept_for_trading.length) bits.push(`${res.kept_for_trading.length} kept because you are trading them`)
      ctl.notify('success', `“${res.watchlist.name}”: ${res.matched} matched, ${res.near} near. ${bits.join(', ')}.`)
      setPlan(res.plan)
    } catch (e) { fail(e) } finally { setBusy(null) }
  }

  const refresh = async () => {
    setBusy('Refreshing synced lists…')
    setError(null)
    try {
      const results = await api.syncRefresh()
      await ctl.reloadWatchlists()
      await loadLinks()
      const bad = results.filter((r) => !r.ok)
      if (bad.length) setError(`Could not refresh strategy ${bad.map((r) => r.strategy_id).join(', ')}: ${bad[0].error}`)
      else ctl.notify('success', `Refreshed ${results.length} synced list${results.length === 1 ? '' : 's'}.`)
    } catch (e) { fail(e) } finally { setBusy(null) }
  }

  const unlink = async (l: SyncLink) => {
    try {
      await api.syncUnlink(l.watchlist_id)
      await loadLinks()
      ctl.notify('info', `“${l.watchlist_name}” is now an ordinary watchlist.`)
    } catch (e) { fail(e) }
  }

  const patchFilter = (i: number, patch: Partial<SyncFilter>) => change(setFilters)(filters.map((f, j) => {
    if (j !== i) return f
    const next = { ...f, ...patch }
    if (patch.source && !METRICS[patch.source].includes(next.metric)) next.metric = METRICS[patch.source][0]   // keep the metric valid for the source
    return next
  }))

  return (
    <div className="view strategies">
      <p className="muted desc">
        Stocks that meet <em>every</em> condition of a strategy screener strategy on the latest daily candle go on a watchlist — and so do near-misses
        that are within your tolerance, so a stock 1% short of qualifying is not lost.
      </p>

      <section aria-label="Sync settings" className="sync-form">
        <label>Strategy
          <select value={strategyId ?? ''} onChange={(e) => change(setStrategyId)(Number(e.target.value))} disabled={strategies.length === 0}>
            {strategies.length === 0 && <option value="">No strategies found</option>}
            {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_active ? '' : ' (inactive)'}</option>)}
          </select>
        </label>
        <label title="A stock misses a condition by this much of the threshold (e.g. RSI 58.8 against 60 is 2%) and is still kept.">Near-miss tolerance %
          <input type="number" min={0} max={50} step="0.5" value={tolerance} onChange={(e) => change(setTolerance)(Number(e.target.value))} />
        </label>
        <label title="How many conditions may be missed at once. 0 = every condition must hold (matches only).">Conditions that may be missed
          <select value={maxFailing} onChange={(e) => change(setMaxFailing)(Number(e.target.value))}>
            <option value={0}>0 (matches only)</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
          </select>
        </label>
        <label>Max symbols
          <input type="number" min={1} max={500} value={maxSymbols} onChange={(e) => change(setMaxSymbols)(Number(e.target.value))} />
        </label>
      </section>

      {strategy && (
        <p className="muted conditions" aria-label="Strategy conditions">
          {strategy.conditions.length ? <>All of: {strategy.conditions.map((c) => <code key={c}>{c}</code>)}</> : 'This strategy has no conditions.'}
          {' '}<span>({strategy.timeframe})</span>
        </p>
      )}

      <section aria-label="Financial filters" className="filters">
        <div className="filter-head"><strong>Financial filters</strong> <span className="muted">(optional, from the latest results on file; a stock with no data is kept)</span></div>
        {filters.map((f, i) => (
          <div className="filter" key={i}>
            <select aria-label={`Financial filter ${i + 1} source`} value={f.source} onChange={(e) => patchFilter(i, { source: e.target.value as SyncFilter['source'] })}>
              {(Object.keys(SOURCE_LABEL) as SyncFilter['source'][]).map((k) => <option key={k} value={k}>{SOURCE_LABEL[k]}</option>)}
            </select>
            <select aria-label={`Financial filter ${i + 1} metric`} value={f.metric} onChange={(e) => patchFilter(i, { metric: e.target.value })}>
              {METRICS[f.source].map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
            <select aria-label={`Financial filter ${i + 1} operator`} value={f.op} onChange={(e) => patchFilter(i, { op: e.target.value as SyncFilter['op'] })}>
              {OPS.map((o) => <option key={o}>{o}</option>)}
            </select>
            <input aria-label={`Financial filter ${i + 1} value`} type="number" step="any" value={f.value} onChange={(e) => patchFilter(i, { value: Number(e.target.value) })} />
            <button className="x" aria-label={`Remove financial filter ${i + 1}`} onClick={() => change(setFilters)(filters.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button className="small" onClick={() => change(setFilters)([...filters, blankFilter()])}>+ financial filter</button>
      </section>

      <div className="sync-actions">
        <button className="small" onClick={() => void preview()} disabled={busy !== null || strategyId === null}>Preview</button>
        <button className="small primary" onClick={() => void apply()} disabled={busy !== null || strategyId === null}
          title="Creates the watchlist “Screen: <strategy>” or updates it. Symbols you added by hand are never removed.">Sync to watchlist</button>
      </div>

      {busy && <p className="muted" role="status">{busy}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {plan && <PlanTable plan={plan} onOpen={(s) => void ctl.selectSymbol(s)} />}

      <section aria-label="Synced watchlists" className="links">
        <div className="filter-head">
          <strong>Synced watchlists</strong>
          {links.length > 0 && <button className="small" onClick={() => void refresh()} disabled={busy !== null} title="Re-run every synced list with its saved settings">Refresh all</button>}
        </div>
        {links.length === 0 && <p className="empty">Nothing is synced yet. Preview a strategy, then press “Sync to watchlist”.</p>}
        {links.map((l) => (
          <div className="link-row" key={l.watchlist_id}>
            <div>
              <button className="link" onClick={() => ctl.openWatchlist(l.watchlist_id)} title="Open this watchlist next to the chart">{l.watchlist_name}</button>
              <span className="muted"> — {l.strategy_name}, ±{l.tolerance_pct}%, up to {l.max_failing} miss{l.max_failing === 1 ? '' : 'es'}</span>
              {l.filters.length > 0 && <span className="muted"> · {l.filters.map(describeFilter).join(', ')}</span>}
              <div className="muted">{l.matched_count} matched · {l.near_count} near · {l.last_asof ? `data of ${l.last_asof}` : 'never run'}</div>
            </div>
            <button className="small" onClick={() => void unlink(l)} title="Keep the list but stop updating it">Unlink</button>
          </div>
        ))}
      </section>
    </div>
  )
}

function PlanTable({ plan, onOpen }: { plan: SyncPlan; onOpen: (symbol: string) => void }) {
  return (
    <div className="table-wrap" aria-label="Preview">
      <p className="muted">
        {plan.matched_total} matched · {plan.near_total} near-miss{plan.near_total === 1 ? '' : 'es'} · {plan.scanned} stocks scanned
        {plan.asof ? ` · data of ${plan.asof}` : ''}
        {plan.rejected_by_financials > 0 ? ` · ${plan.rejected_by_financials} dropped by financial filters` : ''}
        {plan.truncated ? ` · list capped at ${plan.max_symbols}` : ''}
      </p>
      {plan.candidates.length === 0 ? <p className="empty">Nothing qualifies right now. Try a wider tolerance.</p> : (
        <table className="grid">
          <thead><tr><th>Symbol</th><th>Status</th><th>Gap</th><th>Why</th><th>Close</th><th>Chg %</th><th>Company</th></tr></thead>
          <tbody>
            {plan.candidates.map((c: SyncCandidate) => (
              <tr key={c.symbol}>
                <td><button className="link" onClick={() => onOpen(c.symbol)} title="Open chart">{shortSymbol(c.symbol)}</button></td>
                <td><span className={c.status === 'matched' ? 'pill up' : 'pill'}>{c.status === 'matched' ? 'Matched' : 'Near'}</span></td>
                <td>{c.status === 'matched' ? '—' : `${c.gap_pct.toFixed(1)}%`}</td>
                <td className="muted">{[c.reason, ...c.notes].join(' · ')}</td>
                <td>{fmtPrice(c.close)}</td>
                <td className={sign(c.change_pct ?? 0)}>{fmtPct(c.change_pct)}</td>
                <td className="muted">{c.company}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
