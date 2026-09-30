import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useResources, type ResourceSummary, type ResourceDetail } from '../api/resources'
import { useResourceTypes } from '../api/resourceTypes'
import { useNamespaces } from '../api/namespaces'
import { useNamespace } from '../ui/namespace'
import { apiGet, apiDelete, ApiError } from '../api/client'
import { useToast } from '../components/Toast'
import { downloadText, toManifestYaml } from '../lib/download'
import { Icon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { DangerConfirm } from '../components/DangerConfirm'
import { useCapabilities } from '../api/capabilities'

export function ResourceList() {
  const { type = '' } = useParams()
  const { ns, setNs } = useNamespace()
  const [search, setSearch] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ResourceSummary | null>(null)
  const caps = useCapabilities().data
  const canWrite = caps?.role === 'admin' || caps?.role === 'editor'
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const namespaces = useNamespaces()
  const types = useResourceTypes()
  const rt = types.data?.find((t) => t.typeId === type)
  const { data, isLoading, isError, error, isFetching } = useResources(type, ns)
  const queryClient = useQueryClient()
  const toast = useToast()

  const keyOf = (r: ResourceSummary) => `${r.namespace}/${r.name}`
  const rows = (data ?? []).filter((r) =>
    `${r.name} ${r.namespace} ${r.summary}`.toLowerCase().includes(search.toLowerCase()),
  )
  const allKeys = rows.map(keyOf)
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
    setSelected((s) => {
      const next = new Set(s)
      for (const k of allKeys) {
        if (allSelected) next.delete(k)
        else next.add(k)
      }
      return next
    })
  }

  function onDelete(r: ResourceSummary) {
    if (!canWrite) return
    if (rt?.dangerous) {
      setPendingDelete(r)
      return
    }
    if (window.confirm(`${r.kind} ${r.namespace || ''}/${r.name} 를 삭제할까요?`)) void doDelete(r)
  }

  async function doDelete(r: ResourceSummary) {
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
      } catch {
        /* skip unreadable */
      }
    }
    if (docs.length === 0) {
      toast('error', '다운로드할 리소스를 읽지 못했습니다.')
      return
    }
    const file =
      items.length === 1 ? `${items[0].kind}-${items[0].name}.yaml` : `${rt?.kind ?? 'resources'}-export.yaml`
    downloadText(file, docs.join('---\n'))
    toast('success', `${docs.length}개 리소스 YAML을 내려받았습니다.`)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        eyebrow="Resource management"
        title={
          <>
            {rt?.kind ?? type}
            <span className="nav-count !text-xs">{data?.length ?? '—'}</span>
          </>
        }
        description={`${rt?.kind ?? '리소스'} 설정을 조회하고 관리합니다.`}
        actions={
          <>
            <button
              onClick={downloadYaml}
              disabled={selected.size === 0}
              title={selected.size === 0 ? '다운로드할 리소스를 선택하세요' : undefined}
              className="btn-ghost"
            >
              <Icon name="download" className="h-4 w-4" />
              YAML 다운로드{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
            {canWrite && (
              <Link to={`/resources/${type}/new`} className="btn-primary">
                <Icon name="plus" className="h-4 w-4" />새 리소스
              </Link>
            )}
          </>
        }
      />
      {rt?.dangerous && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <Icon name="warning" className="h-4 w-4" />
          고위험 리소스 · 변경 시 메시의 트래픽이나 보안에 영향을 줄 수 있습니다.
        </div>
      )}
      <div className="panel flex flex-wrap items-center gap-3 p-3">
        <label className="relative min-w-0 flex-1 sm:max-w-sm">
          <Icon name="search" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-faint" />
          <input
            aria-label="리소스 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 네임스페이스, 설정 검색"
            className="input-base pl-9"
          />
        </label>
        {rt?.namespaced && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <span>Namespace</span>
            <select
              className="input-base !w-auto max-w-56"
              value={ns}
              onChange={(e) => {
                setNs(e.target.value)
                setSelected(new Set())
              }}
            >
              <option value="">전체 네임스페이스</option>
              {(namespaces.data ?? []).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="ml-auto text-xs text-muted">
          {rows.length}개{isFetching && ' · 갱신 중'}
        </span>
      </div>
      <div className="panel table-scroll">
        <table className="data-table">
          <thead className="border-b border-base bg-slate-50 text-left text-xs uppercase tracking-wide text-muted dark:bg-slate-800/50">
            <tr>
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="표시된 리소스 전체 선택"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-base text-accent focus:ring-accent"
                />
              </th>
              <Th>Namespace</Th>
              <Th>Name</Th>
              <Th>Summary</Th>
              <Th>Age</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading && <Msg>로딩 중…</Msg>}
            {isError && <Msg>불러오기 실패: {(error as Error).message}</Msg>}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon="search"
                    title={search ? '검색 결과가 없습니다' : '리소스가 없습니다'}
                    description={
                      search
                        ? '다른 검색어나 네임스페이스로 찾아보세요.'
                        : '새 리소스를 생성해 서비스 메시 설정을 시작하세요.'
                    }
                  />
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const k = keyOf(r)
              return (
                <tr key={k} className="row-hover">
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`${r.name} 선택`}
                      checked={selected.has(k)}
                      onChange={() => toggle(k)}
                      className="rounded border-base text-accent focus:ring-accent"
                    />
                  </td>
                  <Td className="text-muted">{r.namespace || '—'}</Td>
                  <Td>
                    <Link
                      to={`/resources/${type}/${r.namespace || '-'}/${r.name}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {r.name}
                    </Link>
                  </Td>
                  <Td className="text-muted">{r.summary || '—'}</Td>
                  <Td className="text-faint">{r.age}</Td>
                  <Td className="text-right">
                    {canWrite && (
                      <button
                        onClick={() => onDelete(r)}
                        aria-label={`${r.name} 삭제`}
                        title="삭제"
                        className="icon-button !h-7 !w-7 hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-500/10"
                      >
                        <Icon name="trash" className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pendingDelete && (
        <DangerConfirm
          name={pendingDelete.name}
          action="삭제"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            void doDelete(pendingDelete)
            setPendingDelete(null)
          }}
        />
      )}
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
  return (
    <tr>
      <td colSpan={7} className="px-3 py-10 text-center text-faint">
        {children}
      </td>
    </tr>
  )
}
