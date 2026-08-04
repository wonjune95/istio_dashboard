import { useState } from 'react'
import { useCapabilities } from '../api/capabilities'
import { ApiError, apiPost } from '../api/client'
import { useToast } from '../components/Toast'

// ArgoCD의 User Info처럼 내 계정 정보 + 비밀번호 변경.
export function Settings() {
  const caps = useCapabilities()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const mismatch = confirm !== '' && next !== confirm
  const canSubmit = current !== '' && next.length >= 8 && next === confirm && !busy

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    try {
      await apiPost('/api/account/password', { currentPassword: current, newPassword: next })
      toast('success', '비밀번호가 변경되었습니다. (반영까지 최대 1분, 현재 세션은 유지됩니다)')
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h2 className="text-xl font-semibold text-strong">설정</h2>

      <div className="panel rounded-xl p-5">
        <h3 className="mb-3 text-sm font-semibold text-strong">내 계정</h3>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-muted">아이디</dt><dd className="text-strong">{caps.data?.user ?? '—'}</dd>
          <dt className="text-muted">역할</dt><dd className="text-strong">{caps.data?.role ?? '—'}</dd>
        </dl>
      </div>

      <form onSubmit={submit} className="panel space-y-3 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-strong">비밀번호 변경</h3>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">현재 비밀번호</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" className="input-base w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">새 비밀번호 (8자 이상)</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" className="input-base w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">새 비밀번호 확인</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className="input-base w-full" />
        </label>
        {mismatch && <p className="text-sm text-red-600 dark:text-red-400">새 비밀번호가 일치하지 않습니다.</p>}
        <button type="submit" disabled={!canSubmit} className="btn-primary disabled:opacity-50">
          {busy ? '변경 중…' : '비밀번호 변경'}
        </button>
      </form>

      <p className="text-xs text-muted">
        계정 추가/삭제·역할 변경은 관리자가 <code className="rounded bg-gray-100 px-1 dark:bg-slate-800">istio-dashboard-accounts</code> ConfigMap으로 관리합니다.
      </p>
    </div>
  )
}
