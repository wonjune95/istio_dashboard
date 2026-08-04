import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { useResource, type ResourceDetail } from '../api/resources'
import { useResourceTypes, type ResourceType } from '../api/resourceTypes'
import { useGateways } from '../api/gateways'
import { useServices } from '../api/services'
import { useAccess } from '../api/access'
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '../api/client'
import { YamlEditor } from '../components/YamlEditor'
import { DangerConfirm } from '../components/DangerConfirm'
import { DiffModal } from '../components/DiffModal'
import { cleanManifest } from '../lib/download'
import { FORMS } from '../forms/registry'
import { AutoForm } from '../forms/AutoForm'
import { useToast } from '../components/Toast'
import { KindBadge } from '../components/KindBadge'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Starter templates with Korean comments shown in the YAML tab for new resources.
// (Editing via the Form tab re-serializes and drops comments — Gemini ④.)
const RICH_TEMPLATES: Record<string, string> = {
  'httproutes.gateway.networking.k8s.io': `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-route
  namespace: default
spec:
  parentRefs:            # 이 라우트를 붙일 Gateway
    - name: demo-gw
  hostnames:             # 매칭할 호스트네임
    - example.com
  rules:
    - matches:           # 매칭 조건(경로 등)
        - path:
            type: PathPrefix   # PathPrefix | Exact
            value: /
      backendRefs:       # 보낼 백엔드 서비스
        - name: my-svc
          port: 80
`,
  'virtualservices.networking.istio.io': `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: my-virtualservice
  namespace: default
spec:
  hosts:                 # (필수) 적용 대상 호스트(도메인/서비스)
    - ''
  gateways:              # (선택) 묶을 Gateway. 없으면 mesh(사이드카)에 적용
    - ''
  http:                  # HTTP 라우팅 규칙(위에서부터 매칭)
    - route:
        - destination:
            host: ''     # 대상 서비스 이름
            port:
              number: 80
          # weight: 100  # (선택) 여러 destination 가중치 분배
`,
  'destinationrules.networking.istio.io': `apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: my-destinationrule
  namespace: default
spec:
  host: ''               # (필수) 정책을 적용할 대상 서비스
  # trafficPolicy:       # (선택) 로드밸런싱/커넥션풀/이상감지
  #   loadBalancer:
  #     simple: ROUND_ROBIN
  # subsets:             # (선택) 버전별 서브셋(라벨로 구분)
  #   - name: v1
  #     labels: { version: v1 }
`,
  'gateways.networking.istio.io': `apiVersion: networking.istio.io/v1
kind: Gateway
metadata:
  name: my-gateway
  namespace: default
spec:
  selector:              # (필수) 이 Gateway를 구동할 인그레스 파드 셀렉터
    istio: ingressgateway
  servers:               # (필수) 수신할 포트/프로토콜/호스트
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - ''             # 예: '*' 또는 example.com
`,
  'serviceentries.networking.istio.io': `apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: my-serviceentry
  namespace: default
spec:
  hosts:                 # (필수) 메시에 추가할 외부 서비스 호스트
    - ''
  ports:                 # (필수) 포트/프로토콜
    - number: 443
      name: https
      protocol: TLS
  resolution: DNS        # DNS | STATIC | NONE
  location: MESH_EXTERNAL  # 외부 서비스면 MESH_EXTERNAL
`,
}

function genericTemplate(rt: ResourceType): string {
  const obj: any = {
    apiVersion: `${rt.group}/${rt.version}`,
    kind: rt.kind,
    metadata: rt.namespaced
      ? { name: `my-${rt.kind.toLowerCase()}`, namespace: 'default' }
      : { name: `my-${rt.kind.toLowerCase()}` },
    spec: {},
  }
  return yamlDump(obj)
}

type Tab = 'form' | 'yaml'

