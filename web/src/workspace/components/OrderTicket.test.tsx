import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OrderTicket } from './OrderTicket'
import { makeApp, renderIn } from './testharness'

describe('OrderTicket', () => {
  it('shows the contract price, depth and lot details for the chart symbol', async () => {
    renderIn(<OrderTicket />, makeApp({}, { symbol: 'MCX:SILVERM30NOV26' }))
    expect(await screen.findByText(/30-NOV-2026/)).toBeInTheDocument()
    expect(screen.getByText(/per point per lot/)).toBeInTheDocument()
    expect(screen.getByText('PREVIEW ONLY')).toBeInTheDocument()
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
})
