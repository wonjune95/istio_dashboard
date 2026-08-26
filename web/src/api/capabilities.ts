import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

// Matches the backend capabilities contract (DESIGN.md §4.1).
export interface Capabilities {
  httpRouteInstalled: boolean
  virtualServiceInstalled: boolean
  gatewayAPIVersion?: string
  istioApiVersion?: string
  istiodVersion?: string // 컨트롤플레인 실제 버전, e.g. "1.30.2"
  namespaceListAllowed: boolean
  devMode: boolean
  user?: string
  role?: string // admin | editor | viewer
  mustChangePassword?: boolean // 초기 비밀번호(admin) 그대로 — 변경 전까지 화면 잠금
  requestTester?: boolean // 실제 요청 테스터 활성화 (헬름 opt-in, admin 전용)
}

export function useCapabilities() {
  return useQuery({
    queryKey: ['capabilities'],
    queryFn: () => apiGet<Capabilities>('/api/capabilities'),
    staleTime: 5 * 60 * 1000,
  })
}
