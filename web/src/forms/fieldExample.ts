// Light-gray example placeholders for common Istio/Gateway API fields, so an empty
// form shows the expected shape ("아 이런 형식이구나") instead of a blank box.
// Same fallback chain as fieldHelp: "{typeId}/{field}" then global "{field}".
// Only curated fields get an example — a wrong guess is worse than none.
const EXAMPLE: Record<string, string> = {
  host: '예: reviews 또는 reviews.default.svc.cluster.local',
  hosts: '예: bookinfo.com',
  hostnames: '예: bookinfo.com',
  gateways: '예: my-gateway (사이드카는 mesh)',
  subset: '예: v1',
  number: '예: 8080',
  port: '예: 8080',
  weight: '예: 50',
  timeout: '예: 5s',
  protocol: '예: HTTP / HTTPS / TCP / TLS / GRPC',
  resolution: '예: DNS / STATIC / NONE',
  location: '예: MESH_EXTERNAL',
  action: '예: ALLOW / DENY / AUDIT',
  prefix: '예: /api',
  uri: '예: /v1/products',
  exportTo: '예: . (현재 NS) 또는 *',
  address: '예: 10.0.0.1',
  mode: '예: SIMPLE / MUTUAL',
  credentialName: '예: my-tls-secret',
  value: '예: 텍스트 값',
}

export function fieldExample(typeId: string, field: string): string | undefined {
  return EXAMPLE[`${typeId}/${field}`] ?? EXAMPLE[field]
}
