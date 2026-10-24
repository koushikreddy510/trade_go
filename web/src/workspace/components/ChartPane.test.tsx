// ChartPane is the glue between the app's state and the chart. lightweight-charts needs a real
// canvas, so a recording fake stands in for ChartView: these tests check *what the chart is told*
// (is the stop-loss line there? the entry arrow? the trendline?). ChartView's own drawing maths is
// covered in overlays.test.ts / lines in golden.test.ts, and by the browser check.
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChartCallbacks } from '../chart/ChartView'
import { SBIN, TCS, T0, btReport, financials, line, makeApp, position, quote, renderIn, signal } from './testharness'

const h = vi.hoisted(() => ({ instances: [] as unknown[] }))
type Fake = {
  cb: ChartCallbacks
  setCandles: ReturnType<typeof vi.fn>; setIndicators: ReturnType<typeof vi.fn>; setPriceLines: ReturnType<typeof vi.fn>
  setMarkers: ReturnType<typeof vi.fn>; setSegments: ReturnType<typeof vi.fn>; setTradeLines: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn>; setTheme: ReturnType<typeof vi.fn>; setDrawings: ReturnType<typeof vi.fn>; setTool: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>
}
vi.mock('../chart/ChartView', () => ({
  ChartView: class {
    setCandles = vi.fn(); setIndicators = vi.fn(); setPriceLines = vi.fn(); setMarkers = vi.fn(); setDrawings = vi.fn(); setTool = vi.fn(); setSegments = vi.fn(); setTradeLines = vi.fn(); setResultMarkers = vi.fn(); focus = vi.fn(); setTheme = vi.fn(); destroy = vi.fn()
    constructor(_host: HTMLElement, public cb: ChartCallbacks) { h.instances.push(this) }
  },
}))
import { ChartPane } from './ChartPane'

const chart = () => h.instances[h.instances.length - 1] as Fake
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1]
beforeEach(() => { h.instances.length = 0 })

