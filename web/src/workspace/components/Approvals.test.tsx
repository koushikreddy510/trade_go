import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Approvals } from './Approvals'
import { makeApp, renderIn } from './testharness'

const PENDING = {
  id: 'a1', position_id: 'p1', rule_id: 'r1', rule_name: 'GOLDPETAL sell below day low line', account: 'flattrade', product: 'I',
  symbol: 'MCX:GOLDPETAL30OCT26', side: 'SELL', quantity: 2, signal_price: 14530, stop: 14553.27, target: 14460, reason: 'close crossed below line',
  status: 'pending', note: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 240_000).toISOString(), decided_at: null,
}

describe('Approvals', () => {
  it('shows a live entry waiting for a person and sends it only after Approve and a confirmation', async () => {
    const app = makeApp()
    app.api.approvals.mockResolvedValue([PENDING])
    renderIn(<Approvals />, app)
    expect(await screen.findByText('Sell 2 GOLDPETAL30OCT26')).toBeInTheDocument()
    expect(screen.getByText(/stop 14,553.27/)).toBeInTheDocument()
    expect(screen.getByText(/expires in [34]:\d\d/)).toBeInTheDocument()
    window.confirm = () => false
    fireEvent.click(screen.getByText('Approve'))
    expect(app.api.decideApproval).not.toHaveBeenCalled()
    window.confirm = () => true
    fireEvent.click(screen.getByText('Approve'))
    await new Promise((r) => setTimeout(r, 0))
    expect(app.api.decideApproval).toHaveBeenCalledWith('a1', true)
  })

  it('rejects without asking', async () => {
    const app = makeApp()
    app.api.approvals.mockResolvedValue([PENDING])
    renderIn(<Approvals />, app)
    fireEvent.click(await screen.findByText('Reject'))
    await new Promise((r) => setTimeout(r, 0))
    expect(app.api.decideApproval).toHaveBeenCalledWith('a1', false)
  })
})
