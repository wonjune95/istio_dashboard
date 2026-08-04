package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"istio-dashboard/internal/auth"
	"istio-dashboard/internal/k8s"
)

// ClientSource is the k8s.ClientFactory surface the handlers depend on,
// abstracted so tests can substitute fakes.
type ClientSource interface {
	Base() (*k8s.Clients, error)
	ResolveType(typeID string) (k8s.ResolvedType, error)
	CatalogCached() ([]k8s.ResolvedType, error)
	DetectCRDs() (k8s.CRDInfo, error)
	SpecSchema(typeID string) (json.RawMessage, error)
	IstiodVersion(ctx context.Context) string
}

// Server holds injected dependencies and exposes the JSON API handlers.
type Server struct {
	dev      bool
	factory  ClientSource
	accounts *auth.Store
	sessions *auth.Sessions

	auditMu  sync.Mutex
	auditLog []AuditEntry // newest first, capped at auditKeep
}

func NewServer(dev bool, factory ClientSource, accounts *auth.Store, sessions *auth.Sessions) *Server {
	return &Server{dev: dev, factory: factory, accounts: accounts, sessions: sessions}
}

// Routes registers the /api/* handlers on mux. Probes, /metrics and static assets
// are wired in main.
func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	mux.Handle("GET /api/capabilities", s.withAuth(http.HandlerFunc(s.handleCapabilities)))
	mux.Handle("GET /api/resourceTypes", s.withAuth(http.HandlerFunc(s.handleResourceTypes)))
	mux.Handle("GET /api/resourceTypes/{type}/schema", s.withAuth(http.HandlerFunc(s.handleResourceSchema)))
	mux.Handle("GET /api/access/{type}/{ns}/{name}", s.withAuth(http.HandlerFunc(s.handleAccess)))
	mux.Handle("GET /api/namespaces", s.withAuth(http.HandlerFunc(s.handleNamespaces)))
	mux.Handle("GET /api/gateways", s.withAuth(http.HandlerFunc(s.handleGateways)))
	mux.Handle("GET /api/services", s.withAuth(http.HandlerFunc(s.handleServices)))
	mux.Handle("GET /api/subsets", s.withAuth(http.HandlerFunc(s.handleSubsets)))
	mux.Handle("GET /api/audit", s.withAuth(http.HandlerFunc(s.handleAudit)))
	// Unmatched /api/* returns JSON 404 (not the SPA index.html fallback).
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "NotFound", "no such API endpoint: "+r.URL.Path)
	})
	// Generic resource engine (any registered kind, typeID = resource.group).
	mux.Handle("GET /api/resources/{type}", s.withAuth(http.HandlerFunc(s.handleListResources)))
	mux.Handle("GET /api/resources/{type}/{ns}/{name}", s.withAuth(http.HandlerFunc(s.handleGetResource)))
	mux.Handle("POST /api/resources/{type}", s.withAuth(http.HandlerFunc(s.handleCreateResource)))
	mux.Handle("PUT /api/resources/{type}/{ns}/{name}", s.withAuth(http.HandlerFunc(s.handleUpdateResource)))
	mux.Handle("DELETE /api/resources/{type}/{ns}/{name}", s.withAuth(http.HandlerFunc(s.handleDeleteResource)))
}

// withAuth authenticates the session cookie (ArgoCD-style app auth), enforces
// the role on mutating methods, and injects the shared SA-backed client plus the
// user's identity into the context. Dev mode skips the session entirely.
func (s *Server) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := auth.Identity{Name: "dev", Role: "admin"}
		if !s.dev {
			c, err := r.Cookie(sessionCookie)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "Unauthorized", "로그인이 필요합니다")
				return
			}
			id, err = s.sessions.Parse(c.Value)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "Unauthorized", err.Error())
				return
			}
		}
		if r.Method != http.MethodGet && !id.CanWrite() {
			writeError(w, http.StatusForbidden, "Forbidden", "viewer 역할은 변경할 수 없습니다")
			return
		}
		client, err := s.factory.Base()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Internal", err.Error())
			return
		}
		ctx := withIdentity(withClient(r.Context(), client), id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
