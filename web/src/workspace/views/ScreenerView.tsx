import { useEffect, useMemo, useState } from 'react'
import type { IndicatorName, Preset, QuickCondition, SavedScreen, ScreenColumn, ScreenFilter, ScreenResult, ScreenRow } from '../api/types'
import { fmtCrore, fmtPct, fmtPrice, shortSymbol, sign } from '../lib/format'
import { useApp, useSel } from '../components/context'

type Sort = { field: string; descending: boolean }

// How each unit is written. The server says which unit a column has; the fallback covers the price columns if it does not.
const FORMAT: Record<string, (v: number) => string> = {
  price: (v) => fmtPrice(v), pct: (v) => fmtPct(v, 1), pct2: (v) => fmtPct(v), mult: (v) => `${v.toFixed(1)}×`, x: (v) => v.toFixed(1), int: (v) => v.toFixed(0), cr: (v) => fmtCrore(v), num: (v) => v.toFixed(2),
}
const FALLBACK: Record<string, { unit: string; short: string }> = {
  close: { unit: 'price', short: 'Close' }, change_pct: { unit: 'pct2', short: 'Chg %' }, volume_ratio: { unit: 'mult', short: 'Vol ×avg' }, rsi_14: { unit: 'int', short: 'RSI' },
  ret_20d: { unit: 'pct', short: '20d %' }, ret_60d: { unit: 'pct', short: '60d %' }, pct_from_52w_high: { unit: 'pct', short: 'vs 52w high' }, market_cap: { unit: 'cr', short: 'Mkt cap (Cr)' },
}
const BASIC_SHOW = ['close', 'change_pct', 'market_cap']
/** What explains each screen on a chart: added to the chart's indicators when its results are opened. */
const PRESET_INDICATORS: Record<string, { name: IndicatorName; params?: Record<string, number> }[]> = {
  golden_cross: [{ name: 'sma', params: { period: 50 } }, { name: 'sma', params: { period: 200 } }],
  death_cross: [{ name: 'sma', params: { period: 50 } }, { name: 'sma', params: { period: 200 } }],
  supertrend_up: [{ name: 'supertrend', params: { period: 10, multiplier: 3 } }, { name: 'supertrend', params: { period: 5, multiplier: 2 } }],
  uptrend: [{ name: 'ema', params: { period: 20 } }, { name: 'sma', params: { period: 50 } }, { name: 'sma', params: { period: 200 } }],
  oversold: [{ name: 'rsi' }],
}
const SCREEN_TIMEFRAME = '1D' as const    // the daily scan reads 1D candles
/** Percentages that are levels (a margin, a return on capital), not changes: no red/green. */
const LEVELS = new Set(['roce_pct', 'roe_pct', 'dividend_yield', 'earnings_yield_pct', 'q_opm_pct', 'q_npm_pct'])
/** Results and valuation columns shown after the technical ones, so a screen can be judged on both at a glance. */
const FINANCIAL_SHOW = ['pe_ratio', 'q_revenue', 'q_net_profit', 'q_revenue_qoq_pct', 'q_revenue_yoy_pct', 'q_profit_qoq_pct', 'q_profit_yoy_pct', 'q_opm_pct', 'q_npm_pct']
const GROUP_ORDER = ['Price and volume', 'Value and quality', 'Quarterly results']

const blankFilter = (): ScreenFilter => ({ field: 'rsi_14', op: '<=', value: 30 })

