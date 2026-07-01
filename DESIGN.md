# Istio 라우팅 관리 대시보드 — 설계문서 v4 (Production)

> **상태: v4 — Claude+Gemini 최종 합의 (2026-06-26). 미해결 0. P1 구현 개시.** "처음부터 실제 솔루션" 목표로 재설계. MVP 프레이밍 폐기 → 아키텍처는 프로덕션급으로 완결, 전달만 단계적(각 단계 프로덕션 품질). 인증/감사/실시간/관측성/테스트/Helm을 1급으로 편입.
> 결정: **인증 = OIDC 로그인 + 토큰 패스스루(K8s RBAC가 인가)**, **HTTPRoute + VirtualService 둘 다 1급**. 프레임워크는 각 레이어 합리적 표준.
> 비목표(투기적 과설계 금지): 멀티클러스터, 플러그인 시스템, 토폴로지/메트릭 시각화(=Kiali), 자체 인가체계.

---

## 0. 정의
Istio 라우팅(Gateway API `HTTPRoute` + Istio `VirtualService`)을 폼/YAML로 보고·만들고·고치고·지우는 단일 바이너리 웹 콘솔. 클러스터에 **사용자 권한으로 직접 적용**. Kong Manager / APISIX Dashboard의 Istio 판.

## 1. 핵심 원칙
- **K8s가 진실의 원천** — 자체 DB 없음. 모든 상태는 클러스터.
- **사용자 권한으로 동작** — 토큰 패스스루, K8s RBAC가 인가. 대시보드는 자체 권한체계를 만들지 않는다.
- **단일 바이너리·파드, 무상태** — 수평 확장/HA 자연스러움.
- **에어갭 가능** — 런타임 외부 의존 0(프론트 번들 인라인, CDN 없음).
- **안전 경계 불가침** — 인증, 쓰기 dry-run, 409 동시성, 입력검증은 안 깎음.

---

## 2. 시스템 아키텍처

```
  Browser (React SPA)
   │  1) OIDC Authorization Code + PKCE 로그인 → ID/Access 토큰
   │  2) 모든 /api 요청에 Authorization: Bearer <user token>
   ▼
┌──────────────────────────── Pod (N replica, 무상태) ─────────────────────────┐
│  Go 단일 바이너리 :8080  (net/http, Go 1.22 ServeMux)                          │
│   ├─ /healthz /readyz /metrics                                                │
│   ├─ auth      : OIDC 토큰 검증(issuer/aud), 클레임에서 user identity 추출     │
│   │             dev 모드면 우회(로컬 kubeconfig)                              │
│   ├─ /api/*    : JSON 핸들러 → 요청별 user 토큰으로 K8s 클라이언트 생성        │
│   ├─ /api/stream : per-user watch 기반 SSE(실시간 변경 push)                  │
│   ├─ k8s/RouteProvider : HTTPRoute / VirtualService 공통 라이프사이클          │
│   │             list/get/create/update/delete + DryRun  (+ Gateway RO)        │
│   ├─ audit     : 쓰기마다 {user, kind, ns/name, verb, rV, 결과} 구조화 로그   │
│   └─ /*        : embed.FS (빌드된 React)                                       │
└───────────────────────────────────┬──────────────────────────────────────────┘
        per-request: 사용자 토큰     │      pod SA(최소): CRD discovery만
                                     ▼
                         Kubernetes API Server
                          (OIDC authenticator 신뢰; RBAC가 per-user 인가)
                                     │
                       HTTPRoute · VirtualService · Gateway
```

**인증/인가 흐름**
- 클러스터 API 서버가 **동일 OIDC issuer를 신뢰**하도록 구성(`--oidc-issuer-url` 등) — 프로덕션 전제. 사용자 OIDC 토큰이 K8s에 직접 유효.
- 백엔드 핵심은 **범용 Bearer 토큰 패스스루** — 요청의 Bearer를 **그 토큰으로 K8s rest.Config 생성**에 그대로 실어 보냄 → 모든 읽기·쓰기·watch가 사용자로 수행 → **RBAC가 인가**. 대시보드는 인가 판단을 하지 않는다(403은 K8s가 준다).
- **OIDC 검증은 얇은 선택 레이어**(issuer/aud/만료 확인 → 조기 401 + 감사용 identity 추출). 끄면 비-OIDC 환경(사용자 SA 토큰)·dev(로컬 kubeconfig)도 코드 변경 없이 동작 — 패스스루가 토큰 종류를 안 가리기 때문.
- 토큰 갱신은 프론트 OIDC refresh. 세션은 토큰만(서버 무상태).
- **dev 모드**(`--dev`): OIDC 생략, 로컬 kubeconfig 사용(docker-desktop 개발용).
- **dev 안전가드(필수)**: 인클러스터(`KUBERNETES_SERVICE_HOST` 존재) 감지 시 `--dev`면 인증 우회 방지 위해 **부팅 거부(즉시 종료)**. dev는 로컬 전용.

