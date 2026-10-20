import type { ServerMessage } from './types'

export type SocketState = 'connecting' | 'open' | 'closed'

type WebSocketLike = {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
}
type WebSocketCtor = new (url: string) => WebSocketLike

export type LiveSocketOptions = {
  url: string
  onMessage: (m: ServerMessage) => void
  onState?: (s: SocketState) => void
  WebSocketImpl?: WebSocketCtor
  /** Reconnect delays in ms; the last one repeats. */
  backoff?: number[]
  pingMs?: number
}

const OPEN = 1

export function defaultSocketUrl(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/terminal/ws`
}

/** One websocket to the server that remembers what it is subscribed to and reconnects
 *  (re-subscribing) on its own, so the UI never has to think about dropped connections. */
export class LiveSocket {
  private ws: WebSocketLike | null = null
  private wanted = new Set<string>()
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private stopped = true
  state: SocketState = 'closed'

  constructor(private opts: LiveSocketOptions) {}

  private get Impl(): WebSocketCtor {
    return this.opts.WebSocketImpl ?? (WebSocket as unknown as WebSocketCtor)
  }

  /** Safe to call twice (React StrictMode boots effects twice in development): a second call changes nothing. */
  connect(): void {
    this.stopped = false
    if (this.ws) return
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.open()
  }

  private setState(s: SocketState) {
    this.state = s
    this.opts.onState?.(s)
  }

  private open() {
    this.setState('connecting')
    const ws = new this.Impl(this.opts.url)
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.setState('open')
      if (this.wanted.size) this.send({ type: 'subscribe', symbols: [...this.wanted] })
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), this.opts.pingMs ?? 25000)
    }
    ws.onmessage = (ev) => {
      try {
        this.opts.onMessage(JSON.parse(String(ev.data)) as ServerMessage)
      } catch {
        /* ignore a malformed frame */
      }
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.setState('closed')
      if (!this.stopped) this.scheduleReconnect()
    }
    ws.onerror = () => ws.close()
  }

  private scheduleReconnect() {
    const delays = this.opts.backoff ?? [1000, 2000, 5000, 10000]
    const delay = delays[Math.min(this.attempt, delays.length - 1)]
    this.attempt++
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private send(payload: object) {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(JSON.stringify(payload))
  }

  /** Make the server-side subscription equal to `symbols` (sends only the difference). */
  setSymbols(symbols: Iterable<string>): void {
    const next = new Set(symbols)
    const add = [...next].filter((s) => !this.wanted.has(s))
    const drop = [...this.wanted].filter((s) => !next.has(s))
    this.wanted = next
    if (add.length) this.send({ type: 'subscribe', symbols: add })
    if (drop.length) this.send({ type: 'unsubscribe', symbols: drop })
  }

  close(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.ws?.close()
    this.ws = null
    this.setState('closed')
  }
}
