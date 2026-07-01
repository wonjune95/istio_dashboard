import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

// Matches the backend capabilities contract (DESIGN.md §4.1).
export interface Capabilities {
  httpRouteInstalled: boolean
  virtualServiceInstalled: boolean
  gatewayAPIVersion?: string
  istioApiVersion?: string
  namespaceListAllowed: boolean
  devMode: boolean
  user?: string
}

export function useCapabilities() {
  return useQuery({
    queryKey: ['capabilities'],
    queryFn: () => apiGet<Capabilities>('/api/capabilities'),
    staleTime: 5 * 60 * 1000,
  })
}
