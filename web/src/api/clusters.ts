import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

export type Cluster = { name: string; connected?: boolean; version?: string; error?: string }

// "local" + Secret에 등록된 원격 클러스터 목록. status=true면 연결 상태·버전 포함
// (병렬 ping — 설정 패널용, 헤더 드롭다운은 빠른 무상태 목록).
export function useClusters(status = false) {
  return useQuery({
    queryKey: ['clusters', status],
    queryFn: () => apiGet<Cluster[]>(`/api/clusters${status ? '?status=true' : ''}`),
    staleTime: 60_000,
  })
}
