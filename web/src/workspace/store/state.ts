import type {
  BacktestOpen, BacktestTrade, Candle, Drawing, Financials, IndicatorName, Position, Quote, Rule, RuleDraft, ServerStatus, Signal, Timeframe, Watchlist,
} from '../api/types'
import type { SocketState } from '../api/socket'
import { DEFAULT_THEME, type Theme } from '../lib/theme'

export type Tool = 'cursor' | 'trend_line' | 'ray' | 'horizontal_line' | 'rectangle' | 'text'
export type View = 'chart' | 'screener' | 'strategies' | 'results' | 'sectors' | 'backtests' | 'data'
export type DockTab = 'positions' | 'orders' | 'ticket' | 'signals' | 'rules' | 'financials' | 'drawings' | 'triggers'
export type IndicatorConfig = { id: string; name: IndicatorName; params: Record<string, number> }
/** A finished backtest being shown on the chart. focus = unix time of the trade the chart should be centred on. */
export type BacktestOverlay = { label: string; trades: BacktestTrade[]; open: BacktestOpen[]; focus: number | null }
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
