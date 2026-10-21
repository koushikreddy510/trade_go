import { useEffect, useMemo, useState } from 'react'
import { ApiClient } from './api/client'
import { LiveSocket, defaultSocketUrl } from './api/socket'
import { ChartPane } from './components/ChartPane'
import { ChartToolbar } from './components/ChartToolbar'
import { DrawingRail } from './components/DrawingRail'
import { AppContext, useApp, useSel, type AppContextValue } from './components/context'
import { Dock } from './components/Dock'
import { ErrorBoundary } from './components/ErrorBoundary'
import { RuleDialog } from './components/RuleDialog'
import { ToastHost } from './components/Toast'
import { TopBar } from './components/TopBar'
import { WatchlistPanel } from './components/WatchlistPanel'
import { cssVars } from './lib/theme'
import { Controller } from './store/controller'
import { createStore } from './store/store'
import { initialState } from './store/state'
import { ResultsView } from './views/ResultsView'
import { ScreenerView } from './views/ScreenerView'
import { SectorsView } from './views/SectorsView'
import { BacktestView } from './views/BacktestView'
import { DataView } from './views/DataView'
import { StrategiesView } from './views/StrategiesView'
import './styles.css'

export const PHONE_QUERY = '(max-width: 760px)'

/** True on a phone-sized screen; follows rotation and window resizes. */
export function usePhone(): boolean {
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE_QUERY) : null
  const [phone, setPhone] = useState(() => query?.matches ?? false)
  useEffect(() => {
    if (!query) return
    const on = (e: MediaQueryListEvent) => setPhone(e.matches)
    query.addEventListener?.('change', on)
    return () => query.removeEventListener?.('change', on)
  }, [query])
  return phone
}

function Body() {
  const { ctl } = useApp()
  const view = useSel((s) => s.view)
  const symbol = useSel((s) => s.symbol)
  const chartFull = useSel((s) => s.chartFull)
  const phone = usePhone()
  const [wlCollapsed, setWlCollapsed] = useState(phone)   // on a phone the watchlist is a drawer, closed until asked for
  useEffect(() => { if (phone) setWlCollapsed(true) }, [phone, symbol])   // ...and it closes once a symbol is picked
  return (
    <div className={phone ? 'body phone' : 'body'}>
      {!chartFull && <WatchlistPanel collapsed={wlCollapsed} onToggle={() => setWlCollapsed((v) => !v)} />}
      {phone && !wlCollapsed && !chartFull && <div className="wl-backdrop" onClick={() => setWlCollapsed(true)} />}
      <main className="main">
        {view === 'chart' && (
          <>
            <ChartToolbar />
            <div className="chart-area">
              <DrawingRail />
              <ErrorBoundary label="chart"><ChartPane /></ErrorBoundary>
              <button className="chart-full-btn" title={chartFull ? 'Exit fullscreen' : 'Fullscreen chart'} onClick={() => ctl.toggleChartFull()}>
                {chartFull ? '⤡' : '⤢'}
              </button>
            </div>
            {!chartFull && <Dock />}
          </>
        )}
        {view === 'screener' && <ScreenerView />}
        {view === 'strategies' && <StrategiesView />}
        {view === 'results' && <ResultsView />}
        {view === 'sectors' && <SectorsView />}
        {view === 'backtests' && <BacktestView />}
        {view === 'data' && <DataView />}
      </main>
    </div>
  )
}

/** The whole terminal. Pass your own `ctx` in tests; by default it talks to the real server. */
export default function Workspace({ ctx }: { ctx?: AppContextValue }) {
  const value = useMemo<AppContextValue>(() => {
    if (ctx) return ctx
    const store = createStore(initialState)
    const api = new ApiClient()
    const ctl: Controller = new Controller(api, new LiveSocket({ url: defaultSocketUrl(), onMessage: (m) => ctl.onMessage(m), onState: (connection) => ctl.onConnection(connection) }), store, window.localStorage)
    return { store, ctl, api }
  }, [ctx])

  useEffect(() => {
    void value.ctl.boot()
    return () => value.ctl.dispose()
  }, [value])

  return (
    <AppContext.Provider value={value}>
      <Themed />
    </AppContext.Provider>
  )
}

function Themed() {
  const theme = useSel((s) => s.theme)
  return (
    <div className="workspace" style={cssVars(theme)}>
      <TopBar />
      <Body />
      <RuleDialog />
      <ToastHost />
    </div>
  )
}
