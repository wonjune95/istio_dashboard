import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from './client'

export type PodRef = { name: string; containers: string[]; mesh: boolean; ready: boolean }

export type RequestTestResult = {
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  durationMs: number
  truncated?: boolean
  error?: string
  hint?: string
}

// 요청 테스터가 켜진 admin에게만 응답한다 (아니면 403).
export function usePods(ns: string, enabled: boolean) {
  return useQuery({
    queryKey: ['pods', ns],
    queryFn: () => apiGet<PodRef[]>(`/api/pods${ns ? `?ns=${encodeURIComponent(ns)}` : ''}`),
    enabled,
    staleTime: 30_000,
  })
}

// 실제 HTTP 요청을 고른 파드 안에서 보낸다 — 부작용이 있는 동작이다.
export function sendRequestTest(input: {
  namespace: string
  pod: string
  container: string
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}) {
  return apiPost<RequestTestResult>('/api/requesttest', input)
}
