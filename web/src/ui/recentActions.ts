import { useSyncExternalStore } from 'react'

// Session-only activity stream for the home page. Records mutations done THROUGH
// this dashboard in the current browser session — no backend, no DB (our
// architecture is stateless/no-store, so a real server-side audit stream would
// break that; this is the honest, drift-free substitute).
export interface Action {
  time: number
  verb: 'create' | 'update' | 'delete'
  kind: string
  ns: string
  name: string
  ok: boolean
}

let actions: Action[] = []
const listeners = new Set<() => void>()

export function recordAction(a: Omit<Action, 'time'>) {
  actions = [{ ...a, time: Date.now() }, ...actions].slice(0, 20)
  listeners.forEach((l) => l())
}

export function useRecentActions(): Action[] {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => actions,
  )
}
