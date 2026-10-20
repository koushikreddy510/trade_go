import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeApp, renderIn } from './testharness'
import { TopBar } from './TopBar'

const server = (mode: string) => ({ mode, feed: 'connected', now: 0, subscribed: [], clients: 0 })

describe('TopBar', () => {
  it('switches between the chart, screener and results', async () => {
    const app = makeApp()
    renderIn(<TopBar />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Screener' }))
    expect(app.store.get().view).toBe('screener')
    await userEvent.click(screen.getByRole('button', { name: 'Results' }))
    expect(app.store.get().view).toBe('results')
    await userEvent.click(screen.getByRole('button', { name: 'Chart' }))
    expect(app.store.get().view).toBe('chart')
  })

  it('warns loudly when prices are synthetic demo data', () => {
    renderIn(<TopBar />, makeApp({}, { server: server('demo') }))
    expect(screen.getByText('DEMO DATA')).toBeInTheDocument()
  })

  it('shows no demo warning with the real broker feed', () => {
    renderIn(<TopBar />, makeApp({}, { server: server('flattrade') }))
    expect(screen.queryByText('DEMO DATA')).not.toBeInTheDocument()
  })

  it('reports live only when the socket is open and the broker feed is connected', () => {
    renderIn(<TopBar />, makeApp({}, { connection: 'open', feed: 'connected' }))
    expect(screen.getByRole('status')).toHaveTextContent('Live')
    expect(screen.getByRole('status')).toHaveClass('ok')
  })

  it('says when the broker feed is down even though the server is reachable', () => {
    renderIn(<TopBar />, makeApp({}, { connection: 'open', feed: 'reconnecting' }))
    expect(screen.getByRole('status')).toHaveTextContent('Feed reconnecting')
    expect(screen.getByRole('status')).toHaveClass('down')
  })

  it('says when the server itself is unreachable', () => {
    renderIn(<TopBar />, makeApp({}, { connection: 'closed' }))
    expect(screen.getByRole('status')).toHaveTextContent('Server closed')
  })

  it('links to the original Atlas terminal', () => {
    renderIn(<TopBar />, makeApp())
    expect(screen.getByRole('link', { name: /Atlas/ })).toHaveAttribute('href', '?view=atlas')
  })
})
