import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

afterEach(() => vi.restoreAllMocks())

describe('ErrorBoundary', () => {
  it('shows the rest of the screen untouched when nothing fails', () => {
    render(<ErrorBoundary label="chart"><p>fine</p></ErrorBoundary>)
    expect(screen.getByText('fine')).toBeInTheDocument()
  })

  it('replaces only the broken part with a message, and can try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let broken = true
    const Bomb = () => { if (broken) throw new Error('canvas exploded'); return <p>recovered</p> }
    render(<><p>sidebar</p><ErrorBoundary label="chart"><Bomb /></ErrorBoundary></>)
    expect(screen.getByText('sidebar')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The chart hit a problem.')
    expect(screen.getByRole('alert')).toHaveTextContent('canvas exploded')
    broken = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('recovered')).toBeInTheDocument()
  })
})
