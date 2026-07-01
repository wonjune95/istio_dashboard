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

export function Overview() {
  const { ns, setNs } = useNamespace()
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
  const rows = results.flatMap((r) => r.data ?? [])

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold text-strong">전체 보기</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-muted dark:bg-slate-800">{rows.length}개</span>
        {loading && <span className="text-xs text-faint">불러오는 중…</span>}
      </div>

      {/* toolbar */}
      <div className="panel flex flex-wrap items-center gap-2 rounded-lg p-2.5 text-sm">
        <Field label="Namespace">
          <select className="input-base w-auto py-1" value={ns} onChange={(e) => setNs(e.target.value)}>
            <option value="">전체</option>
            {(namespaces.data ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select className="input-base w-auto py-1" value={cat} onChange={(e) => setCat(e.target.value as Category | '')}>
            <option value="">전체</option>
            {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
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
              {t.dangerous && <span className="text-amber-500">⚠</span>}
            </Link>
          )
        })}
      </div>

      {/* table */}
      <div className="panel overflow-hidden rounded-lg">
        <table className="w-full text-sm">
          <thead className="border-b border-base bg-slate-50 text-left text-xs uppercase tracking-wide text-muted dark:bg-slate-800/50">
            <tr><Th>Kind</Th><Th>Namespace</Th><Th>Name</Th><Th>Summary</Th><Th>Age</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-faint">리소스가 없습니다.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.typeId}/${r.namespace}/${r.name}`} className="row-hover">
                <Td><KindBadge kind={r.kind} category={catByType.get(r.typeId)} /></Td>
                <Td className="text-muted">{r.namespace || '—'}</Td>
                <Td>
                  <Link to={`/resources/${r.typeId}/${r.namespace || '-'}/${r.name}`} className="font-medium text-accent hover:underline">{r.name}</Link>
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
