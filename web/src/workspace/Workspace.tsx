import { useEffect, useMemo } from 'react'
import { ApiClient } from './api/client'
import { LiveSocket, defaultSocketUrl } from './api/socket'
import { ChartPane } from './components/ChartPane'
import { ChartToolbar } from './components/ChartToolbar'
import { DrawingRail } from './components/DrawingRail'
import { AppContext, useSel, type AppContextValue } from './components/context'
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

function Body() {
  const view = useSel((s) => s.view)
  return (
    <div className="body">
      <WatchlistPanel />
      <main className="main">
        {view === 'chart' && (
          <>
            <ChartToolbar />
            <div className="chart-area">
              <DrawingRail />
              <ErrorBoundary label="chart"><ChartPane /></ErrorBoundary>
            </div>
            <Dock />
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
