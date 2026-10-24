import type {
  BacktestOpen, BacktestTrade, Candle, Drawing, Financials, IndicatorName, Position, Quote, Rule, RuleDraft, ServerStatus, Signal, Timeframe, TradeLineToggles, Watchlist,
} from '../api/types'
import type { SocketState } from '../api/socket'
import { DEFAULT_THEME, type Theme } from '../lib/theme'

export type Tool = 'cursor' | 'trend_line' | 'ray' | 'horizontal_line' | 'rectangle' | 'text'
export type View = 'chart' | 'screener' | 'strategies' | 'results' | 'sectors' | 'backtests' | 'data'
export type DockTab = 'positions' | 'orders' | 'watch' | 'ticket' | 'signals' | 'rules' | 'financials' | 'drawings' | 'triggers'
export type IndicatorConfig = { id: string; name: IndicatorName; params: Record<string, number>; hidden?: boolean }
/** A finished backtest being shown on the chart. focus = unix time of the trade the chart should be centred on. */
export type BacktestOverlay = { label: string; trades: BacktestTrade[]; open: BacktestOpen[]; focus: number | null }
/** Screener results being walked on the chart: not saved anywhere, gone when closed. */
export type Browse = { label: string; symbols: string[]; timeframe: Timeframe }
export type Toast = { id: number; kind: 'error' | 'info' | 'success'; text: string }

export type AppState = {
  view: View
  symbol: string
  timeframe: Timeframe
  candles: Candle[]
  candlesLoading: boolean
  quotes: Record<string, Quote>
  watchlists: Watchlist[]
  activeWatchlistId: string | null
  browse: Browse | null
  /** The watchlist panel shows `browse` instead of the active watchlist. */
  browseActive: boolean
  drawings: Drawing[]
  selectedDrawingId: string | null
  tool: Tool
  rules: Rule[]
  signals: Signal[]
  positions: { open: Position[]; closed: Position[] }
  financials: Financials | null
  financialsLoading: boolean
  indicators: IndicatorConfig[]
  showResults: boolean
  showPe: boolean
  tradeLines: TradeLineToggles
  /** The indicator whose settings the toolbar's editor is open for (from the legend's ⚙), or null. */
  editingIndicator: string | null
  btOverlay: BacktestOverlay | null
  theme: Theme
  connection: SocketState
  server: ServerStatus | null
  feed: string
  dock: DockTab
  dockCollapsed: boolean
  chartFull: boolean
  toast: Toast | null
  ruleDialog: RuleDraft | null
  booted: boolean
}

export const initialState: AppState = {
  view: 'chart',
  symbol: 'NSE:SBIN-EQ',
  timeframe: '1H',
  candles: [],
  candlesLoading: false,
  quotes: {},
  watchlists: [],
  activeWatchlistId: null,
  browse: null,
  browseActive: false,
  drawings: [],
  selectedDrawingId: null,
  tool: 'cursor',
  rules: [],
  signals: [],
  positions: { open: [], closed: [] },
  financials: null,
  financialsLoading: false,
  indicators: [
    { id: 'ema-20', name: 'ema', params: { period: 20 } },
    { id: 'supertrend-10-3', name: 'supertrend', params: { period: 10, multiplier: 3 } },
    { id: 'supertrend-5-2', name: 'supertrend', params: { period: 5, multiplier: 2 } },
  ],
  showResults: true,
  showPe: false,
  tradeLines: { stop: true, target: true, entry: true },
  editingIndicator: null,
  btOverlay: null,
  theme: DEFAULT_THEME,
  connection: 'closed',
  server: null,
  feed: 'disconnected',
  dock: 'positions',
  dockCollapsed: false,
  chartFull: false,
  toast: null,
  ruleDialog: null,
  booted: false,
}
