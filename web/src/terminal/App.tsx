import { useCallback, useEffect, useState } from 'react'
import { chart, drawings, removeDrawing, saveDrawing } from './api'
import { Chart } from './Chart'
import type { Drawing, Snapshot, Timeframe } from './types'

const frames: Timeframe[] = ['1H', '2H', '4H']
export function App() {
  const [timeframe, setTimeframe] = useState<Timeframe>('1H')
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [savedDrawings, setSavedDrawings] = useState<Drawing[]>([])
  const [tool, setTool] = useState<'cursor' | 'trend_line' | 'horizontal_line'>('cursor')
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try { const [next, lines] = await Promise.all([chart(timeframe), drawings(timeframe)]); setSnapshot(next); setSavedDrawings(lines); setError(undefined) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to reach Atlas') }
  }, [timeframe])
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(timer) }, [refresh])
  const addDrawing = async (drawing: Pick<Drawing, 'kind' | 'points'>) => {
    const saved = await saveDrawing(timeframe, { ...drawing, id: crypto.randomUUID(), color: drawing.kind === 'horizontal_line' ? '#30d5c8' : '#f7b955' })
    setSavedDrawings((current) => [...current, saved]); setTool('cursor')
  }
  const deleteDrawing = async (id: string) => { await removeDrawing(timeframe, id); setSavedDrawings((current) => current.filter((line) => line.id !== id)) }
  return <main className="terminal">
    <header><div><p className="eyebrow">ATLAS / PAPER TERMINAL</p><h1>{snapshot ? `${snapshot.symbol.Exchange}:${snapshot.symbol.Name}` : 'Atlas Terminal'}</h1></div><div className="connection"><span className={error ? 'dot down' : 'dot'} />{error ? 'API unavailable' : 'Paper data'}</div></header>
    <section className="toolbar"><div className="segments">{frames.map((frame) => <button key={frame} className={frame === timeframe ? 'selected' : ''} onClick={() => setTimeframe(frame)}>{frame}</button>)}</div><div className="segments"><button className={tool === 'cursor' ? 'selected' : ''} onClick={() => setTool('cursor')}>Cursor</button><button className={tool === 'trend_line' ? 'selected' : ''} onClick={() => setTool('trend_line')}>Trend line</button><button className={tool === 'horizontal_line' ? 'selected' : ''} onClick={() => setTool('horizontal_line')}>Level</button></div><button onClick={() => void refresh()}>Refresh</button></section>
    {error && <div className="error">Atlas is not running yet. Start it with `make serve`, then refresh this page. {error}</div>}
    <section className="grid"><div className="chart-card"><Chart candles={snapshot?.candles ?? []} drawings={savedDrawings} tool={tool} onComplete={(line) => void addDrawing(line)} /><p className="hint">{tool === 'trend_line' ? 'Click two prices on the chart to save a trend line.' : tool === 'horizontal_line' ? 'Click a price to save a horizontal level.' : 'Choose a drawing tool to annotate this symbol and timeframe.'}</p></div>
      <aside><section className="panel"><h2>Open positions</h2>{snapshot?.positions.length ? snapshot.positions.map((position) => <article className="position" key={position.TradeID}><strong>{position.Side} · {position.StrategyID}</strong><span>{position.Quantity} qty @ {position.Position.AvgPrice.toFixed(2)}</span><span>SL {position.Risk.StopLoss || '—'} · Target {position.Risk.Target || '—'}</span><b className={position.Position.UnrealizedPnL >= 0 ? 'positive' : 'negative'}>₹ {position.Position.UnrealizedPnL.toFixed(2)}</b></article>) : <p className="empty">No Atlas-managed open positions.</p>}</section><section className="panel"><h2>Saved drawings</h2>{savedDrawings.length ? savedDrawings.map((drawing) => <div className="drawing" key={drawing.id}><span>{drawing.kind.replace('_', ' ')}</span><button onClick={() => void deleteDrawing(drawing.id)}>Remove</button></div>) : <p className="empty">No drawings for {timeframe}.</p>}</section></aside></section>
  </main>
}
