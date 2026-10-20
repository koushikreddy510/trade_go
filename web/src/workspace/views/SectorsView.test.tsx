import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeApp, renderIn, sectorCompare } from '../components/testharness'
import { SectorsView } from './SectorsView'

const rowOf = (name: string) => screen.getByRole('button', { name }).closest('tr')!

describe('SectorsView', () => {
  it('opens the first group and compares its members with ranks and a median row', async () => {
    const app = makeApp()
    renderIn(<SectorsView />, app)
    await screen.findByText('HDFCBANK')
    expect(app.api.compareSector).toHaveBeenCalledWith({ group: 'Banking & Finance' })
    expect(screen.getByRole('button', { name: /Banking & Finance/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(rowOf('HDFCBANK')).getByText('#1')).toHaveClass('up') // biggest of 3
    expect(within(rowOf('SBIN')).getAllByTitle('Rank 3 of 3')[0]).toHaveClass('down')
    expect(within(rowOf('ICICIBANK')).getAllByTitle('Rank 2 of 3')[0].className).not.toMatch(/up|down/)
    expect(within(screen.getByText('Group median').closest('tr')!).getByText('17.0')).toBeInTheDocument() // P/E
  })

  it('shows a missing value as a dash and signed returns coloured', async () => {
    renderIn(<SectorsView />, makeApp())
    await screen.findByText('SBIN')
    expect(within(rowOf('SBIN')).getByText('—')).toBeInTheDocument() // no RSI
    expect(within(rowOf('SBIN')).getByText('-2.0%').closest('td')).toHaveClass('down')
  })

  it('narrows to one industry with its chip', async () => {
    const app = makeApp()
    renderIn(<SectorsView />, app)
    await screen.findByText('HDFCBANK')
    await userEvent.click(within(screen.getByRole('group', { name: 'Industry' })).getByRole('button', { name: /Private Sector Bank/ }))
    await waitFor(() => expect(app.api.compareSector).toHaveBeenLastCalledWith({ sector: 'Private Sector Bank' }))
  })

  it('switches group and loads its comparison', async () => {
    const app = makeApp()
    renderIn(<SectorsView />, app)
    await screen.findByText('HDFCBANK')
    await userEvent.click(screen.getByRole('button', { name: /IT & Technology/ }))
    await waitFor(() => expect(app.api.compareSector).toHaveBeenLastCalledWith({ group: 'IT & Technology' }))
  })

  it('sorts by a column, best first, and a second click restores the order', async () => {
    renderIn(<SectorsView />, makeApp())
    await screen.findByText('SBIN')
    const names = () => screen.getAllByRole('button').map((b) => b.textContent).filter((t) => /BANK|SBIN/.test(t ?? '') && !/Sector/.test(t ?? ''))
    expect(names()).toEqual(['HDFCBANK', 'ICICIBANK', 'SBIN'])
    await userEvent.click(screen.getByTitle('P/E')) // lower is better
    expect(names()).toEqual(['SBIN', 'ICICIBANK', 'HDFCBANK'])
    await userEvent.click(screen.getByTitle('P/E'))
    expect(names()).toEqual(['HDFCBANK', 'ICICIBANK', 'SBIN'])
  })

  it('makes a watchlist of every member and opens it', async () => {
    const app = makeApp()
    renderIn(<SectorsView />, app)
    await screen.findByText('HDFCBANK')
    await userEvent.click(screen.getByRole('button', { name: 'Make watchlist' }))
    await waitFor(() => expect(app.api.createWatchlist).toHaveBeenCalledWith('Banking & Finance', ['NSE:HDFCBANK-EQ', 'NSE:ICICIBANK-EQ', 'NSE:SBIN-EQ']))
    await waitFor(() => expect(app.store.get()).toMatchObject({ view: 'chart', activeWatchlistId: 'w2' }))
  })

  it('opens a company’s chart', async () => {
    const app = makeApp({}, { view: 'sectors' })
    renderIn(<SectorsView />, app)
    await userEvent.click(await screen.findByRole('button', { name: 'ICICIBANK' }))
    await waitFor(() => expect(app.store.get()).toMatchObject({ view: 'chart', symbol: 'NSE:ICICIBANK-EQ' }))
  })

  it('says so when a group is bigger than the table', async () => {
    renderIn(<SectorsView />, makeApp({ compareSector: async () => sectorCompare({ count: 120 }) }))
    expect(await screen.findByText(/120 companies, showing the 3 largest/)).toBeInTheDocument()
  })

  it('explains an empty sector list and shows errors', async () => {
    const { unmount } = renderIn(<SectorsView />, makeApp({ sectors: async () => [] }))
    expect(await screen.findByText(/No sector data yet/)).toBeInTheDocument()
    unmount()
    renderIn(<SectorsView />, makeApp({ compareSector: async () => { throw new Error('boom') } }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})
