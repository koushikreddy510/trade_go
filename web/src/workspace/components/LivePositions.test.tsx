import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LivePositions } from './LivePositions'
import { makeApp, renderIn } from './testharness'

const POS = { account: 'flattrade', symbol: 'NSE:ABCAPITAL-EQ', product: 'I', side: 'BUY', units: 2, quantity: 2, avg_price: 365, ltp: 366,
  unrealized: 2, realized: 0, stops: [{ id: 's1', trigger_price: 361.35, quantity: 1 }, { id: 's2', trigger_price: 357.7, quantity: 1 }] }

describe('LivePositions', () => {
  it('lists what this app holds with its stops and closes it (stops first) after confirmation', async () => {
    const app = makeApp()
    app.api.livePositions.mockResolvedValue([POS])
    window.confirm = () => true
    renderIn(<LivePositions />, app)
    expect(await screen.findByText('ABCAPITAL')).toBeInTheDocument()
    expect(screen.getByText('1 @ 361.35, 1 @ 357.70')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Close'))
    await new Promise((r) => setTimeout(r, 0))
    expect(app.api.cancelOrder.mock.calls.map((c: unknown[]) => c[0])).toEqual(['s1', 's2'])
    expect(app.api.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'NSE:ABCAPITAL-EQ', side: 'SELL', quantity: 2, product: 'I', price_type: 'MKT' }))
  })

  it('shows nothing when this app holds nothing', async () => {
    const { container } = renderIn(<LivePositions />, makeApp())
    await new Promise((r) => setTimeout(r, 0))
    expect(container.textContent).toBe('')
  })
})
