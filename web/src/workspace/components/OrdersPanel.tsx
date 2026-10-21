import { useState } from 'react'
import { LiveOrders } from './LiveOrders'

/** Every live order this app sent (ticket and rules), with the live switch, kill switch, cancel and move-stop. */
export function OrdersPanel() {
  const [days, setDays] = useState(1)
  return (
    <div className="panel" aria-label="Orders">
      <div className="panel-head">
        <b>Live orders sent from this app</b>
        <span className="seg">
          {[1, 7, 30].map((d) => <button key={d} className={days === d ? 'chip active' : 'chip'} onClick={() => setDays(d)}>{d === 1 ? 'Today' : `${d} days`}</button>)}
        </span>
        <small className="muted">Orders placed directly at the broker are not listed.</small>
      </div>
      <LiveOrders days={days} />
    </div>
  )
}
