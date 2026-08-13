import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFlowMap, type FlowBackend } from '../api/flowmap'
import { Icon } from '../components/icons'

// 설정 기반 인그레스 트래픽 흐름도: Internet → Gateway → Route → Service.
// 노드 위치를 측정해 SVG 베지어 곡선으로 연결한다 (메트릭 아님 — 리소스 연결 그림).
export function FlowMap() {
  const { data, isLoading } = useFlowMap()
  const containerRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef(new Map<string, HTMLElement>())
  const [paths, setPaths] = useState<{ key: string; d: string }[]>([])

  const graph = useMemo(() => {
    const gwIds = (data?.gateways ?? []).map((g) => `g:${g.namespace}/${g.name}`)
    const backends = new Map<string, FlowBackend>()
    const edges: { from: string; to: string }[] = gwIds.map((id) => ({ from: 'internet', to: id }))
    for (const r of data?.routes ?? []) {
      const rid = `r:${r.kind}/${r.namespace}/${r.name}`
      for (const g of r.gateways) {
        if (gwIds.includes(`g:${g}`)) edges.push({ from: `g:${g}`, to: rid })
      }
      for (const b of r.backends) {
        const bid = b.external ? `b:ext:${b.name}` : `b:${b.namespace}/${b.name}:${b.port ?? 0}`
        if (!backends.has(bid)) backends.set(bid, b)
        edges.push({ from: rid, to: bid })
      }
    }
    return { edges, backends }
  }, [data])

  useLayoutEffect(() => {
    const draw = () => {
      const c = containerRef.current
      if (!c) return
      const cb = c.getBoundingClientRect()
      const seen = new Set<string>()
      const out: { key: string; d: string }[] = []
      for (const e of graph.edges) {
        const key = `${e.from}→${e.to}`
        if (seen.has(key)) continue
        seen.add(key)
        const a = nodeRefs.current.get(e.from)?.getBoundingClientRect()
        const b = nodeRefs.current.get(e.to)?.getBoundingClientRect()
        if (!a || !b) continue
        const x1 = a.right - cb.left
        const y1 = a.top + a.height / 2 - cb.top
        const x2 = b.left - cb.left
        const y2 = b.top + b.height / 2 - cb.top
        const mx = (x1 + x2) / 2
        out.push({ key, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` })
      }
      setPaths(out)
    }
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [graph])

  const setRef = (id: string) => (el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(id, el)
    else nodeRefs.current.delete(id)
  }

  const routes = data?.routes ?? []
  const gateways = data?.gateways ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-strong">트래픽 흐름</h2>
        <p className="mt-1 text-sm text-muted">
          라우팅 설정으로 본 인그레스 경로 — Gateway → Route → Service. 실제 트래픽 양이 아니라 리소스 연결을 그린다.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {!isLoading && gateways.length === 0 && routes.length === 0 && (
        <p className="text-sm text-muted">이 클러스터에는 게이트웨이/라우트 리소스가 없습니다.</p>
      )}

      <div ref={containerRef} className="relative">
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {paths.map((p) => (
            <path key={p.key} d={p.d} fill="none" className="stroke-gray-300 dark:stroke-slate-700" strokeWidth="1.5" />
          ))}
        </svg>
        <div className="relative flex items-start gap-14">
          {/* Internet */}
          <div className="flex w-24 shrink-0 flex-col items-center self-center" ref={setRef('internet')}>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white">
              <Icon name="bolt" className="h-6 w-6" />
            </span>
            <span className="mt-1.5 text-xs font-medium text-muted">Internet</span>
          </div>

          {/* Gateways */}
          <div className="flex min-w-0 flex-col gap-4">
            {gateways.map((g) => (
              <Link
                key={`${g.namespace}/${g.name}`}
                ref={setRef(`g:${g.namespace}/${g.name}`)}
                to={`/resources/${g.typeId}/${g.namespace}/${g.name}`}
                className="panel block w-56 rounded-xl border-l-4 !border-l-blue-500 p-3 hover:shadow-sm"
              >
                <div className="truncate text-sm font-medium text-strong">{g.name}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {g.kind === 'IstioGateway' ? 'Istio Gateway' : 'Gateway API'} · {g.namespace}
                </div>
                {g.hosts.length > 0 && (
                  <div className="mt-1 truncate text-xs text-accent">{g.hosts.join(', ')}</div>
                )}
              </Link>
            ))}
          </div>

          {/* Routes */}
          <div className="flex min-w-0 flex-col gap-4">
            {routes.map((r) => (
              <Link
                key={`${r.kind}/${r.namespace}/${r.name}`}
                ref={setRef(`r:${r.kind}/${r.namespace}/${r.name}`)}
                to={`/resources/${r.typeId}/${r.namespace}/${r.name}`}
                className="panel block w-64 rounded-xl p-3 hover:shadow-sm"
              >
                <div className="truncate text-sm font-medium text-strong">
                  {r.hosts.length > 0 ? r.hosts.join(', ') : r.name}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {r.kind} · {r.namespace}/{r.name}
                </div>
              </Link>
            ))}
          </div>

          {/* Backends */}
          <div className="flex min-w-0 flex-col gap-4">
            {[...graph.backends.entries()].map(([id, b]) => (
              <div
                key={id}
                ref={setRef(id)}
                className={`panel w-60 rounded-xl border-l-4 p-3 ${
                  b.external
                    ? '!border-l-gray-400'
                    : b.exists && b.endpoints > 0
                      ? '!border-l-orange-400'
                      : '!border-l-red-400'
                }`}
              >
                <div className="truncate text-sm font-medium text-strong">
                  {b.name}
                  {b.port ? <span className="text-muted">:{b.port}</span> : null}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                  {b.external ? (
                    '외부 호스트'
                  ) : b.exists ? (
                    <>
                      {b.namespace} · 엔드포인트 {b.endpoints}
                      {b.endpoints === 0 && <Icon name="warning" className="h-3.5 w-3.5 text-red-500" />}
                    </>
                  ) : (
                    <>
                      {b.namespace} · <span className="text-red-500">서비스 없음</span>
                      <Icon name="warning" className="h-3.5 w-3.5 text-red-500" />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
