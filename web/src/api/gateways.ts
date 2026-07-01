import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

export interface GatewayRef {
  type: 'gateway-api' | 'istio'
  namespace: string
  name: string
}

export function useGateways(ns: string) {
  return useQuery({
    queryKey: ['gateways', ns],
    queryFn: () => apiGet<GatewayRef[]>(`/api/gateways?ns=${ns}`),
    enabled: !!ns,
  })
}
