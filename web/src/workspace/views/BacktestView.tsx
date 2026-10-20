import { useEffect, useState } from 'react'
import type { BacktestFull, BacktestRequest, BacktestRow, Preset, Rule } from '../api/types'
import { describeCondition } from '../lib/rules'
import { fmtPct, fmtPnl, fmtPrice, shortSymbol, sign } from '../lib/format'
import { useApp, useSel } from '../components/context'

export const POLL_MS = 1500
const TRADES_SHOWN = 200
type Universe = 'watchlist' | 'screen' | 'symbols'

const today = () => new Date().toISOString().slice(0, 10)
const stamp = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
const money = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 })

/** Backtests: replay saved rules over history on a set of stocks, with capital and a % per trade. */
export function BacktestView() {
  const { api } = useApp()
  const watchlists = useSel((s) => s.watchlists)
  const activeList = useSel((s) => s.activeWatchlistId)
  const [rules, setRules] = useState<Rule[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [past, setPast] = useState<BacktestRow[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [form, setForm] = useState({ start: '2025-10-01', end: today(), capital: 1000000, allocation: 10, maxPositions: '', cost: 0, rescreen: 7 })
  const [universe, setUniverse] = useState<Universe>('watchlist')
  const [listId, setListId] = useState('')
  const [preset, setPreset] = useState('')
  const [symbols, setSymbols] = useState('')
  const [current, setCurrent] = useState<BacktestFull | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  useEffect(() => {
    let live = true
    Promise.all([api.rules(), api.presets(), api.backtests()]).then(([r, p, b]) => {
      if (!live) return
      setRules(r)
      setPresets(p)
      setPreset((cur) => cur || p[0]?.name || '')
      setPast(b)
    }, (e) => { if (live) fail(e) })
    return () => { live = false }
  }, [api])
  useEffect(() => { setListId((cur) => cur || activeList || watchlists[0]?.id || '') }, [activeList, watchlists])

  // While a run is going, ask for it again until it is done.
  const running = current?.status === 'running' ? current.id : null
  useEffect(() => {
    if (!running) return
    const timer = setTimeout(() => {
      api.backtest(running).then((b) => {
        setCurrent(b)
        if (b.status !== 'running') api.backtests().then(setPast, fail)
      }, fail)
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [api, running, current])

  const hasStocks = universe === 'watchlist' ? !!listId : universe === 'screen' ? !!preset : symbols.trim() !== ''
  const request = (): BacktestRequest => {
    const body: BacktestRequest = {
      start: form.start, end: form.end, capital: form.capital, allocation_pct: form.allocation, rule_ids: picked, cost_pct: form.cost,
      ...(form.maxPositions ? { max_positions: Number(form.maxPositions) } : {}),
    }
    if (universe === 'watchlist') body.watchlist_id = listId
    else if (universe === 'screen') { body.screen = { preset }; body.rescreen_days = form.rescreen }
    else body.symbols = symbols.split(/[\s,]+/).filter(Boolean).map((s) => (s.includes(':') ? s : `NSE:${s}-EQ`).toUpperCase())
    return body
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const id = await api.startBacktest(request())
      setCurrent(await api.backtest(id))
      setPast(await api.backtests())
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const open = (id: string) => api.backtest(id).then(setCurrent, fail)
  const remove = async (id: string) => {
    try {
      await api.deleteBacktest(id)
      setPast((p) => p.filter((x) => x.id !== id))
      setCurrent((c) => (c?.id === id ? null : c))
    } catch (e) { fail(e) }
  }
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <div className="view backtests">
      {error && <p className="error" role="alert">{error}</p>}
      <div className="bt-layout">
        <form className="bt-form" onSubmit={(e) => { e.preventDefault(); void run() }}>
          <h3>New backtest</h3>
          <div className="bt-grid">
            <label>From<input type="date" value={form.start} onChange={(e) => set('start', e.target.value)} /></label>
            <label>To<input type="date" value={form.end} onChange={(e) => set('end', e.target.value)} /></label>
            <label>Capital<input type="number" min={1} value={form.capital} onChange={(e) => set('capital', Number(e.target.value))} /></label>
            <label>Per trade %<input type="number" min={0.1} max={100} step="any" value={form.allocation} onChange={(e) => set('allocation', Number(e.target.value))} /></label>
            <label>Max open<input type="number" min={1} placeholder="no limit" value={form.maxPositions} onChange={(e) => set('maxPositions', e.target.value)} /></label>
            <label>Cost % per side<input type="number" min={0} max={5} step="any" value={form.cost} onChange={(e) => set('cost', Number(e.target.value))} /></label>
          </div>
          <fieldset>
            <legend>Rules <small>(each one is applied to every stock below)</small></legend>
            {rules.length === 0 && <p className="muted">Save a rule from a chart first.</p>}
            {rules.map((r) => (
              <label key={r.id} className="check">
                <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
                {r.name || describeCondition(r.condition)} <small>{r.side} · {r.timeframe} · {shortSymbol(r.symbol)}{/"(kind|type)":"line"/.test(JSON.stringify(r)) ? ` · uses a drawn line, so only ${shortSymbol(r.symbol)}` : ''}</small>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Stocks</legend>
            <div className="presets" role="radiogroup" aria-label="Stocks from">
              {(['watchlist', 'screen', 'symbols'] as const).map((u) => (
                <button type="button" key={u} role="radio" aria-checked={universe === u} className={universe === u ? 'chip active' : 'chip'} onClick={() => setUniverse(u)}>
                  {u === 'watchlist' ? 'Watchlist' : u === 'screen' ? 'Screener' : 'Symbols'}
                </button>
              ))}
            </div>
            {universe === 'watchlist' && (
              <select aria-label="Watchlist" value={listId} onChange={(e) => setListId(e.target.value)}>
                {watchlists.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.symbols.length})</option>)}
              </select>
            )}
            {universe === 'screen' && (
              <>
                <select aria-label="Screen" value={preset} onChange={(e) => setPreset(e.target.value)}>
                  {presets.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
                </select>
                <label>Re-screen every (days)<input type="number" min={1} max={90} value={form.rescreen} onChange={(e) => set('rescreen', Number(e.target.value))} /></label>
                <p className="muted note">The screen is re-run on each date using only data up to the day before, so the list changes over time.</p>
              </>
            )}
            {universe === 'symbols' && <textarea aria-label="Symbols" placeholder="SBIN, TCS, NSE:INFY-EQ" value={symbols} onChange={(e) => setSymbols(e.target.value)} />}
          </fieldset>
          <button type="submit" disabled={busy || picked.length === 0 || !hasStocks || current?.status === 'running'}>Run backtest</button>
        </form>

        <div className="bt-main">
          {current ? <Result run={current} /> : <p className="muted">Pick rules and stocks, then run. Entries, stops, trailing stops and exits use exactly the logic of live trading, on completed candles of each rule’s own timeframe.</p>}
          <h3>Earlier runs</h3>
          {past.length === 0 && <p className="muted">None yet.</p>}
          <ul className="bt-past" aria-label="Earlier runs">
            {past.map((b) => (
              <li key={b.id}>
                <button className="link" onClick={() => void open(b.id)}>{b.params.start} → {b.params.end}</button>
                <span className="muted">{b.status === 'done' && b.summary ? <span className={sign(b.summary.return_pct)}>{fmtPct(b.summary.return_pct)}</span> : b.status}</span>
                <button className="small" aria-label={`Delete run ${b.params.start} to ${b.params.end}`} onClick={() => void remove(b.id)}>×</button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function Result({ run }: { run: BacktestFull }) {
  const { ctl } = useApp()
  if (run.status === 'running') return <p role="status">Running… {run.progress ?? 'starting'}</p>
  if (run.status === 'failed' || !run.result) return <p className="error" role="alert">Backtest failed: {run.error}</p>
  const r = run.result
  const label = `${run.params.start} → ${run.params.end}`
  const chart = (symbol: string, iso: string) => (
    <button className="link" title="Show on chart" onClick={() => void ctl.showBacktest(label, r, symbol, iso)}>{shortSymbol(symbol)}</button>
  )
  const s = r.summary
  const cards: [string, string, string?][] = [
    ['Return', fmtPct(s.return_pct), sign(s.return_pct)],
    ['Final equity', money(s.final_equity)],
    ['Closed trades', String(s.trades)],
    ['Win rate', s.win_rate_pct === null ? '—' : `${s.win_rate_pct}%`],
    ['Profit factor', s.profit_factor === null ? '—' : String(s.profit_factor)],
    ['Max drawdown', `${s.max_drawdown_pct}%`, s.max_drawdown_pct > 0 ? 'down' : ''],
    ['Realised P&L', fmtPnl(s.realized_pnl), sign(s.realized_pnl)],
    ['Open now', `${s.open_positions} · ${fmtPnl(s.unrealized_pnl)}`, sign(s.unrealized_pnl)],
  ]
  const trades = [...r.trades].reverse()
  return (
    <div className="bt-result">
      <div className="bt-cards">{cards.map(([k, v, tone]) => <div key={k} className="bt-card"><span className="muted">{k}</span><b className={tone}>{v}</b></div>)}</div>
      <Equity points={r.equity} start={s.initial_capital} />
      {r.open.length > 0 && (
        <>
          <h4>Still open at the end</h4>
          <table className="grid" aria-label="Open positions">
            <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Stop</th><th>Last</th><th>Unrealised</th></tr></thead>
            <tbody>{r.open.map((o) => (
              <tr key={o.symbol + o.entry_time}><td>{chart(o.symbol, o.entry_time)}</td><td>{o.side}</td><td>{o.quantity}</td><td>{stamp(o.entry_time)} @ {fmtPrice(o.entry_price)}</td><td>{fmtPrice(o.stop)}</td><td>{fmtPrice(o.last_price)}</td><td className={sign(o.unrealized_pnl)}>{fmtPnl(o.unrealized_pnl)}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
      <h4>Trades</h4>
      {trades.length === 0 ? <p className="muted">No trade closed in this period.</p> : (
        <div className="table-wrap">
          <table className="grid" aria-label="Trades">
            <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Why</th><th>P&amp;L</th><th>%</th></tr></thead>
            <tbody>{trades.slice(0, TRADES_SHOWN).map((t, i) => (
              <tr key={i}><td>{chart(t.symbol, t.entry_time)}</td><td>{t.side}</td><td>{t.quantity}</td><td>{stamp(t.entry_time)} @ {fmtPrice(t.entry_price)}</td><td>{stamp(t.exit_time)} @ {fmtPrice(t.exit_price)}</td><td>{t.exit_reason?.replace('_', ' ')}</td><td className={sign(t.pnl)}>{fmtPnl(t.pnl)}</td><td className={sign(t.pnl_pct)}>{fmtPct(t.pnl_pct)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {trades.length > TRADES_SHOWN && <p className="muted note">Showing the latest {TRADES_SHOWN} of {trades.length} trades.</p>}
      {Object.keys(r.rejected).length > 0 && <p className="muted note">Signals skipped: {Object.entries(r.rejected).map(([why, n]) => `${n} × ${why}`).join(', ')}.</p>}
      {r.universe.length > 1 && <p className="muted note">The screened list changed {r.universe.length - 1} time(s); it had {r.universe[0].count} stocks at the start and {r.universe[r.universe.length - 1].count} at the end.</p>}
      {r.notes.map((n) => <p key={n} className="muted note">{n}</p>)}
    </div>
  )
}

/** The equity curve as a small SVG line with the starting capital as a dashed baseline. */
function Equity({ points, start }: { points: { date: string; equity: number }[]; start: number }) {
  if (points.length < 2) return null
  const values = points.map((p) => p.equity)
  const lo = Math.min(start, ...values)
  const hi = Math.max(start, ...values)
  const span = hi - lo || 1
  const y = (v: number) => 4 + (1 - (v - lo) / span) * 112
  const line = points.map((p, i) => `${((i / (points.length - 1)) * 600).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ')
  return (
    <figure className="bt-equity">
      <svg viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="Equity curve">
        <line x1="0" x2="600" y1={y(start)} y2={y(start)} className="base" />
        <polyline points={line} />
      </svg>
      <figcaption className="muted"><span>{points[0].date}</span><span>{money(lo)} – {money(hi)}</span><span>{points[points.length - 1].date}</span></figcaption>
    </figure>
  )
}
