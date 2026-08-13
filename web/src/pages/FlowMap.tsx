import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useFlowMap,
  type FlowBackend,
  type FlowGateway,
  type FlowRoute,
  type FlowServiceEntry,
} from '../api/flowmap'
import { Icon } from '../components/icons'

type Edge = { from: string; to: string }

// 노드 DOM 위치를 측정해 SVG 베지어 곡선으로 잇는 캔버스. setRef(id)로 노드를
// 등록하고 edges의 from/to id를 연결한다.
function useFlowCanvas(edges: Edge[]) {
  const containerRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef(new Map<string, HTMLElement>())
  const [paths, setPaths] = useState<{ key: string; d: string }[]>([])

  useLayoutEffect(() => {
    const draw = () => {
      const c = containerRef.current
      if (!c) return
      const cb = c.getBoundingClientRect()
      const seen = new Set<string>()
      const out: { key: string; d: string }[] = []
      for (const e of edges) {
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
  }, [edges])

  const setRef = (id: string) => (el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(id, el)
    else nodeRefs.current.delete(id)
  }
  return { containerRef, setRef, paths }
}

const gwId = (g: FlowGateway) => `${g.namespace}/${g.name}`
const routeId = (r: FlowRoute) => `r:${r.kind}/${r.namespace}/${r.name}`
const backendId = (b: FlowBackend) =>
  b.external ? `b:ext:${b.name}` : `b:${b.namespace}/${b.name}:${b.port ?? 0}`

export function FlowMap() {
  const { data, isLoading } = useFlowMap()

  const { ingress, egress } = useMemo(() => {
    const gateways = data?.gateways ?? []
    const routes = data?.routes ?? []
    const serviceEntries = data?.serviceEntries ?? []
    const egressGwIds = new Set(gateways.filter((g) => g.egress).map(gwId))
    const split = (isEgress: boolean) => {
      const gws = gateways.filter((g) => !!g.egress === isEgress)
      const rts = routes.filter((r) => r.gateways.some((g) => egressGwIds.has(g)) === isEgress)
      const ids = new Set(gws.map(gwId))
      const backends = new Map<string, FlowBackend>()
      const edges: Edge[] = gws.map((g) => ({ from: 'src', to: `g:${gwId(g)}` }))
      for (const r of rts) {
        for (const g of r.gateways) if (ids.has(g)) edges.push({ from: `g:${g}`, to: routeId(r) })
        for (const b of r.backends) {
          if (!backends.has(backendId(b))) backends.set(backendId(b), b)
          edges.push({ from: routeId(r), to: backendId(b) })
        }
      }
      return { gws, rts, backends, edges }
    }
    const ing = split(false)
    const eg = split(true)
    // 라우트가 참조하지 않는 ServiceEntry는 메시에서 직접 나가는 이그레스로 표시
    const referenced = new Set(
      [...eg.backends.values(), ...ing.backends.values()]
        .filter((b) => b.serviceEntry)
        .map((b) => b.serviceEntry as string),
    )
    const directSEs = serviceEntries.filter((se) => !referenced.has(se.name))
    for (const se of directSEs) eg.edges.push({ from: 'src', to: `se:${se.namespace}/${se.name}` })
    return { ingress: ing, egress: { ...eg, directSEs } }
  }, [data])

  const hasEgress = egress.gws.length > 0 || egress.directSEs.length > 0 || egress.rts.length > 0

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-strong">트래픽 흐름</h2>
        <p className="mt-1 text-sm text-muted">
          라우팅 설정으로 본 인그레스/이그레스 경로. 실제 트래픽 양이 아니라 리소스 연결을 그린다.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {!isLoading && ingress.gws.length === 0 && ingress.rts.length === 0 && !hasEgress && (
        <p className="text-sm text-muted">이 클러스터에는 게이트웨이/라우트 리소스가 없습니다.</p>
      )}

      {(ingress.gws.length > 0 || ingress.rts.length > 0) && (
        <FlowSection
          title="인그레스"
          srcLabel="Internet"
          srcIcon="bolt"
          gateways={ingress.gws}
          routes={ingress.rts}
          backends={ingress.backends}
          serviceEntries={[]}
          edges={ingress.edges}
        />
      )}

      {hasEgress && (
        <FlowSection
          title="이그레스"
          srcLabel="Mesh"
          srcIcon="cube"
          gateways={egress.gws}
          routes={egress.rts}
          backends={egress.backends}
          serviceEntries={egress.directSEs}
          edges={egress.edges}
        />
      )}
    </div>
  )
}

function FlowSection({
  title, srcLabel, srcIcon, gateways, routes, backends, serviceEntries, edges,
}: {
  title: string
  srcLabel: string
  srcIcon: string
  gateways: FlowGateway[]
  routes: FlowRoute[]
  backends: Map<string, FlowBackend>
  serviceEntries: FlowServiceEntry[]
  edges: Edge[]
}) {
  const { containerRef, setRef, paths } = useFlowCanvas(edges)

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div ref={containerRef} className="relative">
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {paths.map((p) => (
            <path key={p.key} d={p.d} fill="none" className="stroke-gray-300 dark:stroke-slate-700" strokeWidth="1.5" />
          ))}
        </svg>
        <div className="relative flex items-start gap-14">
          <div className="flex w-24 shrink-0 flex-col items-center self-center" ref={setRef('src')}>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white">
              <Icon name={srcIcon} className="h-6 w-6" />
            </span>
            <span className="mt-1.5 text-xs font-medium text-muted">{srcLabel}</span>
          </div>

          {gateways.length > 0 && (
            <div className="flex min-w-0 flex-col gap-4">
              {gateways.map((g) => (
                <Link
                  key={gwId(g)}
                  ref={setRef(`g:${gwId(g)}`)}
                  to={`/resources/${g.typeId}/${g.namespace}/${g.name}`}
                  className="panel block w-56 rounded-xl border-l-4 !border-l-blue-500 p-3 hover:shadow-sm"
                >
                  <div className="truncate text-sm font-medium text-strong">{g.name}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {g.kind === 'IstioGateway' ? 'Istio Gateway' : 'Gateway API'} · {g.namespace}
                  </div>
                  {g.hosts.length > 0 && <div className="mt-1 truncate text-xs text-accent">{g.hosts.join(', ')}</div>}
                </Link>
              ))}
            </div>
          )}

          {routes.length > 0 && (
            <div className="flex min-w-0 flex-col gap-4">
              {routes.map((r) => (
                <Link
                  key={routeId(r)}
                  ref={setRef(routeId(r))}
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
          )}

          <div className="flex min-w-0 flex-col gap-4">
            {[...backends.entries()].map(([id, b]) => (
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
                    b.serviceEntry ? (
                      <>외부 · ServiceEntry <span className="text-accent">{b.serviceEntry}</span></>
                    ) : (
                      '외부 호스트'
                    )
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
            {serviceEntries.map((se) => (
              <Link
                key={`${se.namespace}/${se.name}`}
                ref={setRef(`se:${se.namespace}/${se.name}`)}
                to={`/resources/${se.typeId}/${se.namespace}/${se.name}`}
                className="panel block w-60 rounded-xl border-l-4 !border-l-emerald-500 p-3 hover:shadow-sm"
              >
                <div className="truncate text-sm font-medium text-strong">{se.hosts.join(', ') || se.name}</div>
                <div className="mt-0.5 text-xs text-muted">ServiceEntry · {se.namespace}/{se.name}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
