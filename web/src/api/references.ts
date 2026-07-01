import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

// Reference resolution for auto-form fields (host/gateway/subset): turns opaque
// text fields into suggest-as-you-type dropdowns linked to real cluster resources,
// with existence warnings — without forcing the value (free text stays valid, so
// external hosts / cross-ns refs don't break). Datalist, not <select>.
export type RefKind = 'service' | 'gateway' | 'subset'

export interface RefOption {
  value: string // canonical value inserted/matched
  label: string // shown in the datalist
  aliases?: string[] // other accepted spellings (FQDN variants, ns/name)
  navTypeId?: string // resource type to "go to" (none for core Services)
  navNs?: string
  navName?: string
  host?: string // subset scoping
}

interface ServiceRef { namespace: string; name: string; ports: number[] }
interface GatewayRef { type: 'gateway-api' | 'istio'; namespace: string; name: string }
interface SubsetRef { namespace: string; dr: string; host: string; name: string }

const ENDPOINT: Record<RefKind, string> = {
  service: 'services',
  gateway: 'gateways',
  subset: 'subsets',
}

const ISTIO_GW = 'gateways.networking.istio.io'
const GWAPI_GW = 'gateways.gateway.networking.k8s.io'
const DR_TYPE = 'destinationrules.networking.istio.io'

function normalize(kind: RefKind, raw: unknown): RefOption[] {
  if (!Array.isArray(raw)) return []
  if (kind === 'service') {
    return (raw as ServiceRef[]).map((s) => ({
      value: s.name,
      label: `${s.name} (${s.namespace})`,
      aliases: [`${s.name}.${s.namespace}`, `${s.name}.${s.namespace}.svc`, `${s.name}.${s.namespace}.svc.cluster.local`],
    }))
  }
  if (kind === 'gateway') {
    return (raw as GatewayRef[]).map((g) => ({
      value: g.name,
      label: `${g.name} (${g.type})`,
      aliases: [`${g.namespace}/${g.name}`],
      navTypeId: g.type === 'istio' ? ISTIO_GW : GWAPI_GW,
      navNs: g.namespace,
      navName: g.name,
    }))
  }
  return (raw as SubsetRef[]).map((s) => ({
    value: s.name,
    label: `${s.name} → ${s.host}`,
    navTypeId: DR_TYPE,
    navNs: s.namespace,
    navName: s.dr,
    host: s.host,
  }))
}

export function useReferenceOptions(kind: RefKind, ns: string) {
  return useQuery({
    queryKey: ['ref', kind, ns],
    queryFn: () => apiGet<unknown>(`/api/${ENDPOINT[kind]}?ns=${ns}`),
    enabled: !!ns,
    staleTime: 30_000,
    select: (raw) => normalize(kind, raw),
  })
}