describe('ChartPane', () => {
  it('creates one chart and destroys it when the screen closes', () => {
    const view = renderIn(<ChartPane />, makeApp())
    expect(h.instances).toHaveLength(1)
    view.unmount()
    expect(chart().destroy).toHaveBeenCalledOnce()
  })

  it('hands the chart its candles for the symbol and timeframe on screen', async () => {
    const app = makeApp()
    renderIn(<ChartPane />, app)
    await act(() => app.ctl.loadChart())
    const [symbol, tf, candles] = last(chart().setCandles)
    expect([symbol, tf, candles.length]).toEqual([SBIN, '1H', 2])
  })

  it('says when there is nothing to show', () => {
    renderIn(<ChartPane />, makeApp())
    expect(screen.getByText(`No candles for ${SBIN} yet.`)).toBeInTheDocument()
  })

  describe('stop-loss, target and entry on the chart', () => {
    it('draws entry, SL and TP lines for an open position on this symbol', () => {
      const app = makeApp({}, { positions: { open: [position()], closed: [] } })
      renderIn(<ChartPane />, app)
      const lines = last(chart().setPriceLines)[0]
      expect(lines.map((l: { title: string; price: number }) => [l.price, l.title.split(' ')[0]])).toEqual([[100, 'BUY'], [95, 'SL'], [110, 'TP']])
    })

    it('does not draw another symbol’s position', () => {
      const app = makeApp({}, { positions: { open: [position({ symbol: TCS })], closed: [] } })
      renderIn(<ChartPane />, app)
      expect(last(chart().setPriceLines)[0]).toEqual([])
    })

    it('moves with the position when it is closed by a stop', async () => {
      const app = makeApp({}, { positions: { open: [position()], closed: [] } })
      renderIn(<ChartPane />, app)
      expect(last(chart().setPriceLines)[0]).toHaveLength(3)
      act(() => app.ctl.onMessage({ type: 'position', position: position({ status: 'closed', exit_reason: 'stop', exit_price: 95, realized_pnl: -50 }) }))
      await waitFor(() => expect(last(chart().setPriceLines)[0]).toEqual([]))
    })

    it('shows live profit in the entry label as ticks arrive', async () => {
      const app = makeApp({}, { positions: { open: [position()], closed: [] } })
      renderIn(<ChartPane />, app)
      act(() => app.ctl.onMessage({ type: 'tick', quote: quote(SBIN, 104) }))
      await waitFor(() => expect(last(chart().setPriceLines)[0][0].title).toContain('+40.00'))
    })

    it('marks the candle where a signal fired', () => {
      const app = makeApp({}, { signals: [signal({ bar_time: T0 - 3600 })], candles: [{ time: T0 - 3600, open: 1, high: 2, low: 1, close: 2, volume: 1 }, { time: T0, open: 2, high: 3, low: 2, close: 3, volume: 1 }] })
      renderIn(<ChartPane />, app)
      const markers = last(chart().setMarkers)[0]
      expect(markers).toHaveLength(1)
      expect(markers[0]).toMatchObject({ shape: 'arrowUp', time: T0 - 3600, text: 'BUY 101.00' })
    })
  })

  describe('fundamentals', () => {
    const day = (d: number) => ({ time: T0 + d * 86400, open: 1, high: 2, low: 1, close: 100, volume: 1 })
    const candles = [day(0), day(1), day(2)]
    const results = (over = {}) => financials({
      events: [{ date: '2026-10-20', quarter: 'Sep 2026', net_profit: 5, eps: 2, revenue_growth_pct: 4, profit_growth_pct: 25, reaction_pct: null }],
      eps_ttm: [{ time: T0 - 86400, value: 10, period: 'Jun 2026', estimated: false }], ...over,
    })

    it('marks the result day on the candles', () => {
      renderIn(<ChartPane />, makeApp({}, { candles, timeframe: '1D', financials: results() }))
      expect(last(chart().setResultMarkers)[0]).toMatchObject([{ id: 'result:2026-10-20', shape: 'circle', text: 'E' }])
    })

    it('puts result markers on the volume pane and signal arrows on the candles', () => {
      const app = makeApp({}, { candles, timeframe: '1D', financials: results(), signals: [signal({ timeframe: '1D', bar_time: T0 })] })
      renderIn(<ChartPane />, app)
      expect(last(chart().setMarkers)[0].map((m: { shape: string }) => m.shape)).toEqual(['arrowUp'])
      expect(last(chart().setResultMarkers)[0].map((m: { shape: string }) => m.shape)).toEqual(['circle'])
    })

    it('hides the markers when switched off', () => {
      renderIn(<ChartPane />, makeApp({}, { candles, timeframe: '1D', financials: results(), showResults: false }))
      expect(last(chart().setResultMarkers)[0]).toEqual([])
    })

    it('never shows another symbol’s results while a new symbol loads', () => {
      renderIn(<ChartPane />, makeApp({}, { candles, timeframe: '1D', financials: results({ symbol: TCS }) }))
      expect(last(chart().setMarkers)[0]).toEqual([])
    })

    it('adds a P/E pane only when switched on', () => {
      const app = makeApp({}, { candles, timeframe: '1D', financials: results(), indicators: [{ id: 'ema-20', name: 'ema', params: { period: 20 } }] })
      renderIn(<ChartPane />, app)
      expect(last(chart().setIndicators)[0].map((o: { id: string }) => o.id)).toEqual(['ema-20'])
      act(() => app.ctl.togglePe())
      const [outputs, key] = last(chart().setIndicators)
      expect(outputs.map((o: { id: string }) => o.id)).toEqual(['ema-20', 'fund:pe'])
      expect(outputs[1].lines[0].points[0].value).toBe(10) // close 100 over TTM EPS 10
      expect(key).toBe('ema-20')
    })
  })

  describe('legend', () => {
    const loaded = () => { const app = makeApp(); app.store.set({ candles: app.candles }); return app }

    it('shows the newest candle’s numbers and the indicator values until the pointer moves', () => {
      renderIn(<ChartPane />, loaded())
      const legend = screen.getByTestId('chart-legend')
      expect(legend).toHaveTextContent('SBIN· 1H')
      expect(legend).toHaveTextContent('O 100.00')
      expect(legend).toHaveTextContent('C 101.00')
      expect(screen.getByTestId('legend-ema-20')).toHaveTextContent('EMA 20')
    })

    it('follows the crosshair from candle to candle and returns to the newest on leaving', () => {
      renderIn(<ChartPane />, loaded())
      act(() => chart().cb.onHover?.(T0 - 3600))
      expect(screen.getByTestId('chart-legend')).toHaveTextContent('O 99.00')
      expect(screen.getByTestId('chart-legend')).toHaveTextContent('C 100.00')
      act(() => chart().cb.onHover?.(null))
      expect(screen.getByTestId('chart-legend')).toHaveTextContent('C 101.00')
    })

    it('is absent while there are no candles', () => {
      renderIn(<ChartPane />, makeApp({}, { candles: [] }))
      expect(screen.queryByTestId('chart-legend')).not.toBeInTheDocument()
    })
  })

  describe('trendlines and tools', () => {
    it('passes drawings and the selection to the chart', () => {
      const app = makeApp({}, { drawings: [line()], selectedDrawingId: 'd1' })
      renderIn(<ChartPane />, app)
      const [drawings, selected] = last(chart().setDrawings)
      expect([drawings.map((d: { id: string }) => d.id), selected]).toEqual([['d1'], 'd1'])
    })

    it('tells the chart which tool is active', () => {
      const app = makeApp()
      renderIn(<ChartPane />, app)
      act(() => app.ctl.setTool('trend_line'))
      expect(last(chart().setTool)[0]).toBe('trend_line')
    })

    it('saves a finished trendline for the symbol on screen', async () => {
      const app = makeApp()
      renderIn(<ChartPane />, app)
      const points = [{ time: T0, price: 100 }, { time: T0 + 7200, price: 105 }]
      await act(async () => chart().cb.onDrawingComplete('trend_line', points))
      await waitFor(() => expect(app.api.createDrawing).toHaveBeenCalledWith(expect.objectContaining({ symbol: SBIN, kind: 'trend_line', points })))
      expect(app.store.get().drawings).toHaveLength(1)
    })

    it('saves a dragged line’s new position', async () => {
      const app = makeApp({}, { drawings: [line()] })
      renderIn(<ChartPane />, app)
      const moved = [{ time: T0, price: 101 }, { time: T0 + 3600, price: 105 }]
      await act(async () => chart().cb.onMove('d1', moved))
      await waitFor(() => expect(app.api.updateDrawing).toHaveBeenCalledWith('d1', expect.objectContaining({ points: moved })))
    })

    it('selecting on the chart selects in the app', () => {
      const app = makeApp({}, { drawings: [line()] })
      renderIn(<ChartPane />, app)
      act(() => chart().cb.onSelect('d1'))
      expect(app.store.get().selectedDrawingId).toBe('d1')
    })
  })

  describe('indicators', () => {
    it('computes indicator lines from the candles and passes them over', () => {
      const candles = Array.from({ length: 30 }, (_, i) => ({ time: T0 + i * 3600, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10 }))
      const app = makeApp({}, { candles, indicators: [{ id: 'ema-20', name: 'ema', params: { period: 20 } }] })
      renderIn(<ChartPane />, app)
      const [outputs, key] = last(chart().setIndicators)
      expect(key).toBe('ema-20')
      expect(outputs).toHaveLength(1)
      expect(outputs[0].lines[0].points).toHaveLength(11) // 30 candles minus the 19 EMA(20) warm-up bars
    })

    it('rebuilds with a new key when an indicator is added', () => {
      const app = makeApp({}, { indicators: [{ id: 'ema-20', name: 'ema', params: { period: 20 } }] })
      renderIn(<ChartPane />, app)
      act(() => app.ctl.addIndicator('rsi'))
      expect(last(chart().setIndicators)[1]).toBe('ema-20|rsi-14')
    })
  })

  describe('keyboard', () => {
    it('Delete removes the selected line', async () => {
      const app = makeApp({}, { drawings: [line()], selectedDrawingId: 'd1' })
      renderIn(<ChartPane />, app)
      await userEvent.keyboard('{Delete}')
      await waitFor(() => expect(app.api.deleteDrawing).toHaveBeenCalledWith('d1'))
    })

    it('Escape goes back to the cursor and deselects', async () => {
      const app = makeApp({}, { tool: 'trend_line', selectedDrawingId: 'd1' })
      renderIn(<ChartPane />, app)
      await userEvent.keyboard('{Escape}')
      expect(app.store.get()).toMatchObject({ tool: 'cursor', selectedDrawingId: null })
    })

    it('Backspace in a text box does not delete the line behind it', async () => {
      const app = makeApp({}, { drawings: [line()], selectedDrawingId: 'd1' })
      renderIn(<><input aria-label="note" /><ChartPane /></>, app)
      await userEvent.type(screen.getByLabelText('note'), 'a{Backspace}')
      expect(app.api.deleteDrawing).not.toHaveBeenCalled()
    })
  })
  describe('a backtest drawn on the chart', () => {
    const c = (time: number) => ({ time, open: 1, high: 2, low: 1, close: 2, volume: 1 })
    const overlay = (symbol = SBIN) => {
      const r = btReport()
      return { label: 'Oct', open: [], focus: null, trades: [{ ...r.trades[0], symbol, entry_time: new Date((T0 - 3600 + 3600) * 1000).toISOString(), exit_time: new Date((T0 + 3600) * 1000).toISOString() }] }
    }
    const candles = [c(T0 - 3600), c(T0), c(T0 + 3600)]

    it('marks entries and exits and links them with a line', () => {
      renderIn(<ChartPane />, makeApp({}, { candles, btOverlay: overlay() }))
      const ids = last(chart().setMarkers)[0].map((m: { id: string }) => m.id)
      expect(ids).toEqual(expect.arrayContaining(['bt:0:in', 'bt:0:out']))
      expect(last(chart().setSegments)[0]).toHaveLength(1)
    })

    it('draws nothing for another symbol or once hidden', () => {
      const app = makeApp({}, { candles, btOverlay: overlay(TCS) })
      renderIn(<ChartPane />, app)
      expect(last(chart().setMarkers)[0]).toEqual([])
      expect(last(chart().setSegments)[0]).toEqual([])
    })

    it('centres the chart on the trade being looked at', () => {
      renderIn(<ChartPane />, makeApp({}, { candles, btOverlay: { ...overlay(), focus: T0 } }))
      expect(last(chart().focus)[0]).toBe(T0)
    })

    it('draws the exits of positions that have already closed', () => {
      const closed = position({ status: 'closed', exit_reason: 'target', exit_price: 105, realized_pnl: 50, closed_at: T0 })
      renderIn(<ChartPane />, makeApp({}, { candles, positions: { open: [], closed: [closed] } }))
      expect(last(chart().setMarkers)[0].map((m: { text: string }) => m.text)).toEqual(['TP 105.00'])
    })
  })

  it('re-colours the chart when the theme changes', () => {
    const app = makeApp()
    renderIn(<ChartPane />, app)
    const before = chart().setTheme.mock.calls.length
    act(() => app.ctl.setTheme({ ...app.store.get().theme, bg: '#101010' }))
    expect(chart().setTheme.mock.calls.length).toBeGreaterThan(before)
  })
})
