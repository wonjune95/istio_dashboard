import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import { useCapabilities } from '../api/capabilities'
import { useResourceTypes, CATEGORY_LABELS, type Category } from '../api/resourceTypes'
import { CATEGORY_ORDER, CATEGORY_ICON, accentFor } from '../ui/categories'
import { useRecentActions, type Action } from '../ui/recentActions'
import { Icon } from '../components/icons'
import type { ResourceSummary } from '../api/resources'

const QUICK = [
  { type: 'virtualservices.networking.istio.io', label: 'VirtualService' },
  { type: 'destinationrules.networking.istio.io', label: 'DestinationRule' },
  { type: 'gateways.networking.istio.io', label: 'Gateway' },
  { type: 'httproutes.gateway.networking.k8s.io', label: 'HTTPRoute' },
]

export function Home() {
  const caps = useCapabilities()
  const types = useResourceTypes()
  const installed = (types.data ?? []).filter((t) => t.installed)
  const actions = useRecentActions()

  const results = useQueries({
    queries: installed.map((t) => ({
      queryKey: ['resources', t.typeId, ''],
      queryFn: () => apiGet<ResourceSummary[]>(`/api/resources/${t.typeId}`),
    })),
  })
  const countByType = new Map(installed.map((t, i) => [t.typeId, results[i]?.data?.length ?? 0]))
  const total = [...countByType.values()].reduce((a, b) => a + b, 0)
  const dangerousActive = installed.filter((t) => t.dangerous && (countByType.get(t.typeId) ?? 0) > 0).length
  const catCount = (cat: Category) =>
    installed.filter((t) => t.category === cat).reduce((a, t) => a + (countByType.get(t.typeId) ?? 0), 0)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-strong">Istio Dashboard</h1>
          <p className="mt-1 text-sm text-muted">트래픽·보안·텔레메트리 설정을 폼 또는 YAML로 안전하게 관리하세요.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <Link key={q.type} to={`/resources/${q.type}/new`} className="btn-ghost text-sm">+ {q.label}</Link>
          ))}
        </div>
      </div>

      {/* diagnostics */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Diag label="연결 상태" value={caps.isError ? '오류' : caps.data?.devMode ? 'dev mode' : '정상'} icon="check" ok={!caps.isError} />
        <Diag label="Istio" value={caps.data?.istioApiVersion || '미설치'} icon="bolt" ok={!!caps.data?.istioApiVersion} />
        <Diag label="Gateway API" value={caps.data?.gatewayAPIVersion || '미설치'} icon="grid" ok={!!caps.data?.gatewayAPIVersion} />
        <Diag label="활성 고위험" value={dangerousActive} icon="warning" ok={dangerousActive === 0} />
      </div>

      {/* category status cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {CATEGORY_ORDER.map((cat) => {
          const a = accentFor(cat)
          const kinds = installed.filter((t) => t.category === cat)
          if (kinds.length === 0) return null
          return (
            <div key={cat} className="panel rounded-xl p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className={`flex items-center gap-2 text-sm font-semibold ${a.text}`}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-md ${a.bg}`}>
                    <Icon name={CATEGORY_ICON[cat]} className="h-3.5 w-3.5" />
                  </span>
                  {CATEGORY_LABELS[cat]}
                </div>
                <span className="text-sm font-medium text-faint">{catCount(cat)}개</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {kinds.map((t) => (
                  <Link
                    key={t.typeId}
                    to={`/resources/${t.typeId}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs hover:opacity-80 ${a.bg} ${a.text} ${a.border}`}
                  >
                    {t.kind} <span className="font-semibold">{countByType.get(t.typeId) ?? 0}</span>
                    {t.dangerous && <span className="text-amber-500">⚠</span>}
                  </Link>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* session activity */}
      <div className="panel rounded-xl p-4">
        <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-strong">
          <Icon name="list" className="h-4 w-4 text-muted" /> 이 세션의 활동
          <span className="text-xs font-normal text-faint">({total}개 리소스)</span>
        </div>
        {actions.length === 0 ? (
          <p className="py-4 text-center text-sm text-faint">아직 이 세션에서 변경한 리소스가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {actions.map((a, i) => <ActionRow key={i} a={a} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

const VERB_LABEL: Record<Action['verb'], string> = { create: '생성', update: '수정', delete: '삭제' }
const VERB_TINT: Record<Action['verb'], string> = {
  create: 'text-emerald-600 dark:text-emerald-400',
  update: 'text-accent',
  delete: 'text-red-600 dark:text-red-400',
}

function ActionRow({ a }: { a: Action }) {
  return (
    <li className="flex items-center gap-2 py-1.5">
      <span className={`w-8 shrink-0 text-xs font-semibold ${VERB_TINT[a.verb]}`}>{VERB_LABEL[a.verb]}</span>
      <span className="text-muted">{a.kind}</span>
      <span className="truncate text-strong">{a.ns ? `${a.ns}/` : ''}{a.name}</span>
      {!a.ok && <span className="text-xs text-red-500">실패</span>}
      <span className="ml-auto shrink-0 text-xs text-faint">{new Date(a.time).toLocaleTimeString()}</span>
    </li>
  )
}

function Diag({ label, value, icon, ok }: { label: string; value: ReactNode; icon: string; ok: boolean }) {
  return (
    <div className="panel rounded-xl p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${ok ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400'}`}>
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 truncate text-2xl font-bold tracking-tight text-strong">{value}</div>
    </div>
  )
}
