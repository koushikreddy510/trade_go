// The imperative wrapper around lightweight-charts. React hands it data; it owns the
// chart instance, the series, the price lines, the markers and the mouse interactions
// for drawing, selecting and dragging lines.
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, TickMarkType, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type Logical, type MouseEventParams, type Time, type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle, Drawing, DrawingKind, DrawingPoint, Timeframe } from '../api/types'
import { anchorIndex, indexToTime } from '../lib/lines'
import { formatIst, formatIstDate, isIntraday, tfSeconds } from '../lib/timeframes'
import type { Tool } from '../store/state'
import { DrawingsPrimitive } from './DrawingsPrimitive'
import { COLORS, THEME, indicatorSignature, type IndicatorOutput, type MarkerSpec, type PriceLineSpec, type SegmentSpec } from './overlays'

export type ChartCallbacks = {
  onDrawingComplete(kind: DrawingKind, points: DrawingPoint[]): void
  onSelect(id: string | null): void
  onMove(id: string, points: DrawingPoint[]): void
  /** The candle under the crosshair (its open time), or null when the pointer leaves the candles. */
  onHover?(time: number | null): void
  /** A result marker (E icon) was clicked. date = 'YYYY-MM-DD', x/y = pixel offset from chart host top-left. */
  onResultMarkerClick?(date: string, x: number, y: number): void
}

const t = (n: number) => n as UTCTimestamp

export class ChartView {
  private chart: IChartApi
  private candles: ISeriesApi<'Candlestick'>
  private volume: ISeriesApi<'Histogram'>
  private markers: ISeriesMarkersPluginApi<Time>
  private volumeMarkers: ISeriesMarkersPluginApi<Time>
  private resultTimes: Map<number, string> = new Map() // candle time → 'YYYY-MM-DD'
  private primitive = new DrawingsPrimitive()
  private priceLines = new Map<string, IPriceLine>()
  private overlaySeries: ISeriesApi<'Line' | 'Histogram'>[] = []
  private segments: ISeriesApi<'Line'>[] = []
  private indicatorKey = ''

  private data: Candle[] = []
  private times: number[] = []
  private symbol = ''
  private tf: Timeframe = '1H'
  private tool: Tool = 'cursor'
  private drawings: Drawing[] = []
  private selectedId: string | null = null
  private pending: DrawingPoint[] = []
  private drag: { id: string; handle: number | null; start: { index: number; price: number }; original: DrawingPoint[]; current: DrawingPoint[]; kind: DrawingKind } | null = null
  private cleanup: (() => void)[] = []

