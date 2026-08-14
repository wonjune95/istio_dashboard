import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  useFlowMap,
  type FlowBackend,
  type FlowGateway,
  type FlowRoute,
  type FlowServiceEntry,
} from '../api/flowmap'
import { Icon } from '../components/icons'

type Edge = { from: string; to: string; broken?: boolean }
type Offsets = Record<string, { x: number; y: number }>

// 노드 DOM 위치를 측정해 SVG 베지어 곡선으로 잇는 캔버스. setRef(id)로 노드를
// 등록하고 edges의 from/to id를 연결한다. offsets(드래그)가 바뀌면 다시 그린다.
function useFlowCanvas(edges: Edge[], offsets: Offsets) {
  const containerRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef(new Map<string, HTMLElement>())
  const [paths, setPaths] = useState<{ key: string; from: string; to: string; d: string; broken?: boolean }[]>([])

  useLayoutEffect(() => {
    const draw = () => {
      const c = containerRef.current
      if (!c) return
      const cb = c.getBoundingClientRect()
      // 드래그로 노드가 아래 경계를 넘으면 캔버스를 그만큼 늘려 배경이 따라오게 한다
      let maxBottom = 0
      for (const el of nodeRefs.current.values()) {
        maxBottom = Math.max(maxBottom, el.getBoundingClientRect().bottom - cb.top)
      }
      c.style.minHeight = `${Math.ceil(maxBottom)}px`
      const seen = new Set<string>()
      const out: typeof paths = []
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
        out.push({ key, from: e.from, to: e.to, broken: e.broken, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` })
      }
      setPaths(out)
    }
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [edges, offsets])

  const setRef = (id: string) => (el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(id, el)
    else nodeRefs.current.delete(id)
  }
  return { containerRef, setRef, paths }
}

// 선택 노드의 상류(유입 경로) + 하류(유출 경로) 집합. 형제 경로는 포함하지 않는다.
function computeHighlight(selected: string | null, edges: Edge[]) {
  if (!selected) return null
  const fwd = new Map<string, string[]>()
  const rev = new Map<string, string[]>()
  for (const e of edges) {
    fwd.set(e.from, [...(fwd.get(e.from) ?? []), e.to])
    rev.set(e.to, [...(rev.get(e.to) ?? []), e.from])
  }
  const nodes = new Set([selected])
  const walk = (adj: Map<string, string[]>) => {
    const q = [selected]
    while (q.length) {
      for (const n of adj.get(q.pop() as string) ?? []) {
        if (!nodes.has(n)) { nodes.add(n); q.push(n) }
      }
    }
  }
  walk(fwd)
  walk(rev)
  return nodes
}

const gwId = (g: FlowGateway) => `${g.namespace}/${g.name}`
const routeId = (r: FlowRoute) => `r:${r.kind}/${r.namespace}/${r.name}`
const backendId = (b: FlowBackend) =>
  b.external ? `b:ext:${b.name}` : `b:${b.namespace}/${b.name}:${b.port ?? 0}`
const backendBroken = (b: FlowBackend) => !b.external && (!b.exists || b.endpoints === 0)

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
          edges.push({ from: routeId(r), to: backendId(b), broken: backendBroken(b) })
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
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-strong">트래픽 흐름</h2>
        <p className="mt-1 text-sm text-muted">
          라우팅 설정으로 본 인그레스/이그레스 경로. 노드를 클릭하면 관련 경로만 부각되고, 드래그로 옮길 수 있다.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {!isLoading && ingress.gws.length === 0 && ingress.rts.length === 0 && !hasEgress && (
        <p className="text-sm text-muted">이 클러스터에는 게이트웨이/라우트 리소스가 없습니다.</p>
      )}

      {(ingress.gws.length > 0 || ingress.rts.length > 0) && (
        <FlowSection
          title="인그레스"
          srcLabel="External"
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

// 드래그(이동) + 클릭(선택)을 분리하는 래퍼. 3px 이상 움직이면 드래그로 보고
// 클릭 선택을 무시한다. 카드 안의 링크는 stopPropagation으로 드래그를 피한다.
// 노드는 캔버스(bounds) 밖으로 못 나간다 — 도트 배경 밖으로 끌려나가면 이상해 보인다.
function DraggableNode({
  id, offsets, setOffsets, onSelect, dimmed, nodeRef, bounds, children, className = '',
}: {
  id: string
  offsets: Offsets
  setOffsets: React.Dispatch<React.SetStateAction<Offsets>>
  onSelect: () => void
  dimmed: boolean
  nodeRef: (el: HTMLElement | null) => void
  bounds: React.RefObject<HTMLDivElement | null>
  children: ReactNode
  className?: string
}) {
  const drag = useRef<{
    px: number; py: number; ox: number; oy: number; moved: boolean
    minX: number; maxX: number; minY: number; maxY: number
  } | null>(null)
  const o = offsets[id] ?? { x: 0, y: 0 }
  return (
    <div
      ref={nodeRef}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const cb = bounds.current?.getBoundingClientRect()
        // 오프셋 제외한 기준 위치로 캔버스 내 이동 가능 범위를 계산해 둔다
        const baseL = r.left - o.x
        const baseT = r.top - o.y
        drag.current = {
          px: e.clientX, py: e.clientY, ox: o.x, oy: o.y, moved: false,
          minX: cb ? cb.left - baseL : -Infinity,
          maxX: cb ? cb.right - baseL - r.width : Infinity,
          minY: cb ? cb.top - baseT : -Infinity,
          maxY: Infinity, // 아래로는 제한 없음 — 캔버스가 따라 늘어난다
        }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.px
        const dy = e.clientY - d.py
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
        if (d.moved) {
          const x = Math.min(Math.max(d.ox + dx, d.minX), d.maxX)
          const y = Math.min(Math.max(d.oy + dy, d.minY), d.maxY)
          setOffsets((prev) => ({ ...prev, [id]: { x, y } }))
        }
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (!d?.moved) onSelect()
      }}
      style={{ transform: `translate(${o.x}px, ${o.y}px)`, touchAction: 'none' }}
      className={`cursor-grab select-none transition-opacity active:cursor-grabbing ${dimmed ? 'opacity-25' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

// 아이콘 칩 + 제목/메타/배지 노드 카드. to가 있으면 호버 시 ↗ 링크 표시.
function NodeCard({
  icon, iconClass, title, meta, badge, to, selected,
}: {
  icon: string
  iconClass: string
  title: ReactNode
  meta: ReactNode
  badge?: ReactNode
  to?: string
  selected: boolean
}) {
  return (
    <div className={`flow-node group relative w-64 ${selected ? 'flow-node-selected' : ''}`}>
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon name={icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-strong">{title}</div>
          <div className="mt-0.5 truncate text-xs text-muted">{meta}</div>
          {badge && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{badge}</div>}
        </div>
      </div>
      {to && (
        <Link
          to={to}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          title="리소스 열기"
          className="absolute right-2 top-2 rounded-md p-1 text-faint opacity-0 transition hover:bg-accent-soft hover:text-accent group-hover:opacity-100"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path d="M8 5h7v7M15 5l-8 8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      )}
    </div>
  )
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'muted' | 'accent'; children: ReactNode }) {
  const cls = {
    ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    warn: 'bg-red-500/10 text-red-600 dark:text-red-400',
    muted: 'bg-gray-500/10 text-gray-500 dark:text-slate-400',
    accent: 'bg-accent-soft text-accent',
  }[tone]
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

function Dot({ tone }: { tone: 'ok' | 'warn' }) {
  return <span className={`h-1.5 w-1.5 rounded-full ${tone === 'ok' ? 'bg-emerald-500' : 'bg-red-500'}`} />
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
  const [selected, setSelected] = useState<string | null>(null)
  const [offsets, setOffsets] = useState<Offsets>({})
  const { containerRef, setRef, paths } = useFlowCanvas(edges, offsets)
  const highlight = useMemo(() => computeHighlight(selected, edges), [selected, edges])

  const dimmed = (id: string) => !!highlight && !highlight.has(id)
  const select = (id: string) => () => setSelected((cur) => (cur === id ? null : id))
  const nodeProps = (id: string) => ({
    id, offsets, setOffsets, onSelect: select(id), dimmed: dimmed(id), nodeRef: setRef(id),
    bounds: containerRef,
  })

  return (
    <div className="flow-canvas" onClick={() => setSelected(null)}>
      <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-faint">{title}</h3>
      <div ref={containerRef} className="relative">
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {paths.map((p) => {
            const onPath = highlight && highlight.has(p.from) && highlight.has(p.to)
            return (
              <path
                key={p.key}
                d={p.d}
                fill="none"
                strokeWidth={onPath ? 2 : 1.5}
                strokeLinecap="round"
                className={`flow-edge transition-opacity ${
                  p.broken ? 'stroke-red-400/70' : onPath ? 'flow-edge-hi' : 'stroke-gray-400/50 dark:stroke-slate-500/60'
                } ${highlight && !onPath ? 'opacity-10' : ''}`}
              />
            )
          })}
        </svg>
        <div className="relative flex items-start gap-16">
          <DraggableNode {...nodeProps('src')} className="w-24 shrink-0 self-center">
            <div className="flex flex-col items-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-white shadow-lg" style={{ boxShadow: '0 8px 24px rgb(var(--accent) / 0.35)' }}>
                <Icon name={srcIcon} className="h-6 w-6" />
              </span>
              <span className="mt-2 text-xs font-medium text-muted">{srcLabel}</span>
            </div>
          </DraggableNode>

          {gateways.length > 0 && (
            <div className="flex min-w-0 flex-col gap-5">
              {gateways.map((g) => (
                <DraggableNode key={gwId(g)} {...nodeProps(`g:${gwId(g)}`)}>
                  <NodeCard
                    selected={selected === `g:${gwId(g)}`}
                    to={`/resources/${g.typeId}/${g.namespace}/${g.name}`}
                    icon="shield"
                    iconClass="bg-blue-500/10 text-blue-500"
                    title={g.name}
                    meta={`${g.kind === 'IstioGateway' ? 'Istio Gateway' : 'Gateway API'} · ${g.namespace}`}
                    badge={g.hosts.length > 0 && <Pill tone="accent">{g.hosts.join(', ')}</Pill>}
                  />
                </DraggableNode>
              ))}
            </div>
          )}

          {routes.length > 0 && (
            <div className="flex min-w-0 flex-col gap-5">
              {routes.map((r) => (
                <DraggableNode key={routeId(r)} {...nodeProps(routeId(r))}>
                  <NodeCard
                    selected={selected === routeId(r)}
                    to={`/resources/${r.typeId}/${r.namespace}/${r.name}`}
                    icon="bolt"
                    iconClass="bg-violet-500/10 text-violet-500"
                    title={r.hosts.length > 0 ? r.hosts.join(', ') : r.name}
                    meta={`${r.kind} · ${r.namespace}/${r.name}`}
                  />
                </DraggableNode>
              ))}
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-5">
            {[...backends.entries()].map(([id, b]) => (
              <DraggableNode key={id} {...nodeProps(id)}>
                <NodeCard
                  selected={selected === id}
                  icon="cube"
                  iconClass={
                    b.external
                      ? 'bg-gray-500/10 text-gray-500 dark:text-slate-400'
                      : backendBroken(b)
                        ? 'bg-red-500/10 text-red-500'
                        : 'bg-emerald-500/10 text-emerald-500'
                  }
                  title={<>{b.name}{b.port ? <span className="font-normal text-muted">:{b.port}</span> : null}</>}
                  meta={b.external ? '외부 호스트' : `Service · ${b.namespace}`}
                  badge={
                    b.external ? (
                      b.serviceEntry && <Pill tone="accent">ServiceEntry {b.serviceEntry}</Pill>
                    ) : !b.exists ? (
                      <Pill tone="warn"><Dot tone="warn" /> 서비스 없음</Pill>
                    ) : b.endpoints === 0 ? (
                      <Pill tone="warn"><Dot tone="warn" /> 엔드포인트 0</Pill>
                    ) : (
                      <Pill tone="ok"><Dot tone="ok" /> 엔드포인트 {b.endpoints}</Pill>
                    )
                  }
                />
              </DraggableNode>
            ))}
            {serviceEntries.map((se) => (
              <DraggableNode key={`${se.namespace}/${se.name}`} {...nodeProps(`se:${se.namespace}/${se.name}`)}>
                <NodeCard
                  selected={selected === `se:${se.namespace}/${se.name}`}
                  to={`/resources/${se.typeId}/${se.namespace}/${se.name}`}
                  icon="chart"
                  iconClass="bg-emerald-500/10 text-emerald-500"
                  title={se.hosts.join(', ') || se.name}
                  meta={`ServiceEntry · ${se.namespace}/${se.name}`}
                />
              </DraggableNode>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
