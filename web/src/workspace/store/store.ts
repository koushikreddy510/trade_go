import { useSyncExternalStore } from 'react'

/** A very small observable store: enough for this app, no dependency. */
export type Store<T> = {
  get(): T
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void
  subscribe(listener: () => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch
      const keys = Object.keys(next) as (keyof T)[]
      if (keys.every((k) => Object.is(state[k], next[k]))) return // nothing changed: no re-render
      state = { ...state, ...next }
      listeners.forEach((l) => l())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Read a slice of the store. `select` must return a value that is stable between
 *  unrelated updates (a field of the state, not a freshly built object). */
export function useStore<T extends object, S>(store: Store<T>, select: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()))
}
