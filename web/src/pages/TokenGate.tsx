import { useState } from 'react'
import { setToken } from '../auth/token'

// Shown when the backend answers 401: the cluster requires a bearer token and
// none (or an invalid one) is set. Saves to sessionStorage and reloads so every
// query restarts authenticated.
export function TokenGate() {
  const [value, setValue] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    setToken(value)
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-slate-950">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-base bg-white p-8 shadow-sm dark:bg-slate-900">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">☸</span>
          <h1 className="text-lg font-semibold text-strong">Istio Dashboard</h1>
        </div>
        <p className="mb-4 text-sm text-muted">
          Kubernetes Bearer 토큰으로 인증합니다. 모든 조회·변경은 이 토큰의 권한(RBAC)으로
          수행되며, 토큰은 브라우저 세션에만 보관됩니다.
        </p>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="eyJhbGciOi…"
          rows={4}
          autoFocus
          className="input-base mb-3 w-full resize-none font-mono text-xs"
        />
        <button type="submit" disabled={!value.trim()} className="btn-primary w-full disabled:opacity-50">
          접속
        </button>
        <p className="mt-4 text-xs text-muted">
          토큰 발급 예: <code className="rounded bg-gray-100 px-1 dark:bg-slate-800">kubectl create token &lt;serviceaccount&gt; -n &lt;ns&gt;</code>
        </p>
      </form>
    </div>
  )
}
