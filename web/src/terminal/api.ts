import type { Drawing, Snapshot, Timeframe } from './types'

const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init)
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
export const chart = (timeframe: Timeframe) => request<Snapshot>(`/api/v1/chart?timeframe=${timeframe}`)
export const drawings = (timeframe: Timeframe) => request<Drawing[]>(`/api/v1/drawings?timeframe=${timeframe}`)
export const saveDrawing = (timeframe: Timeframe, drawing: Partial<Drawing>) => request<Drawing>(`/api/v1/drawings?timeframe=${timeframe}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(drawing) })
export const removeDrawing = (timeframe: Timeframe, id: string) => request<void>(`/api/v1/drawings?timeframe=${timeframe}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