  constructor(private host: HTMLElement, private cb: ChartCallbacks) {
    this.chart = createChart(host, {
      autoSize: true,
      // logo off; the library's attribution is kept as a text link in the top bar instead (TopBar.tsx)
      layout: { attributionLogo: false, background: { type: ColorType.Solid, color: THEME.bg }, textColor: THEME.text, panes: { separatorColor: THEME.border } },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: THEME.border },
      timeScale: {
        borderColor: THEME.border, timeVisible: true, secondsVisible: false, rightOffset: 8,
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const ts = Number(time)
          if (type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds) return formatIst(ts, false)
          if (type === TickMarkType.Year) return String(new Date((ts + 19800) * 1000).getUTCFullYear())
          return formatIstDate(ts)
        },
      },
      localization: { timeFormatter: (time: Time) => formatIst(Number(time), true) + ' IST' },
    })
    this.candles = this.chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down, borderVisible: false, wickUpColor: COLORS.up, wickDownColor: COLORS.down,
    })
    this.volume = this.chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false })
    this.volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    this.markers = createSeriesMarkers(this.candles, [])
    this.volumeMarkers = createSeriesMarkers(this.volume, [])
    this.candles.attachPrimitive(this.primitive)
    this.bindMouse()
  }

  // ------------------------------------------------------------------- data
  setCandles(symbol: string, tf: Timeframe, candles: Candle[]): void {
    const contextChanged = symbol !== this.symbol || tf !== this.tf
    const prev = this.data
    this.symbol = symbol
    this.tf = tf
    this.data = candles
    this.times = candles.map((c) => c.time)
    const tail = !contextChanged && prev.length > 0 && candles.length >= prev.length && candles.length - prev.length <= 1 && candles[0]?.time === prev[0].time
    if (tail) {
      const last = candles[candles.length - 1]
      this.candles.update({ time: t(last.time), open: last.open, high: last.high, low: last.low, close: last.close })
      this.volume.update({ time: t(last.time), value: last.volume, color: last.close >= last.open ? THEME.volumeUp : THEME.volumeDown })
    } else {
      this.candles.setData(candles.map((c) => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close })))
      this.volume.setData(candles.map((c) => ({ time: t(c.time), value: c.volume, color: c.close >= c.open ? THEME.volumeUp : THEME.volumeDown })))
      if (contextChanged || prev.length === 0) this.chart.timeScale().fitContent()
    }
    this.chart.applyOptions({ timeScale: { timeVisible: isIntraday(tf) } })
    this.primitive.set({ times: this.times, tf })
  }

  /** Re-colour the chart after applyTheme(). */
  setTheme(): void {
    this.chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: THEME.bg }, textColor: THEME.text, panes: { separatorColor: THEME.border } },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      rightPriceScale: { borderColor: THEME.border }, timeScale: { borderColor: THEME.border },
    })
    this.candles.applyOptions({ upColor: COLORS.up, downColor: COLORS.down, wickUpColor: COLORS.up, wickDownColor: COLORS.down })
    this.volume.setData(this.data.map((c) => ({ time: t(c.time), value: c.volume, color: c.close >= c.open ? THEME.volumeUp : THEME.volumeDown })))
    this.indicatorKey = '' // series colours were baked in when they were made
  }

  setIndicators(outputs: IndicatorOutput[], configKey: string): void {
    const signature = indicatorSignature(outputs, configKey)
    if (signature !== this.indicatorKey) this.rebuildIndicatorSeries(outputs, signature)
    let k = 0
    for (const out of outputs) for (const line of out.lines) {
      this.overlaySeries[k++].setData(line.points.map((p) => ({ time: t(p.time), value: p.value, ...(p.color ? { color: p.color } : {}) })))
    }
  }

  private rebuildIndicatorSeries(outputs: IndicatorOutput[], configKey: string): void {
    this.indicatorKey = configKey
    for (const s of this.overlaySeries) {
      try { this.chart.removeSeries(s) } catch { /* its pane may already be gone */ }
    }
    this.overlaySeries = []
    for (let i = this.chart.panes().length - 1; i >= 1; i--) this.chart.removePane(i)
    let pane = 0
    for (const out of outputs) {
      const paneIndex = out.pane === 'price' ? 0 : ++pane
      out.lines.forEach((line, i) => {
        const s = line.kind === 'histogram'
          ? this.chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIndex)
          : this.chart.addSeries(LineSeries, {
              color: line.color, lineWidth: line.width as 1 | 2, lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
              priceLineVisible: false, lastValueVisible: out.pane === 'separate' && i === 0, crosshairMarkerVisible: false,
              ...(line.dots ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 } : {}),
              title: i === 0 ? out.label : '',
            }, paneIndex)
        if (out.levels && i === 0) for (const level of out.levels) s.createPriceLine({ price: level, color: THEME.level, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
        this.overlaySeries.push(s as ISeriesApi<'Line' | 'Histogram'>)
      })
    }
    const panes = this.chart.panes()
    panes[0]?.setStretchFactor(3)
    panes.slice(1).forEach((p) => p.setStretchFactor(1))
  }

  setPriceLines(specs: PriceLineSpec[]): void {
    const keep = new Set(specs.map((s) => s.id))
    for (const [id, line] of this.priceLines) {
      if (!keep.has(id)) { this.candles.removePriceLine(line); this.priceLines.delete(id) }
    }
    for (const s of specs) {
      const options = { price: s.price, color: s.color, title: s.title, lineWidth: 1 as const, lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true }
      const existing = this.priceLines.get(s.id)
      if (existing) existing.applyOptions(options)
      else this.priceLines.set(s.id, this.candles.createPriceLine(options))
    }
  }

  setMarkers(specs: MarkerSpec[]): void {
    this.markers.setMarkers(specs.map((m) => ({ time: t(m.time), position: m.position, shape: m.shape, color: m.color, text: m.text, size: 1 })))
  }

  /** Place E-circle markers on the volume series so they appear in the volume-bar strip at the bottom. */
  setResultMarkers(specs: MarkerSpec[]): void {
    this.resultTimes.clear()
    for (const m of specs) {
      const date = m.id.startsWith('result:') ? m.id.slice(7) : null
      if (date) this.resultTimes.set(m.time, date)
    }
    this.volumeMarkers.setMarkers(
      specs.map((m) => ({ time: t(m.time), position: 'belowBar' as const, shape: 'circle' as const, color: m.color, text: 'E', size: 1 })),
    )
  }

  /** Dashed entry -> exit lines of a backtest. */
  setSegments(specs: SegmentSpec[]): void {
    for (const s of this.segments) this.chart.removeSeries(s)
    this.segments = specs.map((spec) => {
      const s = this.chart.addSeries(LineSeries, { color: spec.color, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
      s.setData([{ time: t(spec.from.time), value: spec.from.price }, { time: t(spec.to.time), value: spec.to.price }])
      return s
    })
  }

  /** Scroll so the candle at `time` sits in the middle of about `bars` candles. */
  focus(time: number, bars = 80): void {
    const i = this.times.findIndex((x, n) => x <= time && (this.times[n + 1] ?? Infinity) > time)
    if (i >= 0) this.chart.timeScale().setVisibleLogicalRange({ from: i - bars / 2, to: i + bars / 2 })
  }

  setDrawings(drawings: Drawing[], selectedId: string | null): void {
    this.drawings = drawings
    this.selectedId = selectedId
    this.primitive.set({ drawings, selectedId })
  }

  setTool(tool: Tool): void {
    this.tool = tool
    this.pending = []
    this.primitive.set({ preview: null })
    this.host.style.cursor = tool === 'cursor' ? '' : 'crosshair'
  }

  // ------------------------------------------------------------ interaction
  private get step(): number { return tfSeconds(this.tf) }

  /** Snap an x position to a bar (also to the empty space to the right of the last bar). */
  private pointAt(x: number, y: number): DrawingPoint | null {
    const logical = this.chart.timeScale().coordinateToLogical(x)
    const price = this.candles.coordinateToPrice(y)
    if (logical === null || price === null || this.times.length === 0) return null
    return { time: Math.round(indexToTime(this.times, Math.round(logical), this.step)), price }
  }

  private bindMouse(): void {
    const onClick = (p: MouseEventParams<Time>) => {
      if (this.drag || !p.point) return
      if (this.tool === 'cursor') {
        // Check if a result marker (E icon) was clicked first
        if (p.time !== undefined) {
          const date = this.resultTimes.get(Number(p.time))
          if (date) {
            this.cb.onResultMarkerClick?.(date, p.point.x, p.point.y)
            return
          }
        }
        const hit = this.primitive.pick(p.point.x, p.point.y)
        this.cb.onSelect(hit ? hit.id : null)
        return
      }
      const point = this.pointAt(p.point.x, p.point.y)
      if (!point) return
      if (this.tool === 'horizontal_line' || this.tool === 'text') {
        this.cb.onDrawingComplete(this.tool, [point])
        return
      }
      this.pending.push(point)
      if (this.pending.length === 2) {
        const pts = this.pending
        this.pending = []
        this.primitive.set({ preview: null })
        if (pts[0].time === pts[1].time) return // two clicks on the same bar do not make a line
        this.cb.onDrawingComplete(this.tool as DrawingKind, pts)
      }
    }
    this.chart.subscribeClick(onClick)
    this.cleanup.push(() => this.chart.unsubscribeClick(onClick))

    const onMove = (p: MouseEventParams<Time>) => {
      this.cb.onHover?.(p.time === undefined ? null : Number(p.time))
      if (this.pending.length === 1 && p.point && (this.tool === 'trend_line' || this.tool === 'ray' || this.tool === 'rectangle')) {
        const point = this.pointAt(p.point.x, p.point.y)
        if (point && point.time !== this.pending[0].time) this.primitive.set({ preview: { kind: this.tool, points: [this.pending[0], point] } })
      }
    }
    this.chart.subscribeCrosshairMove(onMove)
    this.cleanup.push(() => this.chart.unsubscribeCrosshairMove(onMove))

    // Dragging a selected line (or one of its handles). Runs in the capture phase so the
    // chart does not pan while a line is being moved.
    const rect = () => this.host.getBoundingClientRect()
    const onDown = (e: MouseEvent) => {
      if (this.tool !== 'cursor' || e.button !== 0) return
      const r = rect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      const hit = this.primitive.pick(x, y)
      if (!hit || hit.id !== this.selectedId) return // the first click selects a line; pressing on it again drags it
      const drawing = this.drawings.find((d) => d.id === hit.id)
      if (!drawing) return
      const logical = this.chart.timeScale().coordinateToLogical(x)
      const price = this.candles.coordinateToPrice(y)
      if (logical === null || price === null) return
      e.stopPropagation()
      e.preventDefault()
      this.chart.applyOptions({ handleScroll: false, handleScale: false })
      this.drag = { id: drawing.id, handle: hit.handle, start: { index: logical, price }, original: drawing.points, current: drawing.points, kind: drawing.kind }
    }
    const onDragMove = (e: MouseEvent) => {
      if (!this.drag) return
      const r = rect()
      const logical = this.chart.timeScale().coordinateToLogical(e.clientX - r.left)
      const price = this.candles.coordinateToPrice(e.clientY - r.top)
      if (logical === null || price === null) return
      const { original, handle, start, kind } = this.drag
      const idx = (p: DrawingPoint) => anchorIndex(this.times, p.time, this.step)
      let next: DrawingPoint[]
      if (handle !== null) {
        const moved = { time: Math.round(indexToTime(this.times, Math.round(logical), this.step)), price }
        next = original.map((p, i) => (i === handle ? moved : p))
      } else {
        const dIdx = Math.round(logical - start.index)
        const dPrice = price - start.price
        next = original.map((p, i) => ({ time: Math.round(indexToTime(this.times, idx(original[i]) + dIdx, this.step)), price: p.price + dPrice }))
        if (kind === 'horizontal_line') next = [{ time: original[0].time, price: original[0].price + dPrice }] // a horizontal line only moves vertically
      }
      this.drag.current = next
      this.primitive.set({ override: { id: this.drag.id, points: next } })
    }
    const onUp = () => {
      if (!this.drag) return
      const { id, original, current } = this.drag
      this.drag = null
      this.chart.applyOptions({ handleScroll: true, handleScale: true })
      this.primitive.set({ override: null })
      if (JSON.stringify(original) !== JSON.stringify(current)) this.cb.onMove(id, current)
    }
    this.host.addEventListener('mousedown', onDown, true)
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', onUp)
    this.cleanup.push(() => {
      this.host.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mousemove', onDragMove)
      window.removeEventListener('mouseup', onUp)
    })
  }

  /** Test/debug hook: pixel position of a bar index and price. */
  coordinates(index: number, price: number): { x: number; y: number } | null {
    const x = this.chart.timeScale().logicalToCoordinate(index as Logical)
    const y = this.candles.priceToCoordinate(price)
    return x === null || y === null ? null : { x, y }
  }

  destroy(): void {
    this.cleanup.forEach((fn) => fn())
    this.chart.remove()
  }
}
