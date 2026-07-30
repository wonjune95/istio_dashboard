import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

// 대시보드를 거친 변경 히스토리 (서버 인메모리 — 파드 재시작 시 초기화).
export interface AuditEntry {
  time: string
  user?: string
  verb: 'create' | 'update' | 'delete'
  typeId: string
  namespace: string
  name: string
  ok: boolean
}

export function useAudit() {
  return useQuery({
    queryKey: ['audit'],
    queryFn: () => apiGet<AuditEntry[]>('/api/audit'),
    refetchInterval: 30_000, // 다른 사용자의 변경도 주기적으로 반영
  })
}
