import { useEffect, useState } from 'react'
import type { BrokerQuote, OrderPreview, ProductChoice } from '../api/types'
import { fmtPct, fmtPrice, fmtVolume, shortSymbol, sign } from '../lib/format'
import { useApp, useSel } from './context'

const rupees = (n: number | null | undefined) => (n === null || n === undefined ? '-' : `₹${fmtPrice(n)}`)
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Price, depth and contract details for the chart's symbol, and what an order would cost. Preview only: no order is sent. */
export function OrderTicket() {
  const { api } = useApp()
  const symbol = useSel((s) => s.symbol)
  const live = useSel((s) => s.quotes[s.symbol]?.price)
  const exchange = symbol.split(':')[0]
  const derivative = exchange !== 'NSE' && exchange !== 'BSE'

  const [quote, setQuote] = useState<BrokerQuote | null>(null)
  const [products, setProducts] = useState<ProductChoice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [quantity, setQuantity] = useState(1)
  const [product, setProduct] = useState('')
  const [priceType, setPriceType] = useState<'LMT' | 'MKT'>('LMT')
  const [price, setPrice] = useState('')
  const [preview, setPreview] = useState<OrderPreview | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setQuote(null); setPreview(null); setError(null); setPrice(''); setQuantity(1)
    api.quote(symbol).then((q) => { if (alive) setQuote(q) }).catch((e) => { if (alive) setError(errorText(e)) })
    api.products().then((all) => {
      if (!alive) return
      const list = all[exchange] ?? []
      setProducts(list)
      const preferred = derivative ? 'M' : 'C'
      setProduct(list.some((p) => p.prd === preferred) ? preferred : list[0]?.prd ?? '')
    }).catch(() => {})
    return () => { alive = false }
  }, [api, symbol, exchange, derivative])

  const ltp = live ?? quote?.ltp ?? null
  const check = async () => {
    setBusy(true); setError(null)
    try {
      setPreview(await api.orderPreview({ symbol, side, quantity, product: product || undefined, price_type: priceType, price: priceType === 'LMT' && price ? Number(price) : undefined }))
    } catch (e) {
      setPreview(null); setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel ticket" aria-label="Order ticket">
      <div className="panel-head">
        <b>{shortSymbol(symbol)}</b>
        <span className="muted">{exchange}{quote?.instrument ? ` · ${quote.instrument}` : ''}{quote?.expiry ? ` · expires ${quote.expiry}` : ''}</span>
        <span className="ticket-ltp">{fmtPrice(ltp)}</span>
        {quote?.change !== null && quote?.change !== undefined && <span className={sign(quote.change)}>{fmtPrice(quote.change)} ({fmtPct(quote.change_pct)})</span>}
        <span className="badge preview" title="Margin and value come from the broker's calculator. Nothing is sent to the exchange.">PREVIEW ONLY</span>
      </div>

      {quote && (
        <div className="ratios">
          <span><small>Bid</small> <b className="up">{fmtPrice(quote.bid)}</b> × {quote.bid_qty ?? '-'}</span>
          <span><small>Ask</small> <b className="down">{fmtPrice(quote.ask)}</b> × {quote.ask_qty ?? '-'}</span>
          <span><small>Day</small> {fmtPrice(quote.low)} – {fmtPrice(quote.high)}</span>
          <span><small>Circuit</small> {fmtPrice(quote.lower_circuit)} – {fmtPrice(quote.upper_circuit)}</span>
          <span><small>Volume</small> {fmtVolume(quote.volume)}</span>
          {derivative && <span><small>OI</small> {fmtVolume(quote.oi)}</span>}
          {derivative && <span><small>Lot</small> {quote.lot_size} · ₹{fmtPrice(quote.point_value)} per point per lot</span>}
        </div>
      )}

      <div className="ticket-form">
        <span className="seg">
          <button className={side === 'BUY' ? 'chip active' : 'chip'} onClick={() => setSide('BUY')}>Buy</button>
          <button className={side === 'SELL' ? 'chip active sell' : 'chip'} onClick={() => setSide('SELL')}>Sell</button>
        </span>
        <label>{derivative ? 'Lots' : 'Shares'}
          <input aria-label="Order quantity" type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        </label>
        <label>Product
          <select aria-label="Order product" value={product} onChange={(e) => setProduct(e.target.value)}>
            {products.map((p) => <option key={p.prd} value={p.prd}>{p.name}</option>)}
          </select>
        </label>
        <label>Type
          <select aria-label="Order price type" value={priceType} onChange={(e) => setPriceType(e.target.value as 'LMT' | 'MKT')}>
            <option value="LMT">Limit</option><option value="MKT">Market</option>
          </select>
        </label>
        {priceType === 'LMT' && (
          <label>Price
            <input aria-label="Order price" type="number" step={quote?.tick_size ?? 0.05} placeholder={fmtPrice(ltp)} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        )}
        <button className="primary" disabled={busy || !product} onClick={check}>{busy ? 'Checking…' : 'Check margin'}</button>
      </div>

      {error && <p className="ticket-error" role="alert">{error}</p>}

      {preview && (
        <div className="ticket-result" aria-label="Order preview">
          <div><small>{preview.side === 'BUY' ? 'Buy' : 'Sell'} {preview.quantity} {preview.quantity_unit === 'lots' ? `lot${preview.quantity === 1 ? '' : 's'} (${preview.units} units)` : 'shares'} · {preview.product_name} @ {fmtPrice(preview.price)}</small></div>
          <div><small>Contract value</small> <b>{rupees(preview.contract_value)}</b></div>
          <div><small>Margin required</small> <b>{rupees(preview.margin_required)}</b></div>
          <div><small>Available funds</small> <b>{rupees(preview.available)}</b></div>
          <div><small>{preview.shortfall > 0 ? 'Shortfall' : 'Left after order'}</small> <b className={preview.shortfall > 0 ? 'down' : 'up'}>{rupees(preview.shortfall > 0 ? preview.shortfall : preview.available - preview.margin_required)}</b></div>
          {preview.broker_remarks && <div className="muted">Broker check: {preview.broker_remarks === 'Order Success' ? 'margin check passed (no order was placed)' : preview.broker_remarks}</div>}
          {preview.existing_position && (
            <p className="ticket-warn" role="alert">
              You already hold {preview.existing_position.net_quantity} units of this contract as {preview.existing_position.product === 'M' ? 'NRML' : preview.existing_position.product}.
              An order with the same product would net into that position.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
