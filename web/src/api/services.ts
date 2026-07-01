import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

export interface ServiceRef {
  namespace: string
  name: string
  ports: number[]
}

export function useServices(ns: string) {
  return useQuery({
    queryKey: ['services', ns],
    queryFn: () => apiGet<ServiceRef[]>(`/api/services?ns=${ns}`),
    enabled: !!ns,
  })
}
