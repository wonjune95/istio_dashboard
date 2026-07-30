// Bearer-token seam (DESIGN.md §2). The token is kept in sessionStorage only —
// never persisted to disk — and passed through to the Kubernetes API by the
// backend, so RBAC authorizes every call as this identity. An OIDC UserManager
// can later replace setToken() as the writer at this same seam.
const KEY = 'istio-dashboard.token'

export function getToken(): string | null {
  return sessionStorage.getItem(KEY)
}

export function setToken(token: string) {
  sessionStorage.setItem(KEY, token.trim())
}

export function clearToken() {
  sessionStorage.removeItem(KEY)
}
