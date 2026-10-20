import type { Legend } from '../chart/legend'
import { shortSymbol } from '../lib/format'

/** OHLC and indicator values over the top-left corner of the chart, TradingView style. */
export function ChartLegend({ symbol, timeframe, legend }: { symbol: string; timeframe: string; legend: Legend | null }) {
  if (!legend) return null
  return (
    <div className="legend" data-testid="chart-legend" aria-label="Candle values">
      <div className="legend-row">
        <b>{shortSymbol(symbol)}</b><span className="muted">· {timeframe}</span>
        <span>O <i className={legend.tone}>{legend.open}</i></span>
        <span>H <i className={legend.tone}>{legend.high}</i></span>
        <span>L <i className={legend.tone}>{legend.low}</i></span>
        <span>C <i className={legend.tone}>{legend.close}</i></span>
        <i className={legend.tone}>{legend.change}</i>
        <span>Vol <i className="muted-v">{legend.volume}</i></span>
      </div>
      {legend.indicators.map((ind) => (
        <div key={ind.id} className="legend-row" data-testid={`legend-${ind.id}`}>
          <span className="muted">{ind.label}</span>
          {ind.values.map((v) => <i key={v.key} style={{ color: v.color }}>{v.text}</i>)}
        </div>
      ))}
    </div>
  )
}