**실시간**
- 공유 informer 캐시 안 씀(SA 기반이면 per-user 인가가 깨짐). 대신 클라이언트가 `/api/stream` 연결 시 **사용자 토큰으로 namespace-scoped watch** 1개 → 변경 이벤트를 SSE로 push. 무상태 replica와 호환. 사내 운영 도구(동접 수십 명)라 watch/conn 비용 수용.
- **누수/재연결 방지(필수)**: 연결 종료(`r.Context().Done()`) 시 watch·고루틴 즉시 해제. 끊김 시 마지막 `resourceVersion`부터 재연결. 프론트는 Tab Visibility API로 비활성 탭 SSE 일시중단(중복연결 방지).
- **전체 NS 뷰(ns=all) 제약**: 클러스터 범위 watch 권한이 필요. 권한 없으면 실시간 대신 수동 새로고침으로 폴백(또는 NS 1개 선택 시에만 실시간 활성).
- **SSE 전송 = fetch 기반(헤더 인증)**: 브라우저 네이티브 `EventSource`는 Authorization 헤더를 못 실어서 Bearer 패스스루와 충돌. → `@microsoft/fetch-event-source`로 Bearer 헤더 + `Last-Event-ID` 재연결. (단기 티켓 방식은 서버에 티켓↔세션 상태가 생겨 무상태 멀티레플리카를 깨뜨려서 채택 안 함.)

**개발 vs 프로덕션 빌드**
- dev: Vite :5173(HMR) → `/api` 프록시 → Go :8080(`--dev`). 
- prod: `npm run build`(Vite `build.outDir = ../internal/assets/dist`) → `go build`가 `internal/assets`에서 embed → 바이너리 하나. CI 한 줄(`make build`). *(embed는 .go 파일 기준 상대경로라 dist는 embed 패키지 옆에 위치)*

---

## 3. 리소스 모델 전략 (HTTPRoute + VirtualService)
- 둘은 구조가 달라 **단일 모델로 통합하지 않는다**(lossy 회피). 공유하는 건 **라이프사이클 인터페이스**뿐.
```go
type RouteProvider interface {
    Kind() string
    List(ctx, ns) ([]RouteSummary, error)          // 목록 공통 요약
    Get(ctx, ns, name) (RouteDetail, error)         // 타입별 모델 + raw
    Apply(ctx, obj, opts ApplyOptions) (RouteDetail, error) // create/update, DryRun 지원
    Delete(ctx, ns, name) error
    Watch(ctx, ns) (<-chan Event, error)            // SSE용
}
```
- 구현 2개: `httpRouteProvider`, `virtualServiceProvider`. Gateway는 RO 헬퍼.
- **공통 요약(RouteSummary)**: kind, namespace, name, hostnames, attachedTo(parentRefs/gateways), age, resourceVersion, **routeType**(http/tls/tcp) → 목록 테이블은 kind 컬럼으로 통합 표시.
- **비-http VirtualService 안전 처리(P2)**: VS는 한 리소스에 `http`/`tls`/`tcp` 라우트가 혼재 가능. `http`가 비고 tls/tcp만 있는 VS도 panic 없이 파싱 — hostnames 빈 배열 허용, routeType로 구분 표시(폼 편집은 http만, 나머지는 YAML 전용).
- **타입별 상세(RouteDetail)**: kind별 폼 모델 + `raw`(전체 객체, YAML 탭/고급필드 보존).

