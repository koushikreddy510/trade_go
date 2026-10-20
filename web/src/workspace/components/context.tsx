import { createContext, useContext } from 'react'
import type { ApiClient } from '../api/client'
import type { Controller } from '../store/controller'
import { useStore, type Store } from '../store/store'
import type { AppState } from '../store/state'

export type AppContextValue = { store: Store<AppState>; ctl: Controller; api: ApiClient }
export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const v = useContext(AppContext)
  if (!v) throw new Error('useApp must be used inside <AppContext.Provider>')
  return v
}

/** Subscribe to one slice of the state. */
export function useSel<S>(select: (s: AppState) => S): S {
  return useStore(useApp().store, select)
}
