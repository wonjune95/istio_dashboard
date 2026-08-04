import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useCapabilities } from '../api/capabilities'
import { apiPost } from '../api/client'
import { useTheme } from '../ui/theme'
import { Icon } from './icons'
import { Sidebar } from './Sidebar'

export function Layout({ children }: { children: ReactNode }) {
  const { data } = useCapabilities()
  const { theme, toggle } = useTheme()

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 items-center gap-3 border-b border-base bg-white/80 px-4 backdrop-blur-md dark:bg-slate-950/80">
        <Link to="/" className="flex items-center gap-2.5 rounded-md py-0.5 hover:opacity-80" title="홈으로">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">☸</span>
          <h1 className="text-base font-semibold tracking-tight text-strong">Istio Dashboard</h1>
        </Link>

        {/* no global namespace selector — Overview/ResourceList carry their own
            (they share the same persisted state, so the header one was redundant) */}
        <div className="ml-auto flex items-center gap-2 text-xs">
          {data?.devMode ? (
            <span className="chip bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">dev mode</span>
          ) : (
            <>
              {data?.user && (
                <Link to="/settings" title="설정" className="chip bg-gray-100 text-gray-600 hover:opacity-80 dark:bg-slate-800 dark:text-slate-300">
                  {data.user}{data.role ? ` · ${data.role}` : ''}
                </Link>
              )}
              <button
                onClick={() => { void apiPost('/api/logout', {}).finally(() => window.location.reload()) }}
                title="로그아웃"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-base text-muted hover:text-strong"
              >
                <Icon name="logout" className="h-4 w-4" />
              </button>
            </>
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
