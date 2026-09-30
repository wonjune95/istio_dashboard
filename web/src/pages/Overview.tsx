import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { apiGet } from '../api/client'
import { type ResourceSummary } from '../api/resources'
import { useResourceTypes, CATEGORY_LABELS, type Category } from '../api/resourceTypes'
import { useNamespaces } from '../api/namespaces'
import { useNamespace } from '../ui/namespace'
import { KindBadge } from '../components/KindBadge'
import { CATEGORY_ORDER, accentFor } from '../ui/categories'
import { Icon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'

export function Overview() {
  const { ns, setNs } = useNamespace()
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState<Category | ''>('')
  const namespaces = useNamespaces()
  const types = useResourceTypes()
  const catByType = new Map((types.data ?? []).map((t) => [t.typeId, t.category]))

  const installed = (types.data ?? []).filter((t) => t.installed && (cat === '' || t.category === cat))
  const results = useQueries({
    queries: installed.map((t) => ({
      queryKey: ['resources', t.typeId, ns],
      queryFn: () => apiGet<ResourceSummary[]>(`/api/resources/${t.typeId}${ns ? `?ns=${ns}` : ''}`),
    })),
  })

  const loading = results.some((r) => r.isLoading)
  const rows = results
    .flatMap((r) => r.data ?? [])
    .filter((r) =>
      `${r.kind} ${r.name} ${r.namespace} ${r.summary}`.toLowerCase().includes(search.toLowerCase()),
    )
  const failed = results.some((r) => r.isError) || types.isError

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        eyebrow="Resource inventory"
        title={
          <>
            전체 리소스<span className="nav-count !text-xs">{rows.length}</span>
          </>
        }
        description="클러스터의 모든 메시 설정을 검색하고 네임스페이스별로 살펴보세요."
      />
      {failed && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          일부 리소스를 불러오지 못했습니다.
        </p>
      )}
      {/* toolbar */}
      <div className="panel flex flex-wrap items-center gap-3 p-3 text-sm">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <Icon name="search" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="리소스 검색"
            aria-label="리소스 검색"
            className="input-base pl-9"
          />
        </label>
        <Field label="Namespace">
          <select className="input-base w-auto py-1" value={ns} onChange={(e) => setNs(e.target.value)}>
            <option value="">전체</option>
            {(namespaces.data ?? []).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            className="input-base w-auto py-1"
            value={cat}
            onChange={(e) => setCat(e.target.value as Category | '')}
          >
            <option value="">전체</option>
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* count chips */}
      <div className="flex flex-wrap gap-1.5">
        {installed.map((t, i) => {
          const n = results[i]?.data?.length ?? 0
          const a = accentFor(t.category)
          return (
            <Link
              key={t.typeId}
              to={`/resources/${t.typeId}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${
                n > 0 ? `${a.bg} ${a.text} ${a.border}` : 'border-base text-faint'
              }`}
            >
              {t.kind} <span className="font-semibold">{n}</span>
              {t.dangerous && <Icon name="warning" className="h-3 w-3 text-amber-500" />}
            </Link>
          )
        })}
      </div>

      {/* table */}
      <div className="panel table-scroll">
        <table className="data-table">
          <thead className="border-b border-base bg-slate-50 text-left text-xs uppercase tracking-wide text-muted dark:bg-slate-800/50">
            <tr>
              <Th>Kind</Th>
              <Th>Namespace</Th>
              <Th>Name</Th>
              <Th>Summary</Th>
              <Th>Age</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {!loading && !failed && rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    title={search ? '검색 결과가 없습니다' : '리소스가 없습니다'}
                    description="검색어나 네임스페이스 필터를 확인하세요."
                  />
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={5} className="text-center text-muted">
                  리소스를 불러오는 중…
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.typeId}/${r.namespace}/${r.name}`} className="row-hover">
                <Td>
                  <KindBadge kind={r.kind} category={catByType.get(r.typeId)} />
                </Td>
                <Td className="text-muted">{r.namespace || '—'}</Td>
                <Td>
                  <Link
                    to={`/resources/${r.typeId}/${r.namespace || '-'}/${r.name}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {r.name}
                  </Link>
                </Td>
                <Td className="text-muted">{r.summary || '—'}</Td>
                <Td className="text-faint">{r.age}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-muted">
      <span className="text-xs">{label}</span>
      {children}
    </label>
  )
}
function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-1.5 ${className}`}>{children}</td>
}
