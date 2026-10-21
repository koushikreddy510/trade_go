import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrokerLogins } from './BrokerLogins'
import { makeApp, renderIn } from './testharness'

describe('BrokerLogins', () => {
  it('shows each broker, an expired token, and logs in unattended on request', async () => {
    const app = makeApp()
    renderIn(<BrokerLogins />, app)
    expect(await screen.findByText('Token expired')).toBeInTheDocument()
    expect(screen.getByText('No API key on the server (PAYTM_API_KEY)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Log in now'))
    expect(await screen.findByText(/Flattrade: logged in/)).toBeInTheDocument()
    expect(app.api.brokerLogin).toHaveBeenCalledWith('flattrade', undefined)
  })

  it('takes the address the login page landed on as a manual fallback', async () => {
    const app = makeApp()
    renderIn(<BrokerLogins />, app)
    fireEvent.change(await screen.findByLabelText('Flattrade redirect URL'), { target: { value: 'http://127.0.0.1:5000/?code=abc' } })
    fireEvent.click(screen.getByText('Use it'))
    expect(await screen.findByText(/Flattrade: logged in/)).toBeInTheDocument()
    expect(app.api.brokerLogin).toHaveBeenCalledWith('flattrade', 'http://127.0.0.1:5000/?code=abc')
  })
})
