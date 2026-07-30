import type { ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useCapabilities } from './api/capabilities'
import { ApiError } from './api/client'
import { Layout } from './components/Layout'
import { Guard } from './pages/Guard'
import { TokenGate } from './pages/TokenGate'
import { Home } from './pages/Home'
import { Overview } from './pages/Overview'
import { ResourceList } from './pages/ResourceList'
import { ResourceEdit } from './pages/ResourceEdit'

export function App() {
  const { data, isLoading, isError, error } = useCapabilities()
  const location = useLocation()

  if (isLoading) return <Centered>로딩 중…</Centered>
  // 401 → the cluster wants a bearer token (none set, or it expired).
  if (isError && error instanceof ApiError && error.status === 401) return <TokenGate />
  if (isError) return <Centered>백엔드 연결 실패: {(error as Error).message}</Centered>

  // No routing CRDs at all → install-guide screen.
  const noCRDs = data && !data.httpRouteInstalled && !data.virtualServiceInstalled
  if (noCRDs && location.pathname !== '/guard') return <Navigate to="/guard" replace />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/overview" element={<Overview />} />
        <Route path="/resources/:type" element={<ResourceList />} />
        <Route path="/resources/:type/new" element={<ResourceEdit />} />
        <Route path="/resources/:type/:ns/:name" element={<ResourceEdit />} />
        <Route path="/guard" element={<Guard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-muted">{children}</div>
}