export function ScreenerView() {
  const { api, ctl } = useApp()
  const lists = useSel((s) => s.watchlists)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [withFinancials, setWithFinancials] = useState(true)
  const [presets, setPresets] = useState<Preset[]>([])
  const [columns, setColumns] = useState<ScreenColumn[]>([])
  const [operators, setOperators] = useState<string[]>(['>', '>=', '<', '<=', '=', '!='])
  const [groupsOrder, setGroupsOrder] = useState<string[]>([])
  const [quick, setQuick] = useState<QuickCondition[]>([])
  const [saved, setSaved] = useState<SavedScreen[]>([])
  const [active, setActive] = useState<string | 'custom'>('uptrend')
  const [filters, setFilters] = useState<ScreenFilter[]>([blankFilter()])
  const [sort, setSort] = useState<Sort>({ field: 'ret_60d', descending: true })
  const [result, setResult] = useState<ScreenResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (work: () => Promise<ScreenResult>) => {
    setBusy('Running…')
    setError(null)
    try { setResult(await work()) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  const runPreset = (name: string) => { setActive(name); setSort({ field: presets.find((p) => p.name === name)?.sort ?? 'symbol', descending: presets.find((p) => p.name === name)?.descending ?? false }); return run(() => api.runPreset(name)) }
  const runCustom = () => { setActive('custom'); return run(() => api.runScreen(filters, sort.field, sort.descending)) }

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [p, c, sv] = await Promise.all([api.presets(), api.columns(), api.savedScreens().catch(() => [] as SavedScreen[])])
        if (!live) return
        setPresets(p)
        setColumns(c.columns)
        setOperators(c.operators)
        setGroupsOrder(c.groups ?? [])
        setQuick(c.quick ?? [])
        setSaved(sv)
        const first = p.find((x) => x.name === 'uptrend') ?? p[0]
        if (first) { setActive(first.name); setSort({ field: first.sort, descending: first.descending }); setResult(await api.runPreset(first.name)) }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : String(e)) }
    })()
    return () => { live = false }
  }, [api])

  const scan = async () => {
    setBusy("Scanning every symbol's daily candles… this can take a minute")
    setError(null)
    try {
      const out = await api.runScan()
      ctl.notify('success', `Scan done: ${out.stored} symbols analysed${out.skipped ? `, ${out.skipped} skipped (too little history)` : ''}.`)
      setResult(active === 'custom' ? await api.runScreen(filters, sort.field, sort.descending) : await api.runPreset(active))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  // Sorting a table never re-queries; the server already returned up to 200 rows.
  const rows = useMemo(() => {
    const list = [...(result?.rows ?? [])]
    const key = sort.field
    list.sort((a, b) => {
      const x = a[key] as number | string | null | undefined
      const y = b[key] as number | string | null | undefined
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return sort.descending ? -c : c
    })
    return list
  }, [result, sort])

  const editPreset = (p: Preset) => { setFilters(p.filters.map((f) => ({ ...f }))); setSort({ field: p.sort, descending: p.descending }); setActive('custom') }
  const loadSaved = (sc: SavedScreen) => {
    setFilters(sc.filters.map((f) => ({ ...f }))); setSort({ field: sc.sort, descending: sc.descending }); setActive('custom')
    return run(() => api.runScreen(sc.filters, sc.sort, sc.descending))
  }
  const saveCurrent = async () => {
    const name = window.prompt('Name for this screen', '')
    if (!name) return
    try {
      const sc = await api.saveScreen(name, filters, sort.field, sort.descending)
      setSaved((all) => [...all.filter((x) => x.id !== sc.id), sc].sort((a, b) => a.name.localeCompare(b.name)))
      ctl.notify('success', `Saved the screen “${sc.name}”.`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const removeSaved = async (sc: SavedScreen) => {
    if (!window.confirm(`Delete the saved screen “${sc.name}”?`)) return
    try { await api.deleteScreen(sc.id); setSaved((all) => all.filter((x) => x.id !== sc.id)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const labelOf = (key: string) => columns.find((c) => c.name === key)?.label ?? key
  const describe = (f: ScreenFilter) => `${labelOf(f.field)} ${f.op} ${typeof f.value === 'number' ? f.value : labelOf(f.value.field)}`
  // the field picker, grouped (Price, Trend, Momentum… then Valuation, Profitability…)
  const grouped = (groupsOrder.length ? groupsOrder : [...new Set(columns.map((c) => c.group ?? 'Other'))])
    .map((g) => ({ g, cols: columns.filter((c) => (c.group ?? 'Other') === g) })).filter((x) => x.cols.length)
  const fieldOptions = grouped.map(({ g, cols }) => (
    <optgroup key={g} label={`${cols[0]?.technical === false ? 'Fundamental' : 'Technical'} · ${g}`}>{cols.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}</optgroup>
  ))
  const toggleSort = (field: string) => setSort((s) => (s.field === field ? { field, descending: !s.descending } : { field, descending: true }))
  const patchFilter = (i: number, patch: Partial<ScreenFilter>) => setFilters((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const current = presets.find((p) => p.name === active)
  const unitOf = (key: string) => columns.find((c) => c.name === key)?.unit ?? FALLBACK[key]?.unit ?? 'num'
  const shortOf = (key: string) => columns.find((c) => c.name === key)?.short ?? FALLBACK[key]?.short ?? key
  // Technical values (RSI, volume, returns…) are why a stock is listed, so they are not repeated as columns; what is
  // shown is the price, the market cap and the financials to compare the matches by.
  const isFundamental = (k: string) => columns.find((c) => c.name === k)?.technical === false
  const wanted = active === 'custom'
    ? [...filters.map((f) => f.field), ...filters.flatMap((f) => (typeof f.value === 'number' ? [] : [f.value.field]))]
    : current?.show ?? []
  const shown = [...new Set([...BASIC_SHOW, ...wanted.filter(isFundamental), ...(withFinancials ? FINANCIAL_SHOW.filter((k) => columns.some((c) => c.name === k)) : [])])]
  const groups = [...new Set(presets.map((p) => p.group ?? 'Screens'))].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99))
  const openChart = (symbol: string) => {
    const label = active === 'custom' ? 'Custom screen' : current?.label ?? 'Screen'
    return ctl.openResults({ label, symbols: rows.map((r) => r.symbol), timeframe: SCREEN_TIMEFRAME }, symbol, PRESET_INDICATORS[active] ?? [])
  }
  const saveAsList = async () => {
    const name = `${active === 'custom' ? 'Custom screen' : current?.label ?? 'Screen'} · 1D ${result?.run_date ?? ''}`.trim()
    const wl = await ctl.createWatchlist(name, rows.slice(0, 200).map((r) => r.symbol))
    if (wl) ctl.notify('success', `Saved ${wl.symbols.length} stocks as the watchlist “${wl.name}”.`)
  }

  return (
    <div className="view screener">
      <div className="screener-top">
        <div className="presets" role="group" aria-label="Preset screens">
          {groups.map((g) => (
            <div key={g} className="preset-group" role="group" aria-label={g}>
              <span className="muted">{g}</span>
              {presets.filter((p) => (p.group ?? 'Screens') === g).map((p) => <button key={p.name} className={active === p.name ? 'chip active' : 'chip'} title={p.description} onClick={() => void runPreset(p.name)}>{p.label}</button>)}
            </div>
          ))}
          <div className="preset-group"><span className="muted">Your own</span>
            {saved.map((sc) => (
              <span key={sc.id} className="chip tag saved-screen" title={sc.filters.map(describe).join(' AND ')}>
                <button onClick={() => void loadSaved(sc)}>{sc.name}</button>
                <button aria-label={`Delete saved screen ${sc.name}`} onClick={() => void removeSaved(sc)}>×</button>
              </span>
            ))}
            <button className={active === 'custom' ? 'chip active' : 'chip'} onClick={() => setActive('custom')}>Custom…</button>
          </div>
        </div>
        <div className="scan">
          <span className="muted">{result?.run_date ? `Daily scan of ${result.run_date}` : 'No scan has been run yet'}</span>
          <button className="small primary" onClick={() => void scan()} disabled={busy !== null} title="Recomputes every metric from daily candles. Normally runs once a day after market close.">Run daily scan</button>
        </div>
      </div>

      {current && active !== 'custom' && (
        <p className="muted desc">{current.description}{' '}
          <button className="small" title="Load this screen's conditions into the builder, then add or remove technical and fundamental conditions" onClick={() => editPreset(current)}>Edit in builder</button>
        </p>
      )}

      {active === 'custom' && (
        <div className="filters" aria-label="Custom screen">
          {filters.map((f, i) => (
            <div className="filter" key={i}>
              <select aria-label={`Filter ${i + 1} field`} value={f.field} onChange={(e) => patchFilter(i, { field: e.target.value })}>
                {fieldOptions}
              </select>
              <select aria-label={`Filter ${i + 1} operator`} value={f.op} onChange={(e) => patchFilter(i, { op: e.target.value })}>{operators.map((o) => <option key={o}>{o}</option>)}</select>
              <select aria-label={`Filter ${i + 1} compares to`} value={typeof f.value === 'number' ? '#' : f.value.field} onChange={(e) => patchFilter(i, { value: e.target.value === '#' ? 0 : { field: e.target.value } })}>
                <option value="#">a number</option>
                {fieldOptions}
              </select>
              {typeof f.value === 'number' && <input aria-label={`Filter ${i + 1} value`} type="number" step="any" value={f.value} onChange={(e) => patchFilter(i, { value: Number(e.target.value) })} />}
              <button className="x" aria-label={`Remove filter ${i + 1}`} onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          {filters.length > 0 && <p className="muted screen-summary">All of: {filters.map(describe).join(' · AND · ')}</p>}
          {quick.length > 0 && (['technical', 'fundamental'] as const).map((kind) => (
            <div key={kind} className="quick-row" aria-label={`Add a ${kind} condition`}>
              <span className="muted">{kind === 'technical' ? 'Technical' : 'Fundamental'}:</span>
              {quick.filter((q) => q.kind === kind).map((q) => (
                <button key={q.label} className="chip" title={q.filters.map(describe).join(' AND ')} onClick={() => setFilters((fs) => [...fs, ...q.filters.map((x) => ({ ...x }))])}>+ {q.label}</button>
              ))}
            </div>
          ))}
          <div className="filter-actions">
            <button className="small" onClick={() => setFilters((fs) => [...fs, blankFilter()])}>+ filter</button>
            <button className="small" onClick={() => setFilters([])} disabled={filters.length === 0}>Clear</button>
            <button className="small primary" onClick={() => void runCustom()} disabled={busy !== null || filters.length === 0}>Run screen</button>
            <button className="small" onClick={() => void saveCurrent()} disabled={filters.length === 0}>Save screen…</button>
          </div>
        </div>
      )}

      {busy && <p className="muted" role="status">{busy}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {result && result.rows.length === 0 && !busy && !error && (
        <p className="empty">{result.run_date ? 'No symbols match.' : "Run the daily scan to analyse every symbol's 1D candles, then screens are instant."}</p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <p className="muted">{result?.count} match{result?.count === 1 ? '' : 'es'}{result && result.count > rows.length ? `, showing ${rows.length}` : ''} <button className="small" onClick={() => void saveAsList()}>Save as watchlist</button>{' '}
            <label className="muted"><input type="checkbox" checked={withFinancials} onChange={(e) => setWithFinancials(e.target.checked)} /> financial columns</label></p>
          <table className="grid screener-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('symbol')} className="sortable">Symbol{sort.field === 'symbol' ? (sort.descending ? ' ▼' : ' ▲') : ''}</th>
                {shown.map((k) => <th key={k} className="sortable" onClick={() => toggleSort(k)}>{shortOf(k)}{sort.field === k ? (sort.descending ? ' ▼' : ' ▲') : ''}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r: ScreenRow) => (
                <tr key={r.symbol}>
                  <td><button className="link" onClick={() => void openChart(r.symbol)} title="Open the chart; ↑ / ↓ step through these results">{shortSymbol(r.symbol)}</button></td>
                  {shown.map((k) => {
                    const v = r[k] as number | null | undefined
                    const unit = unitOf(k)
                    return <td key={k} className={unit.startsWith('pct') && !LEVELS.has(k) ? sign(v ?? 0) : ''}>{v === null || v === undefined ? '—' : (FORMAT[unit] ?? FORMAT.num)(v)}</td>
                  })}
                  <td className="add-cell">
                    <button className="small" aria-label={`Add ${shortSymbol(r.symbol)} to a watchlist`} aria-expanded={menuFor === r.symbol} onClick={() => setMenuFor(menuFor === r.symbol ? null : r.symbol)}>+</button>
                    {menuFor === r.symbol && (
                      <ul className="add-menu" role="menu" aria-label={`Watchlists for ${shortSymbol(r.symbol)}`}>
                        {lists.map((w) => {
                          const has = w.symbols.includes(r.symbol)
                          return <li key={w.id}><button role="menuitem" disabled={has} onClick={() => { void ctl.addToWatchlist(r.symbol, w.id); setMenuFor(null) }}>{w.name}{has ? ' ✓' : ''}</button></li>
                        })}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
