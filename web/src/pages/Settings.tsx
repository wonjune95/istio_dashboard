import { useCallback, useEffect, useState } from 'react'
import { useCapabilities } from '../api/capabilities'
import { useClusters } from '../api/clusters'
import { ApiError, apiDelete, apiGet, apiPost, apiPut, getCluster, setCluster } from '../api/client'
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

      {caps.data?.role === 'admin' ? (
        <>
          <AccountsPanel me={caps.data.user ?? ''} />
          <ClustersPanel />
        </>
      ) : (
        <p className="text-xs text-muted">
          계정 추가/삭제·역할 변경은 관리자가 설정 페이지 또는{' '}
          <code className="rounded bg-gray-100 px-1 dark:bg-slate-800">istio-dashboard-accounts</code> ConfigMap으로 관리합니다.
        </p>
      )}
    </div>
  )
}

// admin 전용 멀티클러스터 관리: kubeconfig 붙여넣기로 등록 (백엔드가 Secret에 저장).
function ClustersPanel() {
  const toast = useToast()
  const clusters = useClusters()
  const [name, setName] = useState('')
  const [kubeconfig, setKubeconfig] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !kubeconfig || busy) return
    setBusy(true)
    try {
      const res = await apiPut<{ connected: boolean; version?: string; error?: string }>(
        `/api/clusters/${encodeURIComponent(name)}`, { kubeconfig })
      if (res.connected) {
        toast('success', `${name} 클러스터를 등록했습니다 (${res.version})`)
      } else {
        toast('error', `저장은 됐지만 연결에 실패했습니다: ${res.error}`)
      }
      setName(''); setKubeconfig('')
      void clusters.refetch()
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (target: string) => {
    if (!window.confirm(`${target} 클러스터를 삭제할까요?`)) return
    try {
      await apiDelete(`/api/clusters/${encodeURIComponent(target)}`)
      if (getCluster() === target) { setCluster(''); return } // 현재 클러스터 삭제 → local로 리로드
      toast('success', `${target} 클러스터를 삭제했습니다.`)
      void clusters.refetch()
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : String(err))
    }
  }

  return (
    <div className="panel space-y-3 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-strong">클러스터 관리</h3>
      <p className="text-xs text-muted">
        kubeconfig를 붙여넣으면 원격 클러스터가 등록됩니다 (ArgoCD처럼 자격증명은 로컬 클러스터 Secret에 저장).
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-muted dark:border-slate-700">
            <th className="py-1.5 font-medium">이름</th>
            <th className="py-1.5" />
          </tr>
        </thead>
        <tbody>
          {(clusters.data ?? [{ name: 'local' }]).map((c) => (
            <tr key={c.name} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
              <td className="py-1.5 text-strong">
                {c.name}{c.name === 'local' && <span className="ml-1 text-xs text-muted">(이 클러스터)</span>}
              </td>
              <td className="py-1.5 text-right">
                <button
                  onClick={() => remove(c.name)}
                  disabled={c.name === 'local'}
                  className="text-xs text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={submit} className="space-y-2 border-t border-gray-200 pt-3 dark:border-slate-700">
        <p className="text-xs font-medium text-muted">클러스터 추가 / 변경</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="이름 (예: app-cluster)"
          autoComplete="off"
          className="input-base w-full"
        />
        <textarea
          value={kubeconfig}
          onChange={(e) => setKubeconfig(e.target.value)}
          placeholder="kubeconfig 내용 붙여넣기"
          rows={6}
          spellCheck={false}
          className="input-base w-full font-mono text-xs"
        />
        <button type="submit" disabled={!name || !kubeconfig || busy} className="btn-primary disabled:opacity-50">
          {busy ? '연결 확인 중…' : '클러스터 등록'}
        </button>
      </form>
    </div>
  )
}

type Account = { name: string; role: string }

// admin 전용 계정 관리: 목록/추가/역할·비밀번호 변경/삭제 (백엔드가 CM을 patch).
function AccountsPanel({ me }: { me: string }) {
  const toast = useToast()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState('viewer')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    apiGet<Account[]>('/api/accounts').then(setAccounts).catch((err) => {
      toast('error', err instanceof ApiError ? err.message : String(err))
    })
  }, [toast])
  useEffect(reload, [reload])

  const exists = accounts?.some((a) => a.name === name) ?? false
  const canSubmit = name !== '' && (password !== '' || exists) && !busy

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    try {
      await apiPut(`/api/accounts/${encodeURIComponent(name)}`, { role, password })
      toast('success', `${name} 계정을 ${exists ? '변경' : '추가'}했습니다. (로그인 반영까지 최대 1분)`)
      setName(''); setPassword(''); setRole('viewer')
      reload()
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (target: string) => {
    if (!window.confirm(`${target} 계정을 삭제할까요?`)) return
    try {
      await apiDelete(`/api/accounts/${encodeURIComponent(target)}`)
      toast('success', `${target} 계정을 삭제했습니다.`)
      reload()
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : String(err))
    }
  }

  return (
    <div className="panel space-y-3 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-strong">계정 관리</h3>
      {accounts === null ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-muted dark:border-slate-700">
              <th className="py-1.5 font-medium">아이디</th>
              <th className="py-1.5 font-medium">역할</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.name} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                <td className="py-1.5 text-strong">{a.name}{a.name === me && <span className="ml-1 text-xs text-muted">(나)</span>}</td>
                <td className="py-1.5">{a.role}</td>
                <td className="py-1.5 text-right">
                  <button
                    onClick={() => remove(a.name)}
                    disabled={a.name === me}
                    className="text-xs text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={submit} className="space-y-2 border-t border-gray-200 pt-3 dark:border-slate-700">
        <p className="text-xs font-medium text-muted">계정 추가 / 변경</p>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="아이디"
            autoComplete="off"
            className="input-base min-w-0 flex-1"
          />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="input-base !w-32 shrink-0">
            <option value="admin">admin</option>
            <option value="editor">editor</option>
            <option value="viewer">viewer</option>
          </select>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={exists ? '비밀번호 (비우면 유지, 역할만 변경)' : '비밀번호 (8자 이상)'}
          autoComplete="new-password"
          className="input-base w-full"
        />
        <button type="submit" disabled={!canSubmit} className="btn-primary disabled:opacity-50">
          {busy ? '저장 중…' : exists ? '계정 변경' : '계정 추가'}
        </button>
      </form>
    </div>
  )
}
