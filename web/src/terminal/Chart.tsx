import { useEffect, useRef } from 'react'
import { CandlestickSeries, ColorType, createChart, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type MouseEventParams, type UTCTimestamp } from 'lightweight-charts'
import type { Candle, Drawing, Point } from './types'

type Props = { candles: Candle[]; drawings: Drawing[]; tool: 'cursor' | 'trend_line' | 'horizontal_line'; onComplete: (drawing: Pick<Drawing, 'kind' | 'points'>) => void }
const timestamp = (value: string) => Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp

export function Chart({ candles, drawings, tool, onComplete }: Props) {
	const host = useRef<HTMLDivElement>(null); const chart = useRef<IChartApi | null>(null); const candlesSeries = useRef<ISeriesApi<'Candlestick'> | null>(null); const pending = useRef<Point[]>([]); const drawSeries = useRef<ISeriesApi<'Line'>[]>([]); const toolRef = useRef(tool); const completeRef = useRef(onComplete)
	useEffect(() => { toolRef.current = tool; completeRef.current = onComplete }, [tool, onComplete])
  useEffect(() => {
    if (!host.current) return
    const instance = createChart(host.current, { autoSize: true, height: 610, layout: { background: { type: ColorType.Solid, color: '#111827' }, textColor: '#b8c5d9' }, grid: { vertLines: { color: '#1d2b40' }, horzLines: { color: '#1d2b40' } }, rightPriceScale: { borderColor: '#293a53' }, timeScale: { borderColor: '#293a53', timeVisible: true } })
	const series = instance.addSeries(CandlestickSeries, { upColor: '#32c48d', downColor: '#f06c76', borderVisible: false, wickUpColor: '#32c48d', wickDownColor: '#f06c76' })
	chart.current = instance; candlesSeries.current = series
    const click = (event: MouseEventParams) => {
	if (toolRef.current === 'cursor' || !event.time || !event.point) return
      const price = series.coordinateToPrice(event.point.y); if (price === null) return
      const point = { time: Number(event.time), price }
	if (toolRef.current === 'horizontal_line') { completeRef.current({ kind: 'horizontal_line', points: [point] }); return }
      pending.current = [...pending.current, point]
	if (pending.current.length === 2) { completeRef.current({ kind: 'trend_line', points: pending.current }); pending.current = [] }
    }
    instance.subscribeClick(click)
    return () => { instance.remove() }
  }, []) // the chart is intentionally created once
	useEffect(() => { const target = chart.current; const series = candlesSeries.current; if (!target || !series) return; series.setData(candles.map((candle) => ({ time: timestamp(candle.Time), open: candle.Open, high: candle.High, low: candle.Low, close: candle.Close }))); target.timeScale().fitContent() }, [candles])
  useEffect(() => {
    const target = chart.current; if (!target) return
    drawSeries.current.forEach((series) => target.removeSeries(series)); drawSeries.current = []
    drawings.forEach((drawing) => {
		const line = target.addSeries(LineSeries, { color: drawing.color ?? '#f7b955', lineWidth: 2, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false })
      const points = drawing.kind === 'horizontal_line' ? [{ time: drawing.points[0].time as UTCTimestamp, value: drawing.points[0].price }, { time: (drawing.points[0].time + 60 * 60 * 24 * 60) as UTCTimestamp, value: drawing.points[0].price }] : drawing.points.map((point) => ({ time: point.time as UTCTimestamp, value: point.price }))
      line.setData(points); drawSeries.current.push(line)
    })
  }, [drawings])
  return <div className="chart" ref={host} />
}
