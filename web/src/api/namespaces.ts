import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

export function useNamespaces() {
  return useQuery({
    queryKey: ['namespaces'],
    queryFn: () => apiGet<string[]>('/api/namespaces'),
    staleTime: 5 * 60 * 1000,
  })
}
