import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

export type Cluster = { name: string }

// "local" + Secret에 등록된 원격 클러스터 목록 (헤더 드롭다운·설정 패널 공용).
export function useClusters() {
  return useQuery({
    queryKey: ['clusters'],
    queryFn: () => apiGet<Cluster[]>('/api/clusters'),
    staleTime: 60_000,
  })
}
