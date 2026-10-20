// The websocket client: reconnects, and re-subscribes after every reconnect.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveSocket, defaultSocketUrl, type SocketState } from './socket'
import type { ServerMessage } from './types'

class FakeWS {
  static instances: FakeWS[] = []
  readyState = 0
  sent: object[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(public url: string) {
    FakeWS.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
    this.onclose?.({})
  }
  // test helpers
  accept() {
    this.readyState = 1
    this.onopen?.({})
  }
  receive(m: unknown) {
    this.onmessage?.({ data: typeof m === 'string' ? m : JSON.stringify(m) })
  }
  drop() {
    this.readyState = 3
    this.onclose?.({})
  }
}

const latest = () => FakeWS.instances[FakeWS.instances.length - 1]

function make(extra: Partial<ConstructorParameters<typeof LiveSocket>[0]> = {}) {
  const messages: ServerMessage[] = []
  const states: SocketState[] = []
  const socket = new LiveSocket({ url: 'ws://x/terminal/ws', onMessage: (m) => messages.push(m), onState: (s) => states.push(s), WebSocketImpl: FakeWS as never, backoff: [1000, 2000, 5000], pingMs: 10_000, ...extra })
  return { socket, messages, states }
}

beforeEach(() => {
  FakeWS.instances = []
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('LiveSocket', () => {
  it('derives the url from the page (ws on http, wss on https)', () => {
    expect(defaultSocketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/terminal/ws')
    expect(defaultSocketUrl({ protocol: 'https:', host: 'app.example.com' })).toBe('wss://app.example.com/terminal/ws')
  })

  it('subscribes when the connection opens and reports its state', () => {
    const { socket, states } = make()
    socket.setSymbols(['A', 'B']) // chosen before connecting
    socket.connect()
    expect(states).toEqual(['connecting'])
    expect(latest().sent).toEqual([]) // nothing can be sent until the socket is open
    latest().accept()
    expect(states).toEqual(['connecting', 'open'])
    expect(latest().sent).toEqual([{ type: 'subscribe', symbols: ['A', 'B'] }])
  })

  it('opens only one connection when connect() is called twice (StrictMode runs effects twice)', () => {
    const { socket } = make()
    socket.connect()
    socket.connect()
    expect(FakeWS.instances).toHaveLength(1)
  })

  it('can be connected again after close()', () => {
    const { socket } = make()
    socket.connect()
    socket.close()
    socket.connect()
    expect(FakeWS.instances).toHaveLength(2)
  })

  it('sends only what changed when the wanted set changes', () => {
    const { socket } = make()
    socket.connect()
    latest().accept()
    socket.setSymbols(['A', 'B'])
    socket.setSymbols(['B', 'C'])
    socket.setSymbols(['B', 'C']) // no change: nothing sent
    expect(latest().sent).toEqual([
      { type: 'subscribe', symbols: ['A', 'B'] },
      { type: 'subscribe', symbols: ['C'] },
      { type: 'unsubscribe', symbols: ['A'] },
    ])
  })

  it('delivers parsed server messages and ignores garbage', () => {
    const { socket, messages } = make()
    socket.connect()
    latest().accept()
    latest().receive({ type: 'tick', quote: { symbol: 'A', price: 1 } })
    latest().receive('not json {{')
    expect(messages).toEqual([{ type: 'tick', quote: { symbol: 'A', price: 1 } }])
  })

  it('reconnects with growing delays and re-subscribes to everything', () => {
    const { socket, states } = make()
    socket.connect()
    latest().accept()
    socket.setSymbols(['A', 'B'])

    latest().drop()
    expect(states.at(-1)).toBe('closed')
    vi.advanceTimersByTime(999)
    expect(FakeWS.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWS.instances).toHaveLength(2) // after 1s

    latest().drop() // fails again before opening: wait 2s this time
    vi.advanceTimersByTime(1999)
    expect(FakeWS.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeWS.instances).toHaveLength(3)

    latest().accept()
    expect(latest().sent).toEqual([{ type: 'subscribe', symbols: ['A', 'B'] }])
  })

  it('starts the backoff over after a successful connection', () => {
    const { socket } = make()
    socket.connect()
    latest().drop()
    vi.advanceTimersByTime(1000)
    latest().accept() // success resets the counter
    latest().drop()
    vi.advanceTimersByTime(1000)
    expect(FakeWS.instances).toHaveLength(3)
  })

  it('keeps the connection alive with pings', () => {
    const { socket } = make()
    socket.connect()
    latest().accept()
    vi.advanceTimersByTime(20_000)
    expect(latest().sent.filter((m) => (m as { type: string }).type === 'ping')).toHaveLength(2)
  })

  it('does not reconnect after an explicit close', () => {
    const { socket } = make()
    socket.connect()
    latest().accept()
    socket.close()
    vi.advanceTimersByTime(60_000)
    expect(FakeWS.instances).toHaveLength(1)
  })
})
