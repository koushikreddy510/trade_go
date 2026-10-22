// The app's brain: loads data, reacts to live messages, and turns user actions into API
// calls. Components stay dumb (read the store, call a method). Everything here is
// testable with a fake API and a fake socket - see controller.test.ts.
import type { ApiClient } from '../api/client'
import type { LiveSocket } from '../api/socket'
import type { BacktestReport, DrawingKind, DrawingPoint, IndicatorName, Position, RuleDraft, ServerMessage, Signal, Timeframe } from '../api/types'
import { applyTheme } from '../chart/overlays'
import { INDICATORS } from '../lib/indicators'
import { parseTheme, type Theme } from '../lib/theme'
import { applyClosedBar, applyTick } from '../lib/candles'
import { fmtPnl, fmtPrice, shortSymbol } from '../lib/format'
import type { Store } from './store'
import type { AppState, DockTab, IndicatorConfig, Tool, View } from './state'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
type Api = Pick<
  ApiClient,
  | 'status' | 'candles' | 'watchlists' | 'createWatchlist' | 'renameWatchlist' | 'deleteWatchlist' | 'addToWatchlist'
  | 'removeFromWatchlist' | 'reorderWatchlist' | 'drawings' | 'createDrawing' | 'updateDrawing' | 'deleteDrawing' | 'rules'
  | 'saveRule' | 'setRuleEnabled' | 'deleteRule' | 'signals' | 'positions' | 'closePosition' | 'financials'
>
type Socket = Pick<LiveSocket, 'setSymbols' | 'connect' | 'close'>

const KEY = 'workspace.prefs.v1'
const MAX_SIGNALS = 200
let toastId = 0

export class Controller {
  private chartRequest = 0

  constructor(
    private api: Api,
    private socket: Socket,
    readonly store: Store<AppState>,
    private storage: StorageLike | null = null,
  ) {}

  // ---------------------------------------------------------------- helpers
  private get s() {
    return this.store.get()
  }

  private toast(kind: 'error' | 'info' | 'success', text: string) {
    this.store.set({ toast: { id: ++toastId, kind, text } })
  }

  /** For views that call the API themselves (the screener) and want to tell the user the outcome. */
  notify(kind: 'error' | 'info' | 'success', text: string) {
    this.toast(kind, text)
  }

  dismissToast() {
    this.store.set({ toast: null })
  }

