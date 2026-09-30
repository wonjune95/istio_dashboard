import { useEffect, useState, type ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useCapabilities } from './api/capabilities'
import { ApiError, apiPost, getCluster, setCluster } from './api/client'
import { useClusters } from './api/clusters'
import { Layout } from './components/Layout'
import { Guard } from './pages/Guard'
import { Login } from './pages/Login'
import { Home } from './pages/Home'
import { Overview } from './pages/Overview'
import { FlowMap } from './pages/FlowMap'
import { RouteCheck } from './pages/RouteCheck'
import { ResourceList } from './pages/ResourceList'
import { ResourceEdit } from './pages/ResourceEdit'
import { Settings } from './pages/Settings'
import { Icon } from './components/icons'

export function App() {
  // Resolve a persisted selection before sending requests to a remote cluster.
  // Layout is mounted only after capabilities succeed, so recovery must live here.
  const clusters = useClusters()
  const selectedCluster = getCluster()
  const remoteSelected = !!selectedCluster && selectedCluster !== 'local'
  const missingCluster =
    remoteSelected && !!clusters.data && !clusters.data.some((c) => c.name === selectedCluster)
  const { data, isLoading, isError, error } = useCapabilities(
    !remoteSelected || (!!clusters.data && !missingCluster),
  )
  const location = useLocation()

  useEffect(() => {
    // Return to the overview so a remote editor cannot reopen a local resource.
    if (missingCluster) setCluster('', '/')
  }, [missingCluster])

  // 401 → no session (or it expired) — show the local-account login.
  if (
    (isError && error instanceof ApiError && error.status === 401) ||
    (remoteSelected && clusters.error instanceof ApiError && clusters.error.status === 401)
  )
    return <Login />
  if (missingCluster || (remoteSelected && clusters.isPending))
    return <Centered>클러스터 선택을 확인하는 중…</Centered>
  if (remoteSelected && clusters.isError) {
    return <ConnectionError message={`클러스터 목록을 불러오지 못했습니다: ${clusters.error.message}`} />
  }
  if (isLoading) return <Centered>로딩 중…</Centered>
  if (isError) return <ConnectionError message={error.message} />

  // 초기 비밀번호(admin/admin) 그대로면 변경 전까지 어디에도 못 들어간다.
  if (data?.mustChangePassword) return <ForcePasswordChange />

  // No routing CRDs at all → install-guide screen.
  const noCRDs = data && !data.httpRouteInstalled && !data.virtualServiceInstalled
  if (noCRDs && location.pathname !== '/guard') return <Navigate to="/guard" replace />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/overview" element={<Overview />} />
        <Route path="/flowmap" element={<FlowMap />} />
        <Route path="/routecheck" element={<RouteCheck />} />
        <Route path="/resources/:type" element={<ResourceList key={location.pathname} />} />
        <Route path="/resources/:type/new" element={<ResourceEdit key={location.pathname} />} />
        <Route path="/resources/:type/:ns/:name" element={<ResourceEdit key={location.pathname} />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/guard" element={<Guard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

function ConnectionError({ message }: { message: string }) {
  const remoteSelected = !!getCluster() && getCluster() !== 'local'
  return (
    <Centered>
      <span className="block text-base font-semibold text-strong">클러스터에 연결하지 못했습니다</span>
      <span className="mt-2 block">{message}</span>
      <span className="mt-5 flex flex-wrap justify-center gap-2">
        <button className="btn-ghost" onClick={() => window.location.reload()}>
          다시 시도
        </button>
        {remoteSelected && (
          <button className="btn-primary" onClick={() => setCluster('', '/')}>
            local 클러스터로 돌아가기
          </button>
        )}
      </span>
    </Centered>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center text-sm text-muted">
      <img src="/favicon.svg" alt="" className="h-11 w-11" />
      <div role="status">{children}</div>
    </div>
  )
}

// 초기 비밀번호 강제 변경 화면 — 성공하면 전체 리로드로 capabilities를 다시 받는다.
function ForcePasswordChange() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = current !== '' && next.length >= 8 && next === confirm && !busy

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError('')
    try {
      await apiPost('/api/account/password', { currentPassword: current, newPassword: next })
      window.location.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-slate-950">
      <form onSubmit={submit} className="panel w-full max-w-sm space-y-4 rounded-2xl p-8">
        <img src="/favicon.svg" alt="" className="mb-4 h-10 w-10" />
        <h1 className="text-xl font-semibold text-strong">계정을 안전하게 설정하세요</h1>
        <p className="text-sm text-muted">
          초기 비밀번호(<code>admin</code>)를 그대로 쓰고 있습니다. 계속하려면 먼저 비밀번호를 변경해야
          합니다.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">현재 비밀번호</span>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className="input-base w-full"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">새 비밀번호 (8자 이상)</span>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            className="input-base w-full"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">새 비밀번호 확인</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className="input-base w-full"
          />
        </label>
        {confirm !== '' && next !== confirm && (
          <p className="text-sm text-red-600 dark:text-red-400">새 비밀번호가 일치하지 않습니다.</p>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={!canSubmit} className="btn-primary w-full disabled:opacity-50">
          {busy ? '변경 중…' : '비밀번호 변경'}
          <Icon name="arrow" className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
