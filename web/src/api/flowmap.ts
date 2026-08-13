import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

export type FlowBackend = {
  namespace?: string
  name: string
  port?: number
  external?: boolean
  exists: boolean
  endpoints: number
}
export type FlowRoute = {
  kind: 'VirtualService' | 'HTTPRoute'
  typeId: string
  namespace: string
  name: string
  hosts: string[]
  gateways: string[]
  backends: FlowBackend[]
}
export type FlowGateway = {
  kind: 'Gateway' | 'IstioGateway'
  typeId: string
  namespace: string
  name: string
  hosts: string[]
}
export type FlowMap = { gateways: FlowGateway[]; routes: FlowRoute[] }

export function useFlowMap() {
  return useQuery({
    queryKey: ['flowmap'],
    queryFn: () => apiGet<FlowMap>('/api/flowmap'),
    refetchInterval: 30_000,
  })
}
