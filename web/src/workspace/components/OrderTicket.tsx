import { useEffect, useState } from 'react'
import type { BrokerQuote, OrderPreview, ProductChoice } from '../api/types'
import { fmtPct, fmtPrice, fmtVolume, shortSymbol, sign } from '../lib/format'
import { LiveOrders } from './LiveOrders'
import { useApp, useSel } from './context'

const rupees = (n: number | null | undefined) => (n === null || n === undefined ? '-' : `₹${fmtPrice(n)}`)
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Price, depth and contract details for the chart's symbol, and what an order would cost. Preview only: no order is sent. */
export function OrderTicket() {
  const { api, ctl } = useApp()
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
  const [sending, setSending] = useState(false)
  const [ordersKey, setOrdersKey] = useState(0)
  const [sectorQuote, setSectorQuote] = useState<BrokerQuote | null>(null)
  const sectorLive = useSel((s) => (sectorQuote ? s.quotes[sectorQuote.symbol]?.price : undefined))

  useEffect(() => {
    let alive = true
    setQuote(null); setPreview(null); setError(null); setPrice(''); setQuantity(1); setSectorQuote(null)
    api.quote(symbol).then((q) => {
      if (!alive) return
      setQuote(q)
      if (q.sector_index) api.quote(q.sector_index).then((sq) => { if (alive) setSectorQuote(sq) }).catch(() => {})
    }).catch((e) => { if (alive) setError(errorText(e)) })
    api.products().then((all) => {
      if (!alive) return
      const list = all[exchange] ?? []
      setProducts(list)
      setProduct((list.find((p) => p.listed) ?? list[0])?.prd ?? '')
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

  const send = async () => {
    if (!preview) return
    const what = `${preview.side} ${preview.quantity} ${preview.quantity_unit === 'lots' ? 'lot(s) of ' : ''}${shortSymbol(symbol)} · ${preview.product_name} · ${priceType === 'MKT' ? 'at market (limit just through the spread)' : `limit ${fmtPrice(preview.price)}`}`
    if (!window.confirm(`Send this LIVE order to the exchange?\n\n${what}\n\nMargin ≈ ₹${fmtPrice(preview.margin_required)}`)) return
    setSending(true); setError(null)
    try {
      await api.placeOrder({ account: 'flattrade', symbol, side, quantity, product, price_type: priceType, price: priceType === 'LMT' && price ? Number(price) : undefined })
      setPreview(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSending(false); setOrdersKey((k) => k + 1)
    }
  }

  return (
    <div className="panel ticket" aria-label="Order ticket">
      <div className="panel-head">
        <b>{shortSymbol(symbol)}</b>
        <span className="muted">{exchange}{quote?.instrument ? ` · ${quote.instrument}` : ''}{quote?.expiry ? ` · expires ${quote.expiry}` : ''}</span>
        <span className="ticket-ltp">{fmtPrice(ltp)}</span>
        {quote?.change !== null && quote?.change !== undefined && <span className={sign(quote.change)}>{fmtPrice(quote.change)} ({fmtPct(quote.change_pct)})</span>}
        <span className="badge preview" title="Check margin only calculates; an order is sent only with 'Place live order' and a confirmation.">MARGIN CHECK FIRST</span>
      </div>

      {sectorQuote && (
        <div className="ratios">
          <span><small>Sector</small> {quote?.sector ?? '-'}</span>
          <span>
            <small>Sector index</small>{' '}
            <button className="link" title="Open the index chart" onClick={() => void ctl.selectSymbol(sectorQuote.symbol)}>{shortSymbol(sectorQuote.symbol)}</button>{' '}
            <b>{fmtPrice(sectorLive ?? sectorQuote.ltp)}</b>{' '}
            <span className={sign(sectorQuote.change)}>({fmtPct(sectorQuote.change_pct)})</span>
          </span>
        </div>
      )}

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

      {quote?.is_index ? (
        <p className="empty">An index is for reference: it cannot be ordered. Trade its futures/options, or the stocks in it.</p>
      ) : (
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
            {products.map((p) => <option key={p.prd} value={p.prd}>{p.name}{p.listed ? '' : ' (not activated yet)'}</option>)}
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
      )}

      {error && <p className="ticket-error" role="alert">{error}</p>}

      <LiveOrders refreshKey={ordersKey} />

      {preview && (
        <div className="ticket-result" aria-label="Order preview">
          <div><small>{preview.side === 'BUY' ? 'Buy' : 'Sell'} {preview.quantity} {preview.quantity_unit === 'lots' ? `lot${preview.quantity === 1 ? '' : 's'} (${preview.units} units)` : 'shares'} · {preview.product_name} @ {fmtPrice(preview.price)}</small></div>
          <div><small>Contract value</small> <b>{rupees(preview.contract_value)}</b></div>
          <div><small>Margin required</small> <b>{rupees(preview.margin_required)}</b></div>
          <div><small>Available funds</small> <b>{rupees(preview.available)}</b></div>
          <div><small>{preview.shortfall > 0 ? 'Shortfall' : 'Left after order'}</small> <b className={preview.shortfall > 0 ? 'down' : 'up'}>{rupees(preview.shortfall > 0 ? preview.shortfall : preview.available - preview.margin_required)}</b></div>
          {preview.broker_remarks && <div className="muted">Broker check: {preview.broker_remarks === 'Order Success' ? 'margin check passed (no order was placed)' : preview.broker_remarks}</div>}
          <div className="ticket-send">
            <button className="primary live" disabled={sending || preview.shortfall > 0} title={preview.shortfall > 0 ? 'Not enough funds for this order' : 'Send this order to the exchange'} onClick={() => void send()}>
              {sending ? 'Sending…' : `Place live ${preview.side === 'BUY' ? 'buy' : 'sell'} order`}
            </button>
          </div>
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