  private async guard<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work()
    } catch (e) {
      this.toast('error', e instanceof Error ? e.message : String(e))
      return undefined
    }
  }

  private savePrefs() {
    try {
      const { symbol, timeframe, indicators, activeWatchlistId, dock, showResults, showPe, theme, tradeLines } = this.s
      this.storage?.setItem(KEY, JSON.stringify({ symbol, timeframe, indicators, activeWatchlistId, dock, showResults, showPe, theme, tradeLines }))
    } catch {
      /* storage can be unavailable (private mode); preferences are a convenience only */
    }
  }

  private loadPrefs(): Partial<AppState> {
    try {
      const raw = this.storage?.getItem(KEY)
      return raw ? (JSON.parse(raw) as Partial<AppState>) : {}
    } catch {
      return {}
    }
  }

  /** Everything the server must stream to us: watchlists, the open chart, open positions. */
  syncSubscriptions() {
    const wanted = new Set<string>([this.s.symbol])
    this.s.watchlists.forEach((w) => w.symbols.forEach((x) => wanted.add(x)))
    this.s.positions.open.forEach((p) => wanted.add(p.symbol))
    this.socket.setSymbols(wanted)
  }

  // ------------------------------------------------------------------- boot
  async boot() {
    const prefs = this.loadPrefs()
    this.store.set({
      ...(prefs.timeframe ? { timeframe: prefs.timeframe } : {}),
      ...(prefs.indicators ? { indicators: prefs.indicators } : {}),
      ...(prefs.dock ? { dock: prefs.dock } : {}),
      ...(typeof prefs.showResults === 'boolean' ? { showResults: prefs.showResults } : {}),
      ...(typeof prefs.showPe === 'boolean' ? { showPe: prefs.showPe } : {}),
      ...(prefs.tradeLines && typeof prefs.tradeLines === 'object' ? { tradeLines: { ...this.s.tradeLines, ...prefs.tradeLines } } : {}),
    })
    if (prefs.theme) this.setTheme(parseTheme(prefs.theme))
    const [watchlists, positions, signals, rules, server] = await Promise.all([
      this.guard(() => this.api.watchlists()),
      this.guard(() => this.api.positions()),
      this.guard(() => this.api.signals(MAX_SIGNALS)),
      this.guard(() => this.api.rules()),
      this.guard(() => this.api.status()),
    ])
    const lists = watchlists ?? []
    const active = lists.find((w) => w.id === prefs.activeWatchlistId) ?? lists[0] ?? null
    const symbol = prefs.symbol ?? active?.symbols[0] ?? this.s.symbol
    this.store.set({
      watchlists: lists,
      activeWatchlistId: active?.id ?? null,
      positions: positions ?? this.s.positions,
      signals: signals ?? [],
      rules: rules ?? [],
      server: server ?? null,
      feed: server?.feed ?? this.s.feed,
      symbol,
      booted: true,
    })
    this.socket.connect()
    this.syncSubscriptions()
    await this.loadChart()
  }

  // -------------------------------------------------------------- chart data
  async loadChart() {
    const request = ++this.chartRequest
    const { symbol, timeframe } = this.s
    this.store.set({ candlesLoading: true, drawings: [], selectedDrawingId: null })
    const [chart, drawings] = await Promise.all([
      // a backtest spans months, so ask for as much history as the server will give
      this.guard(() => (this.s.btOverlay ? this.api.candles(symbol, timeframe, 5000) : this.api.candles(symbol, timeframe))),
      this.guard(() => this.api.drawings(symbol)),
    ])
    if (request !== this.chartRequest) return // the user already moved on to another symbol/timeframe
    this.store.set({ candles: chart?.candles ?? [], drawings: drawings ?? [], candlesLoading: false })
    void this.loadFinancials(symbol, request)
  }

  private async loadFinancials(symbol: string, request: number) {
    this.store.set({ financialsLoading: true })
    const financials = await this.guard(() => this.api.financials(symbol))
    if (request !== this.chartRequest) return
    this.store.set({ financials: financials ?? null, financialsLoading: false })
  }

  async selectSymbol(symbol: string) {
    if (symbol === this.s.symbol && this.s.view === 'chart') return
    this.store.set({ symbol, view: 'chart', candles: [], financials: null })
    this.savePrefs()
    this.syncSubscriptions()
    await this.loadChart()
  }

  setTheme(theme: Theme) {
    applyTheme(theme) // before the store change, so what re-renders already sees the new colours
    this.store.set({ theme })
    this.savePrefs()
  }

  /** Put a finished backtest's trades on the chart of `symbol` (centred on one trade when given). */
  async showBacktest(label: string, report: Pick<BacktestReport, 'trades' | 'open'>, symbol: string, focusIso?: string) {
    this.store.set({ btOverlay: { label, trades: report.trades, open: report.open, focus: focusIso ? Date.parse(focusIso) / 1000 : null } })
    if (symbol === this.s.symbol && this.s.view === 'chart') return
    await this.selectSymbol(symbol)
  }

  focusBacktest(focusIso: string) {
    const o = this.s.btOverlay
    if (o) this.store.set({ btOverlay: { ...o, focus: Date.parse(focusIso) / 1000 } })
  }

  hideBacktest() {
    this.store.set({ btOverlay: null })
  }

  async setTimeframe(tf: Timeframe) {
    if (tf === this.s.timeframe) return
    this.store.set({ timeframe: tf, candles: [] })
    this.savePrefs()
    await this.loadChart()
  }

  setView(view: View) {
    this.store.set({ view })
  }

  setTool(tool: Tool) {
    this.store.set({ tool, selectedDrawingId: tool === 'cursor' ? this.s.selectedDrawingId : null })
  }

  setDock(dock: DockTab) {
    this.store.set({ dock })
    this.savePrefs()
  }

  // ------------------------------------------------------------ connection
  private hadConnection = false

  /** Socket state changes. When it comes back after a drop, everything pushed while it was down is lost
   *  (bar closes, signals, position changes: the server never replays them), so re-read the current state over REST. */
  onConnection = (connection: AppState['connection']): void => {
    this.store.set({ connection })
    if (connection !== 'open') return
    const reconnected = this.hadConnection
    this.hadConnection = true
    if (reconnected) void this.resync()
  }

  /** Refresh what a dropped socket may have made stale. Drawings and rules are only changed by this browser, so they are kept. */
  async resync() {
    const request = ++this.chartRequest
    const { symbol, timeframe } = this.s
    const [chart, positions, signals] = await Promise.all([
      // a backtest spans months, so ask for as much history as the server will give
      this.guard(() => (this.s.btOverlay ? this.api.candles(symbol, timeframe, 5000) : this.api.candles(symbol, timeframe))),
      this.guard(() => this.api.positions()),
      this.guard(() => this.api.signals(MAX_SIGNALS)),
    ])
    const patch: Partial<AppState> = {}
    if (chart && request === this.chartRequest) patch.candles = chart.candles
    if (positions) patch.positions = positions
    if (signals) patch.signals = signals
    this.store.set(patch)
    this.syncSubscriptions()
  }

  // ------------------------------------------------------------ live messages
  onMessage = (m: ServerMessage): void => {
    switch (m.type) {
      case 'hello':
        this.store.set({ server: m, feed: m.feed })
        break
      case 'status':
        this.store.set({ feed: m.feed })
        break
      case 'tick': {
        const q = m.quote
        const patch: Partial<AppState> = { quotes: { ...this.s.quotes, [q.symbol]: q } }
        if (q.symbol === this.s.symbol) {
          const next = applyTick(this.s.candles, q.symbol, this.s.timeframe, q.price, q.ts)
          if (next !== this.s.candles) patch.candles = next
        }
        this.store.set(patch)
        break
      }
      case 'bar_closed':
        if (m.symbol === this.s.symbol && m.timeframe === this.s.timeframe) {
          this.store.set({ candles: applyClosedBar(this.s.candles, m.bar) })
        }
        break
      case 'signal':
        this.onSignal(m.signal)
        break
      case 'position':
        this.onPosition(m.position)
        break
      case 'error':
        this.toast('error', m.message)
        break
    }
  }

  private onSignal(signal: Signal) {
    if (this.s.signals.some((x) => x.id === signal.id)) return
    this.store.set({ signals: [signal, ...this.s.signals].slice(0, MAX_SIGNALS) })
    const what = `${signal.side} ${shortSymbol(signal.symbol)} ${signal.timeframe} @ ${fmtPrice(signal.entry)}`
    this.toast(signal.status === 'open' ? 'success' : 'info', signal.status === 'open' ? `Signal: ${what}` : `Signal skipped (${signal.reason}): ${what}`)
  }

  private onPosition(p: Position) {
    const { open, closed } = this.s.positions
    const rest = open.filter((x) => x.id !== p.id)
    if (p.status === 'open') {
      this.store.set({ positions: { open: [p, ...rest], closed } })
    } else {
      this.store.set({ positions: { open: rest, closed: [p, ...closed.filter((x) => x.id !== p.id)] } })
      const why = p.exit_reason === 'stop' ? 'stop hit' : p.exit_reason === 'target' ? 'target hit' : p.exit_reason === 'exit_rule' ? 'exit rule met' : 'closed'
      this.toast(p.realized_pnl !== null && p.realized_pnl >= 0 ? 'success' : 'info', `${shortSymbol(p.symbol)} ${why}: ${fmtPnl(p.realized_pnl)}`)
    }
    this.syncSubscriptions()
  }

  // --------------------------------------------------------------- watchlists
  setActiveWatchlist(id: string) {
    this.store.set({ activeWatchlistId: id })
    this.savePrefs()
  }

  private replaceWatchlist(updated: { id: string; name: string; symbols: string[] }) {
    this.store.set({ watchlists: this.s.watchlists.map((w) => (w.id === updated.id ? updated : w)) })
    this.syncSubscriptions()
  }

  /** Re-read the lists from the server (after a screener sync created or changed one) and optionally open one. */
  async reloadWatchlists(open?: string) {
    const lists = await this.guard(() => this.api.watchlists())
    if (!lists) return
    const keep = open ?? this.s.activeWatchlistId
    this.store.set({ watchlists: lists, activeWatchlistId: lists.find((w) => w.id === keep)?.id ?? lists[0]?.id ?? null })
    this.syncSubscriptions()
    this.savePrefs()
  }

  /** Show a watchlist's symbols next to the chart. */
  openWatchlist(id: string) {
    this.setActiveWatchlist(id)
    this.setView('chart')
  }

  async createWatchlist(name: string, symbols: string[] = []) {
    const wl = await this.guard(() => (symbols.length ? this.api.createWatchlist(name, symbols) : this.api.createWatchlist(name)))
    if (wl) {
      this.store.set({ watchlists: [...this.s.watchlists, wl], activeWatchlistId: wl.id })
      this.syncSubscriptions()
      this.savePrefs()
    }
    return wl
  }

  async renameWatchlist(id: string, name: string) {
    const wl = await this.guard(() => this.api.renameWatchlist(id, name))
    if (wl) this.replaceWatchlist(wl)
  }

  async deleteWatchlist(id: string) {
    if (this.s.watchlists.length <= 1) return this.toast('info', 'Keep at least one watchlist.')
    const done = await this.guard(async () => (await this.api.deleteWatchlist(id), true))
    if (!done) return
    const watchlists = this.s.watchlists.filter((w) => w.id !== id)
    this.store.set({ watchlists, activeWatchlistId: this.s.activeWatchlistId === id ? watchlists[0].id : this.s.activeWatchlistId })
    this.syncSubscriptions()
  }

  async addToWatchlist(symbol: string, id: string | null = this.s.activeWatchlistId) {
    if (!id) return
    const res = await this.guard(() => this.api.addToWatchlist(id, [symbol]))
    if (!res) return
    this.replaceWatchlist(res.watchlist)
    if (!res.added.length) this.toast('info', `${shortSymbol(symbol)} is already in ${res.watchlist.name}.`)
  }

  async removeFromWatchlist(symbol: string, id: string | null = this.s.activeWatchlistId) {
    if (!id) return
    const wl = await this.guard(() => this.api.removeFromWatchlist(id, symbol))
    if (wl) this.replaceWatchlist(wl)
  }

  async reorderWatchlist(symbols: string[], id: string | null = this.s.activeWatchlistId) {
    if (!id) return
    const prev = this.s.watchlists
    this.store.set({ watchlists: prev.map((w) => (w.id === id ? { ...w, symbols } : w)) }) // optimistic
    const wl = await this.guard(() => this.api.reorderWatchlist(id, symbols))
    if (wl) this.replaceWatchlist(wl)
    else this.store.set({ watchlists: prev })
  }

  // ---------------------------------------------------------------- drawings
  async addDrawing(kind: DrawingKind, points: DrawingPoint[]) {
    const d = await this.guard(() => this.api.createDrawing({ symbol: this.s.symbol, kind, points, ...(kind === 'text' ? { label: 'Note' } : {}) }))
    if (d) this.store.set({ drawings: [...this.s.drawings, d], tool: 'cursor', selectedDrawingId: d.id })
  }

  async moveDrawing(id: string, points: DrawingPoint[]) {
    const prev = this.s.drawings
    this.store.set({ drawings: prev.map((d) => (d.id === id ? { ...d, points } : d)) }) // optimistic: the line follows the mouse
    const d = await this.guard(() => this.api.updateDrawing(id, { points }))
    this.store.set({ drawings: d ? this.s.drawings.map((x) => (x.id === id ? d : x)) : prev })
  }

  async labelDrawing(id: string, label: string) {
    const d = await this.guard(() => this.api.updateDrawing(id, { label }))
    if (d) this.store.set({ drawings: this.s.drawings.map((x) => (x.id === id ? d : x)) })
  }

  selectDrawing(id: string | null) {
    this.store.set({ selectedDrawingId: id })
  }

  async deleteDrawing(id: string) {
    const done = await this.guard(async () => (await this.api.deleteDrawing(id), true))
    if (done) this.store.set({ drawings: this.s.drawings.filter((d) => d.id !== id), selectedDrawingId: this.s.selectedDrawingId === id ? null : this.s.selectedDrawingId })
  }

  // ------------------------------------------------------------------- rules
  openRuleDialog(draft: RuleDraft | null) {
    this.store.set({ ruleDialog: draft })
  }

  /** Returns true when the rule was saved (the dialog closes only then). */
  async saveRule(draft: RuleDraft): Promise<boolean> {
    const rule = await this.guard(() => this.api.saveRule(draft))
    if (!rule) return false
    const others = this.s.rules.filter((r) => r.id !== rule.id)
    this.store.set({ rules: [...others, rule], ruleDialog: null, dock: 'rules' })
    this.toast('success', `Rule “${rule.name || 'untitled'}” is ${rule.enabled ? 'on' : 'off'}. It acts only on completed candles.`)
    return true
  }

  async toggleRule(id: string, enabled: boolean) {
    const rule = await this.guard(() => this.api.setRuleEnabled(id, enabled))
    if (rule) this.store.set({ rules: this.s.rules.map((r) => (r.id === id ? rule : r)) })
  }

  async deleteRule(id: string) {
    const done = await this.guard(async () => (await this.api.deleteRule(id), true))
    if (done) this.store.set({ rules: this.s.rules.filter((r) => r.id !== id) })
  }

  // --------------------------------------------------------------- positions
  async closePosition(id: string) {
    const p = await this.guard(() => this.api.closePosition(id))
    if (p) this.onPosition(p)
  }

  // -------------------------------------------------------------- indicators
  addIndicator(name: IndicatorName, params: Record<string, number> = {}) {
    const merged = { ...INDICATORS[name].defaults, ...params }
    const id = `${name}-${Object.values(merged).join('-')}`
    if (this.s.indicators.some((i) => i.id === id)) return
    const cfg: IndicatorConfig = { id, name, params: merged }
    this.store.set({ indicators: [...this.s.indicators, cfg] })
    this.savePrefs()
  }

  /** Result-day markers on the candles / the P/E (TTM) pane under them. */
  toggleResults() {
    this.store.set({ showResults: !this.s.showResults })
    this.savePrefs()
  }

  /** Show or hide one kind of trade line (stop / target / entry) on the chart. */
  toggleTradeLine(kind: keyof AppState['tradeLines']) {
    this.store.set({ tradeLines: { ...this.s.tradeLines, [kind]: !this.s.tradeLines[kind] } })
    this.savePrefs()
  }

  togglePe() {
    this.store.set({ showPe: !this.s.showPe })
    this.savePrefs()
  }

  removeIndicator(id: string) {
    this.store.set({ indicators: this.s.indicators.filter((i) => i.id !== id) })
    this.savePrefs()
  }

  toggleDockCollapsed() { this.store.set({ dockCollapsed: !this.s.dockCollapsed }) }
  toggleChartFull() { this.store.set({ chartFull: !this.s.chartFull }) }

  dispose() {
    this.socket.close()
  }
}
