import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OrderTicket } from './OrderTicket'
import { makeApp, renderIn } from './testharness'

describe('OrderTicket', () => {
  it('shows the contract price, depth and lot details for the chart symbol', async () => {
    renderIn(<OrderTicket />, makeApp({}, { symbol: 'MCX:SILVERM30NOV26' }))
    expect(await screen.findByText(/30-NOV-2026/)).toBeInTheDocument()
    expect(screen.getByText(/per point per lot/)).toBeInTheDocument()
    expect(screen.getByText('MARGIN CHECK FIRST')).toBeInTheDocument()
  })

  it('asks the broker what the order would cost and shows the shortfall', async () => {
    const app = makeApp({}, { symbol: 'MCX:SILVERM30NOV26' })
    renderIn(<OrderTicket />, app)
    await screen.findByText(/30-NOV-2026/)
    fireEvent.click(screen.getByText('Sell'))
    fireEvent.change(screen.getByLabelText('Order quantity'), { target: { value: '2' } })
    fireEvent.click(screen.getByText('Check margin'))
    expect(await screen.findByText('Shortfall')).toBeInTheDocument()
    expect(app.api.orderPreview).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'MCX:SILVERM30NOV26', side: 'SELL', quantity: 2, product: 'M' }))
    expect(screen.getByText('₹60,519.60')).toBeInTheDocument()
  })

  it('shows a stock with its sector index, which opens that index on the chart', async () => {
    const app = makeApp({}, { symbol: 'NSE:INFY-EQ' })
    renderIn(<OrderTicket />, app)
    const link = await screen.findByText('NIFTYIT')
    expect(screen.getByText('Computers - Software & Consulting')).toBeInTheDocument()
    fireEvent.click(link)
    expect(app.store.get().symbol).toBe('NSE:NIFTYIT-INDEX')
  })

  it('quotes an index but offers no order for it', async () => {
    renderIn(<OrderTicket />, makeApp({}, { symbol: 'NSE:NIFTY50-INDEX' }))
    expect(await screen.findByText(/cannot be ordered/)).toBeInTheDocument()
    expect(screen.queryByText('Check margin')).not.toBeInTheDocument()
  })

  it('offers stocks only MTF or Intraday, starting on Intraday while MTF is not activated', async () => {
    renderIn(<OrderTicket />, makeApp({}, { symbol: 'NSE:SBIN-EQ' }))
    const select = (await screen.findByLabelText('Order product')) as HTMLSelectElement
    await screen.findByText('MTF (not activated yet)')
    expect([...select.options].map((o) => o.textContent)).toEqual(['MTF (not activated yet)', 'Intraday'])
    expect(select.value).toBe('I')
  })

  it('sends a live order only after the margin check and a confirmation, then lists it', async () => {
    const app = makeApp({}, { symbol: 'NSE:SBIN-EQ' })
    app.api.orderPreview.mockResolvedValue({
      symbol: 'NSE:SBIN-EQ', side: 'BUY', product: 'I', product_name: 'Intraday', price_type: 'LMT', price: 967.6, quantity: 1, units: 1,
      quantity_unit: 'shares', lot_size: 1, contract_value: 967.6, margin_required: 212.9, available: 15000, shortfall: 0,
      broker_remarks: 'Order Success', existing_position: null, quote: null, preview_only: true,
    })
    renderIn(<OrderTicket />, app)
    expect(await screen.findByText('LIVE ORDERS OFF')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('Check margin'))
    const place = await screen.findByText('Place live buy order')
    window.confirm = () => false
    fireEvent.click(place)
    expect(app.api.placeOrder).not.toHaveBeenCalled()
    window.confirm = () => true
    fireEvent.click(place)
    expect(await screen.findByText('Cancel')).toBeInTheDocument()          // the new open order is listed with a cancel
    expect(app.api.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ account: 'flattrade', symbol: 'NSE:SBIN-EQ', side: 'BUY', product: 'I' }))
  })
})
