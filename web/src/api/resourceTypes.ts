import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

export type Category = 'traffic' | 'security' | 'telemetry' | 'gateway-api'

export interface ResourceType {
  kind: string
  group: string
  resource: string
  namespaced: boolean
  category: Category
  typeId: string
  version?: string
  installed: boolean
  dangerous: boolean
  formCapable: boolean
}

export function useResourceTypes() {
  return useQuery({
    queryKey: ['resourceTypes'],
    queryFn: () => apiGet<ResourceType[]>('/api/resourceTypes'),
    staleTime: 5 * 60 * 1000,
  })
}

export const CATEGORY_LABELS: Record<Category, string> = {
  traffic: 'Traffic',
  security: 'Security',
  telemetry: 'Telemetry',
  'gateway-api': 'Gateway API',
}