export function ResourceEdit() {
  const { type = '', ns: nsParam, name: nameParam } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()

  const types = useResourceTypes()
  const rt = types.data?.find((t) => t.typeId === type)
  const curated = FORMS[type]
  // Auto-form applies when there's no curated form but the kind is schema-capable.
  const hasAuto = !curated && !!rt?.formCapable

  const isEdit = Boolean(nsParam && nameParam)
  const ns = nsParam ?? ''
  const name = nameParam ?? ''
  const resource = useResource(type, ns, name, isEdit)

  const [text, setText] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('yaml')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ action: string; name: string; run: () => void } | null>(null)
  const [preview, setPreview] = useState<{ oldYaml: string; newYaml: string } | null>(null)
  const [conflict, setConflict] = useState<{ mineYaml: string; latestYaml: string; latestRV: string } | null>(null)

  /* eslint-disable react-hooks/set-state-in-effect --
     one-time editor init: text/tab can only be seeded after the resource query
     resolves, and the `text !== null` guard makes this run exactly once. */
  useEffect(() => {
    if (text !== null || !rt) return
    let initial: string
    if (!isEdit) initial = RICH_TEMPLATES[type] ?? genericTemplate(rt)
    else if (resource.data) initial = yamlDump(resource.data.raw)
    else return
    setText(initial)
    if (curated) {
      try {
        if (curated.isRepresentable(yamlLoad(initial))) setTab('form')
      } catch { /* stay yaml */ }
    } else if (hasAuto) {
      setTab('form')
    }
  }, [isEdit, type, rt, resource.data, text, curated, hasAuto])
  /* eslint-enable react-hooks/set-state-in-effect */

  let obj: any = null
  let parseErr: string | null = null
  if (text !== null) {
    try { obj = yamlLoad(text) } catch (e) { parseErr = (e as Error).message }
  }
  // Curated form requires a representable object; auto-form handles any spec.
  const formAvailable = !parseErr && !!obj && (curated ? curated.isRepresentable(obj) : hasAuto)
  const formNs = obj?.metadata?.namespace || 'default'
  const gateways = useGateways(curated?.needsGateways && tab === 'form' ? formNs : '')
  const services = useServices(curated?.needsServices && tab === 'form' ? formNs : '')

  // Permission-aware UI: SSAR for the verbs this page can perform. When the user
  // lacks the verb, the form/buttons go read-only instead of failing on apply.
  const access = useAccess(type, isEdit ? ns : formNs, isEdit ? name : '', isEdit ? 'update,delete' : 'create', !!rt)
  const readOnly = isEdit && access.data?.update === false
  const noDelete = isEdit && access.data?.delete === false
  const noCreate = !isEdit && access.data?.create === false
  const cantApply = readOnly || noCreate

  // A read-only resource forces the YAML tab (editor locked) — no point showing a form.
  const shownTab: Tab = readOnly && tab === 'form' ? 'yaml' : tab

  function switchTab(t: Tab) {
    if (t === 'form' && !formAvailable) {
      toast('info', parseErr ? 'YAML 파싱 오류로 폼 전환 불가'
        : !curated && !hasAuto ? `${rt?.kind ?? type} 폼은 없습니다 — YAML로 편집하세요`
          : '폼이 표현할 수 없는 고급 필드가 있어 YAML 전용입니다')
      return
    }
    setTab(t)
  }

  // dangerous kinds require typed confirmation before a real mutation.
  function guard(action: string, targetName: string, run: () => void) {
    if (rt?.dangerous) setPending({ action, name: targetName, run })
    else run()
  }

  // 폼/YAML 공통 적용 경로의 사전 검증: 파싱 + 이름/네임스페이스 필수.
  function parseBody(): any | null {
    let body: any
    try { body = yamlLoad(text ?? '') } catch (e) { toast('error', `YAML 파싱 오류: ${(e as Error).message}`); return null }
    if (!body?.metadata?.name) { toast('error', '이름(metadata.name)은 필수입니다.'); return null }
    if (rt?.namespaced && !body.metadata.namespace) { toast('error', '네임스페이스(metadata.namespace)는 필수입니다.'); return null }
    return body
  }

  async function doApply(dryRun: boolean) {
    const body = parseBody()
    if (body === null) return
    setBusy(true)
    try {
      const q = `?dryRun=${dryRun}`
      if (isEdit) await apiPut(`/api/resources/${type}/${ns}/${name}${q}`, body)
      else await apiPost(`/api/resources/${type}${q}`, body)
      if (dryRun) toast('success', '검증 통과 — 적용 가능합니다.')
      else {
        toast('success', isEdit ? '수정이 적용되었습니다.' : '생성되었습니다.')
        queryClient.invalidateQueries({ queryKey: ['resources', type] })
        queryClient.invalidateQueries({ queryKey: ['audit'] })
        navigate(`/resources/${type}`)
      }
    } catch (e) {
      // 409 = someone else changed the object since we loaded it. Don't silently
      // clobber: show "mine vs latest" diff and let the user decide (Gemini gap #2).
      if (!dryRun && isEdit && e instanceof ApiError && e.status === 409) {
        try {
          const latest = await apiGet<ResourceDetail>(`/api/resources/${type}/${ns}/${name}`)
          setConflict({
            mineYaml: yamlDump(cleanManifest(body)),
            latestYaml: yamlDump(cleanManifest(latest.raw)),
            latestRV: latest.resourceVersion,
          })
          return
        } catch { /* fall through to generic error */ }
      }
      toast('error', e instanceof ApiError ? `${e.status} ${e.reason}: ${e.message}` : String(e))
    } finally { setBusy(false) }
  }

  // Re-apply my edits on top of the latest serverside version (last-write-wins
  // after a human reviewed the diff). Grafts the fresh resourceVersion in.
  async function forceOverwrite(latestRV: string) {
    const body = parseBody()
    if (body === null) return
    if (body.metadata) body.metadata.resourceVersion = latestRV
    setBusy(true)
    try {
      await apiPut(`/api/resources/${type}/${ns}/${name}`, body)
      toast('success', '최신 버전 위에 적용되었습니다.')
      queryClient.invalidateQueries({ queryKey: ['resources', type] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      navigate(`/resources/${type}`)
    } catch (e) {
      toast('error', e instanceof ApiError ? `${e.status} ${e.reason}: ${e.message}` : String(e))
    } finally { setBusy(false) }
  }

  function apply(dryRun: boolean) {
    if (dryRun) { void doApply(true); return } // "검증" button: validate only
    void openPreview() // "적용" button: dry-run → diff preview → confirm
  }

  // Runs a dry-run to get the would-be-applied object, then opens a diff preview
  // (kubectl-diff style) against the current object before the real apply.
  async function openPreview() {
    const body = parseBody()
    if (body === null) return
    setBusy(true)
    try {
      const q = '?dryRun=true'
      const result = isEdit
        ? await apiPut<ResourceDetail>(`/api/resources/${type}/${ns}/${name}${q}`, body)
        : await apiPost<ResourceDetail>(`/api/resources/${type}${q}`, body)
      setPreview({
        oldYaml: isEdit && resource.data ? yamlDump(cleanManifest(resource.data.raw)) : '',
        newYaml: yamlDump(cleanManifest(result.raw)),
      })
    } catch (e) {
      toast('error', e instanceof ApiError ? `${e.status} ${e.reason}: ${e.message}` : String(e))
    } finally { setBusy(false) }
  }

  async function doDelete() {
    setBusy(true)
    try {
      await apiDelete(`/api/resources/${type}/${ns}/${name}`)
      toast('success', '삭제되었습니다.')
      queryClient.invalidateQueries({ queryKey: ['resources', type] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      navigate(`/resources/${type}`)
    } catch (e) {
      toast('error', e instanceof ApiError ? `${e.status} ${e.reason}: ${e.message}` : String(e))
    } finally { setBusy(false) }
  }

  function del() {
    if (rt?.dangerous) { guard('삭제', name, () => void doDelete()); return }
    if (window.confirm(`${rt?.kind ?? type} ${ns}/${name} 를 삭제할까요?`)) void doDelete()
  }

  if (!rt && types.isLoading) return <div className="text-muted">로딩 중…</div>
  if (!rt) return <div className="text-red-600 dark:text-red-400">알 수 없는 리소스 타입: {type}</div>
  if (isEdit && resource.isLoading) return <div className="text-muted">로딩 중…</div>
  if (isEdit && resource.isError) return <div className="text-red-600 dark:text-red-400">불러오기 실패: {(resource.error as Error).message}</div>
  if (text === null) return <div className="text-muted">준비 중…</div>

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <KindBadge kind={rt.kind} category={rt.category} />
        <h2 className="text-lg font-semibold text-strong">
          {isEdit ? `${rt.kind} 수정 · ${ns}/${name}` : `새 ${rt.kind}`}
        </h2>
        {rt.dangerous && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">⚠ 고위험</span>}
        <Link to={`/resources/${type}`} className="ml-auto text-sm text-muted hover:underline">← 목록</Link>
      </div>

      {readOnly && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          이 리소스에 대한 <strong>수정 권한이 없습니다</strong> — 읽기 전용으로 표시됩니다.
        </div>
      )}
      {noCreate && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <strong>{rt.kind} 생성 권한이 없습니다</strong> — 적용할 수 없습니다 (YAML 작성/다운로드는 가능).
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-base">
        <TabButton active={shownTab === 'form'} disabled={!formAvailable || readOnly} onClick={() => switchTab('form')}>폼</TabButton>
        <TabButton active={shownTab === 'yaml'} onClick={() => switchTab('yaml')}>YAML</TabButton>
        {curated && !formAvailable && !parseErr && (
          <span className="ml-3 self-center text-xs text-amber-600 dark:text-amber-400">고급 필드 감지 — YAML 전용</span>
        )}
        {shownTab === 'form' && formAvailable && (
          <span className="ml-auto self-center pb-1 text-xs text-faint">
            <span className="text-red-500">*</span> 필수 · <span className="text-amber-600 dark:text-amber-400">(권장)</span> 채우면 좋음 · (선택) 부가
          </span>
        )}
      </div>

      {shownTab === 'form' && formAvailable && curated ? (
        curated.render({
          model: curated.toModel(obj),
          onChange: (m: any) => setText(yamlDump(curated.fromModel(obj, m))),
          gateways: gateways.data ?? [],
          services: services.data ?? [],
          lockIdentity: isEdit,
        })
      ) : shownTab === 'form' && formAvailable && hasAuto ? (
        <AutoForm
          type={type}
          spec={obj?.spec ?? {}}
          ns={formNs}
          onChange={(newSpec: any) => setText(yamlDump({ ...obj, spec: newSpec }))}
          header={
            // 자동 폼은 spec만 렌더하므로 이름/네임스페이스는 여기서 받는다 (필수).
            <div className="mb-5 grid grid-cols-2 gap-4 border-b border-base pb-5">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Name<span className="text-red-500">*</span></span>
                <input
                  className="input-base disabled:bg-gray-100 dark:disabled:bg-slate-800"
                  value={obj?.metadata?.name ?? ''}
                  disabled={isEdit}
                  onChange={(e) => setText(yamlDump({ ...obj, metadata: { ...obj?.metadata, name: e.target.value } }))}
                />
              </label>
              {rt.namespaced && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">Namespace<span className="text-red-500">*</span></span>
                  <input
                    className="input-base disabled:bg-gray-100 dark:disabled:bg-slate-800"
                    value={obj?.metadata?.namespace ?? ''}
                    disabled={isEdit}
                    onChange={(e) => setText(yamlDump({ ...obj, metadata: { ...obj?.metadata, namespace: e.target.value } }))}
                  />
                </label>
              )}
            </div>
          }
        />
      ) : (
        <YamlEditor value={text} onChange={setText} readOnly={readOnly} />
      )}

      <div className="panel-soft sticky bottom-0 z-10 -mb-6 mt-4 flex items-center gap-2 border-t border-base py-3 backdrop-blur">
        <button onClick={() => apply(true)} disabled={busy || cantApply} className="btn-ghost text-sm disabled:opacity-50">검증 (dry-run)</button>
        <button onClick={() => apply(false)} disabled={busy || cantApply} className="btn-primary text-sm disabled:opacity-50">적용</button>
        {isEdit && (
          <button onClick={del} disabled={busy || noDelete} title={noDelete ? '삭제 권한이 없습니다' : undefined} className="ml-auto rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10">삭제</button>
        )}
      </div>

      {pending && (
        <DangerConfirm
          name={pending.name}
          action={pending.action}
          onConfirm={() => { const run = pending.run; setPending(null); run() }}
          onCancel={() => setPending(null)}
        />
      )}

      {preview && (
        <DiffModal
          oldYaml={preview.oldYaml}
          newYaml={preview.newYaml}
          name={obj?.metadata?.name ?? name}
          dangerous={!!rt.dangerous}
          busy={busy}
          onConfirm={() => { setPreview(null); void doApply(false) }}
          onCancel={() => setPreview(null)}
        />
      )}

      {conflict && (
        <DiffModal
          title="⚠ 충돌 — 다른 곳에서 수정됨"
          subtitle="왼쪽(−) 최신 서버본 · 오른쪽(+) 내 수정본"
          confirmLabel="최신 위에 덮어쓰기"
          warn
          oldYaml={conflict.latestYaml}
          newYaml={conflict.mineYaml}
          name={obj?.metadata?.name ?? name}
          dangerous={false}
          busy={busy}
          onConfirm={() => { const rv = conflict.latestRV; setConflict(null); void forceOverwrite(rv) }}
          onCancel={() => setConflict(null)}
        />
      )}
    </div>
  )
}

function TabButton({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`-mb-px border-b-2 px-4 py-2 text-sm ${active ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-strong'} disabled:cursor-not-allowed disabled:opacity-40`}>
      {children}
    </button>
  )
}