## 4. API 설계
| Method | Path | 설명 |
|---|---|---|
| GET | `/healthz` `/readyz` `/metrics` | 프로브/메트릭 |
| GET | `/api/capabilities` | Gateway API/Istio CRD 설치 여부, 버전, namespace 권한, dev여부 |
| GET | `/api/namespaces` | NS 목록 (403이면 빈 목록 + `namespaceListAllowed=false` → UI는 NS **수동 입력**으로 전환) |
| GET | `/api/gateways?ns=` | Gateway 목록 (RO, parentRef/gateways 선택용) |
| GET | `/api/services?ns=` | Service 목록 (RO, backendRef 선택 + 존재 경고용) |
| GET | `/api/routes?ns=&kind=&limit=&continue=` | 라우트 목록(HTTPRoute+VS 통합, kind/페이지네이션 필터) |
| GET | `/api/routes/{kind}/{ns}/{name}` | 단건 (타입별 모델 + raw) |
| POST | `/api/routes/{kind}?dryRun=true` | 생성 (dryRun=검증만) |
| PUT | `/api/routes/{kind}/{ns}/{name}?dryRun=true` | 수정 (rV 필수, 409 가능) |
| DELETE | `/api/routes/{kind}/{ns}/{name}` | 삭제 |
| GET | `/api/stream?ns=` | SSE 실시간 변경 스트림 |

- `kind` ∈ `HTTPRoute` | `VirtualService`. 목록의 `continue`는 K8s list pagination 토큰 패스스루.
- 모든 호출은 Bearer 토큰 필수(dev 제외). 인가 실패는 K8s 403을 그대로 매핑.
- **namespaces 403 폴백(토큰 패스스루 모델)**: 과거 v3의 "SA 자기 NS 폴백"은 per-user 모델에 안 맞음(SA NS는 사용자와 무관). 대신 빈 목록 + `namespaceListAllowed=false` 반환 → 프론트는 NS 드롭다운 대신 **수동 입력**을 띄우고, 입력한 NS로만 list/get/create 수행(그 NS에 권한 있으면 동작, 없으면 K8s가 403).
- **capabilities 자격증명 혼합**: CRD 설치 여부/버전은 **pod SA discovery**로, `user`·`namespaceListAllowed`는 **사용자 토큰**으로 판별(SelfSubject 권한 probe). 즉 capabilities는 SA+사용자 토큰 둘 다 사용.

### 4.1 JSON 계약(요지)
**capabilities**
```json
{"httpRouteInstalled":true,"virtualServiceInstalled":true,"gatewayAPIVersion":"v1","istioVersion":"1.24","namespaceListAllowed":true,"devMode":false,"user":"alice@corp.com"}
```
**routes 목록(요약)**
```json
[{"kind":"HTTPRoute","namespace":"default","name":"app","hostnames":["app.example.com"],"attachedTo":["istio-system/public-gw"],"age":"5m","resourceVersion":"12345"}]
```
**단건/쓰기 바디**: kind별 모델 + `resourceVersion`(수정 필수) + 응답엔 `raw` 동봉.
**에러 봉투**: `{"error":{"reason":"Conflict","message":"...","httpStatus":409}}` — `IsConflict`→409, `IsForbidden`→403, `IsInvalid`→422, `IsNotFound`→404, rV누락→400, 인증실패→401.

## 5. 쓰기 안전장치
1. 폼/YAML → 서버 객체 구성(사용자 토큰 클라이언트)
2. (선택)"검증" → `?dryRun=true` → `DryRun=All` → admission/스키마 결과만
3. "적용" → 단일 Create/Update(원자적, API서버 검증, 422면 무반영)
4. Update는 rV 동봉(없으면 400) → 충돌 시 409 → "다른 곳에서 수정됨, 새로고침"
5. **감사**: 모든 쓰기 성공/실패를 user identity와 함께 구조화 로그로 남김.

## 6. 관측성·운영
- **로깅**: `slog` JSON. 요청 로그 + 감사 로그.
- **메트릭**: `/metrics`(client_golang) — HTTP req count/latency by route, K8s op count/latency by verb/kind, watch 연결 수.
- **프로브**: `/healthz`(live), `/readyz`(API 서버 도달성 + discovery 성공 확인).
- **설정**: 12-factor, 플래그+env (`--addr`, `--dev`, `--kubeconfig`, `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`).
- **무상태**: replica N개 수평확장, 세션 스티키 불필요(토큰 기반).

---

