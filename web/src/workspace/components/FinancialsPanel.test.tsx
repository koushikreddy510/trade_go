// The "financial data at the bottom of the screen" panel.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FinancialsPanel } from './FinancialsPanel'
import { financials, makeApp, renderIn, row } from './testharness'

describe('FinancialsPanel', () => {
  it('says so when there is nothing for the symbol (indices, unscraped companies)', () => {
    renderIn(<FinancialsPanel />, makeApp({}, { financials: financials({ available: false }) }))
    expect(screen.getByText(/No financial data for this symbol/)).toBeInTheDocument()
  })

  it('shows loading before the first response', () => {
    renderIn(<FinancialsPanel />, makeApp({}, { financials: null, financialsLoading: true }))
    expect(screen.getByText('Loading financials…')).toBeInTheDocument()
  })

  it('shows quarters as columns with the main line items as rows', () => {
    renderIn(<FinancialsPanel />, makeApp({}, { financials: financials() }))
    expect(screen.getByText('State Bank of India')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Jun 2026' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Sep 2026' })).toBeInTheDocument()
    const sales = screen.getByRole('rowheader', { name: 'Sales' }).closest('tr')!
    expect(within(sales).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1,000', '1,200'])
  })

  it('colours growth green or red', () => {
    renderIn(<FinancialsPanel />, makeApp({}, { financials: financials() }))
    const salesGrowth = screen.getByRole('rowheader', { name: 'Sales growth' }).closest('tr')!
    expect(within(salesGrowth).getAllByRole('cell')[0]).toHaveClass('up')
    const profitGrowth = screen.getByRole('rowheader', { name: 'Profit growth' }).closest('tr')!
    expect(within(profitGrowth).getAllByRole('cell')[0]).toHaveClass('down')
  })

  it('switches to annual figures', async () => {
    renderIn(<FinancialsPanel />, makeApp({}, { financials: financials() }))
    await userEvent.click(screen.getByRole('button', { name: 'Annual' }))
    expect(screen.getByRole('columnheader', { name: 'Mar 2026' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Jun 2026' })).not.toBeInTheDocument()
  })

  it('shows key ratios that exist and skips the ones that do not', () => {
    renderIn(<FinancialsPanel />, makeApp({}, { financials: financials() }))
    expect(screen.getByText('P/E')).toBeInTheDocument()
    expect(screen.getByText('9.50')).toBeInTheDocument()
    expect(screen.getByText('ROE %')).toBeInTheDocument()
    expect(screen.queryByText('P/B')).not.toBeInTheDocument() // null in the data
  })

  it('shows the announced results date', () => {
    renderIn(<FinancialsPanel />, makeApp({}, { financials: financials() }))
    expect(screen.getByText(/Sep 2026 results 2026-11-05/)).toBeInTheDocument()
  })

  it('keeps only the latest eight periods so the table fits', () => {
    const many = Array.from({ length: 12 }, (_, i) => row(`Q${i + 1}`))
    renderIn(<FinancialsPanel />, makeApp({}, { financials: financials({ quarterly: many }) }))
    expect(screen.queryByRole('columnheader', { name: 'Q4' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Q5' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Q12' })).toBeInTheDocument()
  })

  it('handles missing figures in a column', () => {
    const f = financials({ quarterly: [row('Jun 2026', { revenue: null, eps: null })] })
    renderIn(<FinancialsPanel />, makeApp({}, { financials: f }))
    const sales = screen.getByRole('rowheader', { name: 'Sales' }).closest('tr')!
    expect(within(sales).getByRole('cell')).toHaveTextContent('—')
  })
})
