// P1: OIDC login is wired in a later step. In dev mode the backend uses the local
// kubeconfig and ignores bearer tokens, so returning null is correct here. The real
// oidc-client-ts UserManager plugs in at this seam, returning the access token.
export function getToken(): string | null {
  return null
}