## 7. 프로젝트 구조
```
istio_dashboard/
  cmd/server/main.go
  internal/
    assets/    assets.go      # 빌드된 React(dist) embed + SPA fallback 서빙 (Vite outDir 타깃)
    auth/      oidc.go        # 토큰 검증, 클레임→identity, dev 우회
    k8s/
      client.go               # 사용자 토큰→rest.Config; SA 클라(discovery 전용)
      discovery.go            # HTTPRoute/VS/Gateway CRD 존재·버전
      provider.go             # RouteProvider 인터페이스 + 공통 타입
      httproute.go            # 구현
      virtualservice.go       # 구현
      gateway.go              # RO
      watch.go                # per-user watch → Event 채널
    api/
      server.go               # ServeMux, 미들웨어(auth/log/recover), DI
      routes.go               # 라우트 핸들러
      stream.go               # SSE
      meta.go                 # capabilities/namespaces/gateways
      errors.go               # apierrors → 봉투
      audit.go                # 감사 로그
    observability/ metrics.go, logging.go
  web/                        # React(Vite) — §8
  deploy/helm/                # 차트(deployment/service/rbac/ingress/configmap/servicemonitor/values)
  test/                       # envtest 통합(+ Gateway API/Istio CRD 설치)
  Dockerfile  Makefile  go.mod
```
- 핸들러는 `Server` 구조체 메서드(클라이언트 팩토리·provider·logger 주입).

## 8. 프론트엔드 (React) — 스택
| 영역 | 선택 | 근거 |
|---|---|---|
| 빌드/언어 | Vite + React 18 + **TypeScript** | JSON 계약 타입화. |
| 인증 | **oidc-client-ts** (Auth Code + PKCE) | OIDC 로그인/토큰갱신 표준. |
| 라우팅 | React Router | 화면/딥링크. |
| 서버상태 | TanStack Query | 캐싱/무효화/뮤테이션 + SSE로 invalidate. |
| 폼 | react-hook-form + useFieldArray + **zod**(@hookform/resolvers) | 중첩 동적 배열 + 클라 1차 검증(**범위 한정**: 필수값·포트 1~65535 같은 경계값만. 스펙 정합성은 서버 dry-run에 위임 — 과한 zod는 정상 객체를 막음). |
| 컴포넌트 | shadcn/ui + Tailwind | 테이블/다이얼로그/토스트/폼, 접근성, 경량 번들. |
| YAML | CodeMirror + js-yaml | 구문강조 + 파싱/검증. |
| SSE 전송 | **@microsoft/fetch-event-source** | 네이티브 EventSource는 Authorization 헤더 불가 → fetch 기반으로 Bearer 헤더 + Last-Event-ID 재연결. |
- 모든 의존성 빌드 시 번들 인라인(에어갭). 

## 9. UI/UX 설계

### 9.1 정보구조
```
/login                         → OIDC 로그인(미인증 시 강제)
/                              → 라우트 목록(HTTPRoute+VS 통합 테이블)
/routes/new?kind=HTTPRoute|VirtualService → 생성(kind 선택 후 폼)
/routes/:kind/:ns/:name        → 상세/수정
/guard                         → CRD 미설치 안내(capabilities 미충족 시)
```
- 상단 바: 앱명 + **Namespace 필터**(전역) + **로그인 사용자/로그아웃** + "새 라우트(kind 선택)".
- 모든 데이터 화면 **loading/empty/error** 3상태 명시. SSE 끊김 시 재연결 + "오프라인" 표시.

### 9.2 화면
1. **Login** — OIDC 리다이렉트. 콜백 처리, 토큰 보관(메모리+refresh).
2. **CapabilityGuard** — `/api/capabilities`로 HTTPRoute/VS 설치 여부 확인. 둘 다 없으면 설치 안내. 하나만 있으면 그 kind만 활성.
3. **RouteList** — 통합 테이블(kind/ns/name/hostnames/attachedTo/age/액션). NS 필터, kind 필터, 페이지네이션(continue). 권한제한 배너. **SSE로 실시간 갱신**(추가/수정/삭제 반영).
4. **RouteEdit(kind별)** — Form 탭(kind 전용 컴포넌트: HTTPRouteForm / VirtualServiceForm) + YAML 탭(CodeMirror, `raw`). 
   - HTTPRouteForm: parentRefs(Gateway 드롭다운) → hostnames → rules(matches.path + backendRefs service/port/weight, weight 합계). backendRef 대상이 `/api/services`에 없으면 **경고 배지**(차단 아님 — dry-run이 못 잡는 참조 유효성 보완).
   - VirtualServiceForm: hosts → gateways → http[](match + route weight/destination host:subset:port + 선택 fault/redirect 등 핵심).
   - namespace 기본값=전역 필터, 변경 시 오배포 확인.
   - 액션: 검증(dryRun)/적용/취소. **422 시 YAML 탭으로 포커스+위치 하이라이트**. zod 1차검증.
