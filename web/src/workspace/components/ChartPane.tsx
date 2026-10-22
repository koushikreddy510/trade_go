import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartView } from '../chart/ChartView'
import { peOutput, resultMarkers } from '../chart/fundamentals'
import { legendAt } from '../chart/legend'
import { backtestMarkers, backtestSegments, exitMarkers, indicatorOutputs, positionLines, signalMarkers, tradeLineSpecs } from '../chart/overlays'
import type { TradeLine } from '../api/types'
import type { FinancialEvent, FinancialRow } from '../api/types'
import { fmtCrore, fmtPct, fmtPrice, sign } from '../lib/format'
import { BacktestBanner } from './BacktestBanner'
import { ChartLegend } from './ChartLegend'
import { useApp, useSel } from './context'

type ResultPopupState = { date: string; x: number; y: number; event: FinancialEvent; row: FinancialRow | null }

function ResultPopup({ popup, onClose }: { popup: ResultPopupState; onClose: () => void }) {
  const { event: e, row: r } = popup
  // Keep popup within viewport — clamp if near right/bottom edge
  const left = Math.min(popup.x + 12, window.innerWidth - 260)
  const top  = Math.min(popup.y - 16, window.innerHeight - 220)
  const gr = (v: number | null) => v === null ? '' : v >= 0 ? 'up' : 'down'
  return (
    <div className="result-popup" style={{ left, top }} onClick={(ev) => ev.stopPropagation()}>
      <div className="rp-head">
        <span>{e.quarter}</span>
        <button className="rp-close" onClick={onClose}>×</button>
      </div>
      <table className="rp-table">
        <tbody>
          {r?.revenue != null && (
            <tr><td>Sales</td><td>{fmtCrore(r.revenue)}</td>
              <td className={gr(r.revenue_growth_pct)}>{r.revenue_growth_pct != null ? fmtPct(r.revenue_growth_pct, 1) : ''}</td>
            </tr>
          )}
          {r?.operating_profit != null && (
            <tr><td>Op. Profit</td><td>{fmtCrore(r.operating_profit)}{r.opm_pct != null ? ` (${r.opm_pct.toFixed(1)}%)` : ''}</td>
              <td></td>
            </tr>
          )}
          {e.net_profit != null && (
            <tr><td>Net Profit</td><td>{fmtCrore(e.net_profit)}</td>
              <td className={gr(e.profit_growth_pct)}>{e.profit_growth_pct != null ? fmtPct(e.profit_growth_pct, 1) : ''}</td>
            </tr>
          )}
          {e.eps != null && (
            <tr><td>EPS</td><td>{fmtPrice(e.eps)}</td><td></td></tr>
          )}
          {e.reaction_pct != null && (
            <tr><td>Next day</td><td className={gr(e.reaction_pct)}>{fmtPct(e.reaction_pct, 2)}</td><td></td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/** Hosts the lightweight-charts instance and keeps it in step with the store. */
export function ChartPane() {
  const { ctl, api } = useApp()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<ChartView | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [resultPopup, setResultPopup] = useState<ResultPopupState | null>(null)
  const financialsRef = useRef<typeof financials>(null)

  const symbol = useSel((s) => s.symbol)
  const timeframe = useSel((s) => s.timeframe)
  const candles = useSel((s) => s.candles)
  const loading = useSel((s) => s.candlesLoading)
  const indicators = useSel((s) => s.indicators)
  const drawings = useSel((s) => s.drawings)
  const selected = useSel((s) => s.selectedDrawingId)
  const tool = useSel((s) => s.tool)
  const positions = useSel((s) => s.positions.open)
  const closed = useSel((s) => s.positions.closed)
  const tradeLinesOn = useSel((s) => s.tradeLines)
  const bt = useSel((s) => s.btOverlay)
  const signals = useSel((s) => s.signals)
  const financials = useSel((s) => s.financials)
  const showResults = useSel((s) => s.showResults)
  const showPe = useSel((s) => s.showPe)
  const theme = useSel((s) => s.theme)
  const quote = useSel((s) => s.quotes[s.symbol])

  useEffect(() => {
    if (!host.current) return
    const chart = new ChartView(host.current, {
      onDrawingComplete: (kind, points) => void ctl.addDrawing(kind, points),
      onSelect: (id) => ctl.selectDrawing(id),
      onMove: (id, points) => void ctl.moveDrawing(id, points),
      onHover: setHover,
      onResultMarkerClick: (date, x, y) => {
        const f = financialsRef.current
        if (!f) return
        const event = f.events.find((e) => e.date === date)
        if (!event) return
        setResultPopup((prev) => prev?.date === date ? null : { date, x, y, event, row: f.quarterly.find((r) => r.period_end_date === date) ?? null })
      },
    })
    view.current = chart
    return () => { chart.destroy(); view.current = null }
  }, [ctl])

  // Keep a stable ref to financials so the ChartView callback can read it without going stale
  useEffect(() => { financialsRef.current = financials }, [financials])
  // Close result popup when the symbol changes
  useEffect(() => { setResultPopup(null) }, [symbol])

  useEffect(() => { view.current?.setCandles(symbol, timeframe, candles) }, [symbol, timeframe, candles])
  useEffect(() => { view.current?.setTheme() }, [theme])

  const pe = useMemo(() => (showPe && financials?.symbol === symbol ? peOutput(candles, financials.eps_ttm) : null), [showPe, financials, symbol, candles])
  const outputs = useMemo(() => [...indicatorOutputs(indicators, candles), ...(pe ? [pe] : [])], [indicators, candles, pe, theme]) // theme: supertrend takes the up/down colours
  // all are computed (colours stay put), only the visible ones are drawn; the legend lists every one
  const hiddenIds = useMemo(() => new Set(indicators.filter((i) => i.hidden).map((i) => i.id)), [indicators])
  const visible = useMemo(() => outputs.filter((o) => !hiddenIds.has(o.id)), [outputs, hiddenIds])
  const configKey = indicators.filter((i) => !i.hidden).map((i) => i.id).join('|')
  useEffect(() => { view.current?.setIndicators(visible, configKey) }, [visible, configKey])
  const legend = useMemo(() => legendAt(candles, outputs, hover), [candles, outputs, hover])

  useEffect(() => { view.current?.setDrawings(drawings, selected) }, [drawings, selected])
  useEffect(() => { view.current?.setTool(tool) }, [tool])
  useEffect(() => { view.current?.setPriceLines(positionLines(positions, symbol, quote)) }, [positions, symbol, quote])
  // stop / target / entry lines over each position's life, refetched when positions change (a trail moves the stop)
  const [lines, setLines] = useState<TradeLine[]>([])
  useEffect(() => { setLines([]) }, [symbol])               // never draw the previous symbol's levels on this one
  useEffect(() => {
    let live = true
    api.tradeLines(symbol).then((l) => { if (live) setLines(l) }, () => { if (live) setLines([]) })
    return () => { live = false }
  }, [api, symbol, positions, closed])
  useEffect(() => {
    const now = candles.length ? candles[candles.length - 1].time : Math.floor(Date.now() / 1000)
    view.current?.setTradeLines(tradeLineSpecs(lines, tradeLinesOn, now))
  }, [lines, tradeLinesOn, candles])
  useEffect(() => { view.current?.setSegments(bt ? backtestSegments(bt.trades, candles, symbol, timeframe) : []) }, [bt, candles, symbol, timeframe])
  useEffect(() => { if (bt?.focus != null) view.current?.focus(bt.focus) }, [bt?.focus, candles])
  useEffect(() => {
    const results = showResults && financials?.symbol === symbol ? resultMarkers(financials.events, candles, timeframe) : []
    // Result markers go on the volume series (E icons at bottom); signals/exits stay on candles
    view.current?.setResultMarkers(results)
    view.current?.setMarkers([...signalMarkers(signals, candles, symbol), ...exitMarkers(closed, candles, symbol, timeframe), ...(bt ? backtestMarkers(bt.trades, bt.open, candles, symbol, timeframe) : [])].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)))
  }, [signals, closed, bt, candles, symbol, timeframe, financials, showResults])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (e.key === 'Escape') { ctl.setTool('cursor'); ctl.selectDrawing(null) }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); void ctl.deleteDrawing(selected) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctl, selected])

  return (
    <div className="chart-wrap" onClick={() => setResultPopup(null)}>
      <div ref={host} className="chart-host" data-testid="chart-host" />
      <BacktestBanner />
      <ChartLegend symbol={symbol} timeframe={timeframe} legend={legend} hidden={hiddenIds} />
      {loading && candles.length === 0 && <div className="chart-note">Loading candles…</div>}
      {!loading && candles.length === 0 && <div className="chart-note">No candles for {symbol} yet.</div>}
      {resultPopup && <ResultPopup popup={resultPopup} onClose={() => setResultPopup(null)} />}
    </div>
  )
}
