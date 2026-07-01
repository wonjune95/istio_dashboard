// Korean help text for common Istio/Gateway API fields, shown under each input.
// Lookup is a fallback chain (Gemini ②): "{typeId}/{field}" for collision-prone
// fields, else the global "{field}".
const HELP: Record<string, string> = {
  name: '리소스 이름',
  namespace: '네임스페이스',
  hosts: '이 라우팅이 적용될 호스트(도메인). 예: reviews.prod.svc.cluster.local, bookinfo.com',
  host: '트래픽 대상 K8s 서비스 이름(서비스 레지스트리 기준)',
  gateways: '이 설정을 묶을 Gateway 이름들. "mesh"면 사이드카(동서 트래픽)에 적용',
  http: 'HTTP 트래픽 라우팅 규칙 목록(위에서부터 순서대로 매칭)',
  tcp: 'TCP(불투명) 트래픽 라우팅 규칙',
  tls: 'TLS/HTTPS(비종단) 라우팅 규칙(SNI 기반)',
  route: '트래픽을 보낼 목적지 목록(weight로 비율 분배)',
  destination: '트래픽을 받을 서비스',
  port: '대상 포트',
  number: '포트 번호',
  subset: 'DestinationRule에 정의된 서브셋(버전) 이름',
  weight: '이 목적지로 보낼 트래픽 비율(0~100)',
  trafficPolicy: '로드밸런싱·커넥션풀·이상감지(circuit breaking) 정책',
  subsets: '서비스의 버전별 하위집합(라벨로 구분)',
  exportTo: '노출 범위. "." = 현재 네임스페이스, "*" = 전체',
  selector: '이 설정을 적용할 워크로드(파드) 라벨 셀렉터',
  workloadSelector: '이 설정을 적용할 워크로드(파드) 라벨 셀렉터',
  servers: 'Gateway가 수신할 포트/프로토콜/호스트 목록',
  protocol: '프로토콜(HTTP, HTTPS, TCP, TLS, GRPC …)',
  resolution: '서비스 디스커버리 방식(DNS, STATIC, NONE)',
  location: 'MESH_INTERNAL(메시 내부) 또는 MESH_EXTERNAL(외부)',
  action: '정책 동작: ALLOW · DENY · AUDIT · CUSTOM',
  rules: '규칙 목록',
  match: '규칙이 적용될 조건(매치)',
  redirect: '요청을 다른 URL/호스트로 리다이렉트',
  rewrite: 'URI/호스트 재작성',
  fault: '장애 주입(지연/중단) — 카오스 테스트용',
  retries: '재시도 정책(횟수/타임아웃/조건)',
  timeout: '요청 타임아웃(예: 5s)',
  mirror: '트래픽 미러링(섀도잉) 대상 서비스',
  headers: '요청/응답 헤더 추가·수정·삭제',
  parentRefs: '이 라우트를 붙일 Gateway(또는 상위 리소스)',
  hostnames: '이 라우트가 매칭할 호스트네임',
  backendRefs: '트래픽을 보낼 백엔드 서비스(weight로 분배)',
}

export function fieldHelp(typeId: string, field: string): string | undefined {
  return HELP[`${typeId}/${field}`] ?? HELP[field]
}
