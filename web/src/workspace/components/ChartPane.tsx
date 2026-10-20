import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartView } from '../chart/ChartView'
import { peOutput, resultMarkers } from '../chart/fundamentals'
import { legendAt } from '../chart/legend'
import { backtestMarkers, backtestSegments, exitMarkers, indicatorOutputs, positionLines, signalMarkers } from '../chart/overlays'
import { BacktestBanner } from './BacktestBanner'
import { ChartLegend } from './ChartLegend'
import { useApp, useSel } from './context'

/** Hosts the lightweight-charts instance and keeps it in step with the store. */
export function ChartPane() {
  const { ctl } = useApp()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<ChartView | null>(null)
  const [hover, setHover] = useState<number | null>(null)

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
    })
    view.current = chart
    return () => { chart.destroy(); view.current = null }
  }, [ctl])

  useEffect(() => { view.current?.setCandles(symbol, timeframe, candles) }, [symbol, timeframe, candles])
  useEffect(() => { view.current?.setTheme() }, [theme])

  const pe = useMemo(() => (showPe && financials?.symbol === symbol ? peOutput(candles, financials.eps_ttm) : null), [showPe, financials, symbol, candles])
  const outputs = useMemo(() => [...indicatorOutputs(indicators, candles), ...(pe ? [pe] : [])], [indicators, candles, pe, theme]) // theme: supertrend takes the up/down colours
  const configKey = indicators.map((i) => i.id).join('|')
  useEffect(() => { view.current?.setIndicators(outputs, configKey) }, [outputs, configKey])
  const legend = useMemo(() => legendAt(candles, outputs, hover), [candles, outputs, hover])

  useEffect(() => { view.current?.setDrawings(drawings, selected) }, [drawings, selected])
  useEffect(() => { view.current?.setTool(tool) }, [tool])
  useEffect(() => { view.current?.setPriceLines(positionLines(positions, symbol, quote)) }, [positions, symbol, quote])
  useEffect(() => { view.current?.setSegments(bt ? backtestSegments(bt.trades, candles, symbol, timeframe) : []) }, [bt, candles, symbol, timeframe])
  useEffect(() => { if (bt?.focus != null) view.current?.focus(bt.focus) }, [bt?.focus, candles])
  useEffect(() => {
    const results = showResults && financials?.symbol === symbol ? resultMarkers(financials.events, candles, timeframe) : []
    view.current?.setMarkers([...signalMarkers(signals, candles, symbol), ...exitMarkers(closed, candles, symbol, timeframe), ...(bt ? backtestMarkers(bt.trades, bt.open, candles, symbol, timeframe) : []), ...results].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)))
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
    <div className="chart-wrap">
      <div ref={host} className="chart-host" data-testid="chart-host" />
      <BacktestBanner />
      <ChartLegend symbol={symbol} timeframe={timeframe} legend={legend} />
      {loading && candles.length === 0 && <div className="chart-note">Loading candles…</div>}
      {!loading && candles.length === 0 && <div className="chart-note">No candles for {symbol} yet.</div>}
    </div>
  )
}