5. **삭제** — 확인 다이얼로그(kind+name).
6. **토스트** — 401→재로그인, 403→권한부족, 409→충돌 새로고침, 422→검증 메시지.

### 9.3 폼↔YAML 동기화 가드(안전 경계)
- Form→YAML 항상 허용(폼 상태를 `raw`에 머지 직렬화).
- YAML→Form은 **폼 표현 가능 부분집합으로 무손실 라운드트립될 때만**. 폼이 모르는 필드/파싱에러면 Form 탭 잠그고 "YAML 전용" 배지 → 유실 방지.
- 적용은 활성 탭 기준(Form→모델 / YAML→raw).

---

### 9.4 웹 보안 모델
- **동일 출처**: Go가 UI+API를 같은 출처(:8080)에서 서빙 → CORS 불필요. **permissive CORS를 켜지 않는다**(필요 시 허용 출처 명시적 화이트리스트만).
- **CSRF 미적용(의도적)**: 인증이 `Authorization: Bearer` 헤더 기반(쿠키 ambient 인증 아님) → CSRF 공격 표면 없음. 토큰은 쿠키에 안 싣는다(메모리 보관 + OIDC refresh).
- 표준 보안 헤더(CSP 등)는 정적 서빙에 부여.

## 10. 테스트 전략
- **단위**: 모델 변환(HTTPRoute/VS ↔ 폼모델), 에러 매핑, 토큰 검증, provider 로직.
- **통합**: `sigs.k8s.io/controller-runtime/envtest`로 실제 API 서버+etcd 기동, Gateway API·Istio CRD 설치 후 CRUD/dryRun/409 검증.
- **e2e(선택)**: kind 클러스터 + 실제 OIDC(dex) 스모크.
- **CI**: GitHub Actions — lint(golangci-lint, eslint) + 단위 + envtest + 프론트 빌드.

## 11. 배포
- **Helm 차트**: deployment(replica/probe/securityContext: non-root·readOnlyRootFS), service, rbac(아래), ingress(+외부 인증 옵션), configmap(OIDC), servicemonitor.
- **RBAC**: 대시보드 pod SA는 **discovery/capabilities 최소 권한만**. 실제 라우트 읽기/쓰기 권한은 **사용자에게** (각 사용자 K8s RBAC) — 운영자는 viewer/editor ClusterRole 예시 제공(httproutes/virtualservices/gateways/namespaces).
- 이미지: 멀티스테이지(node→go→distroless/static, non-root).

## 12. 전달 단계 (각 단계 프로덕션 품질, 버려지는 MVP 아님)
- **P1 — 골격+인증**: 서버/ServeMux/프로브/메트릭/로깅, OIDC 검증(+dev 우회, **dev 안전가드**), **요청 미들웨어가 Bearer→K8s client 빌드 후 `r.Context()` 주입**(하위 핸들러는 context에서 꺼내씀 → P2/P3 재작업 방지), 사용자토큰 K8s 클라, capabilities/namespaces, React 셸+로그인+CapabilityGuard. 단위테스트.
- **P2 — 읽기(양 kind)**: RouteProvider + HTTPRoute·VirtualService List/Get, gateways, RouteList 통합 테이블+필터+페이지네이션. envtest 통합.
- **P3 — 쓰기**: Apply(create/update)+dryRun+delete+409, 양 kind 폼(Form/YAML 탭, 동기화 가드, zod, 422 동선), 감사 로그.
- **P4 — 실시간**: per-user watch → SSE, 프론트 실시간 반영/재연결.
- **P5 — 운영화**: Helm 차트, securityContext, ServiceMonitor, CI 완비, e2e 스모크, 문서.

## 13. 미해결
- 없음(v4 설계 확정, Claude+Gemini 합의). VirtualServiceForm 폼 노출 깊이(fault/mirror/retry 등)는 P3에서 사용량 보고 확정 — 그 전까진 핵심(match/route/weight)만 폼, 나머지 YAML 탭.
