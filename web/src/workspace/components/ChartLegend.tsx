import type { Legend } from '../chart/legend'
import { shortSymbol } from '../lib/format'
import { useApp } from './context'

/** OHLC and indicator values over the top-left corner of the chart, TradingView style. Each indicator row has
 *  hide/show, settings and remove buttons (shown on hover); a hidden indicator keeps its row, greyed out. */
export function ChartLegend({ symbol, timeframe, legend, hidden = new Set() }: { symbol: string; timeframe: string; legend: Legend | null; hidden?: Set<string> }) {
  const { ctl } = useApp()
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
      {legend.indicators.map((ind) => {
        const off = hidden.has(ind.id)
        const isIndicator = !ind.id.startsWith('fund:')          // the P/E pane is toggled from the toolbar, not here
        return (
          <div key={ind.id} className={off ? 'legend-row legend-ind off' : 'legend-row legend-ind'} data-testid={`legend-${ind.id}`}>
            <span className="muted">{ind.label}</span>
            {!off && ind.values.map((v) => <i key={v.key} style={{ color: v.color }}>{v.text}</i>)}
            {isIndicator && (
              <span className="legend-actions">
                <button title={off ? 'Show' : 'Hide'} aria-label={`${off ? 'Show' : 'Hide'} ${ind.label}`} onClick={() => ctl.toggleIndicatorHidden(ind.id)}>{off ? '◌' : '👁'}</button>
                <button title="Settings" aria-label={`Settings of ${ind.label}`} onClick={() => ctl.editIndicator(ind.id)}>⚙</button>
                <button title="Remove" aria-label={`Remove ${ind.label}`} onClick={() => ctl.removeIndicator(ind.id)}>×</button>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
