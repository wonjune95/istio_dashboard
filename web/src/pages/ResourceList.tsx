import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useResources, type ResourceSummary, type ResourceDetail } from '../api/resources'
import { useResourceTypes } from '../api/resourceTypes'
import { useNamespaces } from '../api/namespaces'
import { useNamespace } from '../ui/namespace'
import { apiGet, apiDelete, ApiError } from '../api/client'
import { useToast } from '../components/Toast'
import { KindBadge } from '../components/KindBadge'
import { downloadText, toManifestYaml } from '../lib/download'

export function ResourceList() {
  const { type = '' } = useParams()
  const { ns, setNs } = useNamespace()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const namespaces = useNamespaces()
  const types = useResourceTypes()
  const rt = types.data?.find((t) => t.typeId === type)
  const { data, isLoading, isError, error, isFetching } = useResources(type, ns)
  const queryClient = useQueryClient()
  const toast = useToast()

  const keyOf = (r: ResourceSummary) => `${r.namespace}/${r.name}`
  const allKeys = (data ?? []).map(keyOf)
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k))

  function toggle(k: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allKeys))
  }

  async function onDelete(r: ResourceSummary) {
    if (!window.confirm(`${r.kind} ${r.namespace || ''}/${r.name} 를 삭제할까요?`)) return
    try {
      await apiDelete(`/api/resources/${type}/${r.namespace || '-'}/${r.name}`)
      toast('success', '삭제되었습니다.')
      queryClient.invalidateQueries({ queryKey: ['resources', type] })
    } catch (e) {
      toast('error', e instanceof ApiError ? `${e.status} ${e.reason}: ${e.message}` : String(e))
    } finally {
      queryClient.invalidateQueries({ queryKey: ['audit'] })
    }
  }

  // Downloads the checked resources as clean, re-appliable manifests.
  async function downloadYaml() {
    const items = (data ?? []).filter((r) => selected.has(keyOf(r)))
    if (items.length === 0) return
    const docs: string[] = []
    for (const r of items) {
      try {
        const d = await apiGet<ResourceDetail>(`/api/resources/${type}/${r.namespace || '-'}/${r.name}`)
        docs.push(toManifestYaml(d.raw))
      } catch { /* skip unreadable */ }
    }
    if (docs.length === 0) { toast('error', '다운로드할 리소스를 읽지 못했습니다.'); return }
    const file = items.length === 1 ? `${items[0].kind}-${items[0].name}.yaml` : `${rt?.kind ?? 'resources'}-export.yaml`
    downloadText(file, docs.join('---\n'))
    toast('success', `${docs.length}개 리소스 YAML을 내려받았습니다.`)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={rt?.kind ?? type} category={rt?.category} />
        <h2 className="text-xl font-semibold text-strong">{rt?.kind ?? type}</h2>
        {rt?.dangerous && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">⚠ 고위험</span>}
        {isFetching && <span className="text-xs text-faint">불러오는 중…</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={downloadYaml}
            disabled={selected.size === 0}
            title={selected.size === 0 ? '다운로드할 리소스를 선택하세요' : ''}
            className="btn-ghost text-sm disabled:opacity-40"
          >
            YAML 다운로드{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
          <Link to={`/resources/${type}/new`} className="btn-primary text-sm">
            + 새 {rt?.kind ?? '리소스'}
          </Link>
        </div>
      </div>

      {rt?.namespaced && (
        <div className="panel flex items-center gap-2 rounded-lg p-2.5 text-sm">
          <span className="text-xs text-muted">Namespace</span>
          <select className="input-base w-auto py-1" value={ns} onChange={(e) => { setNs(e.target.value); setSelected(new Set()) }}>
            <option value="">전체</option>
            {(namespaces.data ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}

      <div className="panel overflow-hidden rounded-lg">
        <table className="w-full text-sm">
          <thead className="border-b border-base bg-slate-50 text-left text-xs uppercase tracking-wide text-muted dark:bg-slate-800/50">
            <tr>
              <th className="w-8 px-3 py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-base text-accent focus:ring-accent" /></th>
              <Th>Namespace</Th><Th>Name</Th><Th>Summary</Th><Th>Age</Th><Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading && <Msg>로딩 중…</Msg>}
            {isError && <Msg>불러오기 실패: {(error as Error).message}</Msg>}
            {!isLoading && !isError && data?.length === 0 && <Msg>리소스가 없습니다.</Msg>}
            {data?.map((r) => {
              const k = keyOf(r)
              return (
                <tr key={k} className="row-hover">
                  <td className="px-3 py-1.5"><input type="checkbox" checked={selected.has(k)} onChange={() => toggle(k)} className="rounded border-base text-accent focus:ring-accent" /></td>
                  <Td className="text-muted">{r.namespace || '—'}</Td>
                  <Td>
                    <Link to={`/resources/${type}/${r.namespace || '-'}/${r.name}`} className="font-medium text-accent hover:underline">{r.name}</Link>
                  </Td>
                  <Td className="text-muted">{r.summary || '—'}</Td>
                  <Td className="text-faint">{r.age}</Td>
                  <Td className="text-right"><button onClick={() => onDelete(r)} className="text-xs text-red-600 hover:underline dark:text-red-400">삭제</button></Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-1.5 ${className}`}>{children}</td>
}
function Msg({ children }: { children: React.ReactNode }) {
  return <tr><td colSpan={6} className="px-3 py-10 text-center text-faint">{children}</td></tr>
}
