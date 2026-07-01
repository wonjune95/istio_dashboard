import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useCapabilities } from '../api/capabilities'
import { useNamespaces } from '../api/namespaces'
import { useNamespace } from '../ui/namespace'
import { useTheme } from '../ui/theme'
import { Icon } from './icons'
import { Sidebar } from './Sidebar'

export function Layout({ children }: { children: ReactNode }) {
  const { data } = useCapabilities()
  const namespaces = useNamespaces()
  const { ns, setNs } = useNamespace()
  const { theme, toggle } = useTheme()

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 items-center gap-3 border-b border-base bg-white/80 px-4 backdrop-blur-md dark:bg-slate-950/80">
        <Link to="/" className="flex items-center gap-2.5 rounded-md py-0.5 hover:opacity-80" title="홈으로">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">☸</span>
          <h1 className="text-base font-semibold tracking-tight text-strong">Istio Dashboard</h1>
        </Link>

        {/* center: global namespace selector */}
        <div className="mx-auto flex items-center gap-2">
          <span className="text-xs text-muted">Namespace</span>
          <select
            value={ns}
            onChange={(e) => setNs(e.target.value)}
            className="input-base w-44 py-1"
            title="전역 네임스페이스 — 목록·개수에 적용"
          >
            <option value="">전체 네임스페이스</option>
            {(namespaces.data ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {data?.devMode ? (
            <span className="chip bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">dev mode</span>
          ) : (
            data?.user && <span className="chip bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300">{data.user}</span>
          )}
          <button
            onClick={toggle}
            title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-base text-muted hover:text-strong"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
