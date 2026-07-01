import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

// Spec OpenAPI schema for a kind (backend extracts it from the CRD).
export function useSchema(type: string, enabled: boolean) {
  return useQuery({
    queryKey: ['schema', type],
    queryFn: () => apiGet<Record<string, unknown>>(`/api/resourceTypes/${type}/schema`),
    enabled,
    staleTime: Infinity, // schemas are stable for the life of the process
  })
}
