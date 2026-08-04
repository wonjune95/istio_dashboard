import { useState } from 'react'
import { ApiError, apiPost } from '../api/client'

// ArgoCD 방식 로컬 계정 로그인. 계정은 istio-dashboard-accounts ConfigMap에서
// 관리한다 (한 키 = 한 사용자, 값 = "role:bcryptHash"). 세션은 HttpOnly 쿠키.
export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true)
    setError('')
    try {
      await apiPost('/api/login', { username: username.trim(), password })
      window.location.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-slate-950">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-base bg-white p-8 shadow-sm dark:bg-slate-900">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">☸</span>
          <h1 className="text-lg font-semibold text-strong">Istio Dashboard</h1>
        </div>
        <p className="mb-4 text-sm text-muted">계정으로 로그인하세요.</p>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-muted">아이디</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" className="input-base w-full" />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-muted">비밀번호</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="input-base w-full" />
        </label>
        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={busy || !username.trim() || !password} className="btn-primary w-full disabled:opacity-50">
          {busy ? '로그인 중…' : '로그인'}
        </button>
        <p className="mt-4 text-xs text-muted">
          계정 추가/변경은 관리자가 <code className="rounded bg-gray-100 px-1 dark:bg-slate-800">istio-dashboard-accounts</code> ConfigMap으로 관리합니다.
        </p>
      </form>
    </div>
  )
}
