import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

export type Access = Record<string, boolean>

// SelfSubjectAccessReview for the given verbs (e.g. "update,delete" or "create").
// Drives read-only UI when the user lacks permission (Gemini gap #1).
export function useAccess(type: string, ns: string, name: string, verbs: string, enabled: boolean) {
  return useQuery({
    queryKey: ['access', type, ns, name, verbs],
    queryFn: () => apiGet<Access>(`/api/access/${type}/${ns || '-'}/${name || '-'}?verbs=${verbs}`),
    enabled,
    staleTime: 60_000,
  })
}
