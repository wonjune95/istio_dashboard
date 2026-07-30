package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"

	"istio-dashboard/internal/auth"
	"istio-dashboard/internal/k8s"
)

// ClientSource is the k8s.ClientFactory surface the handlers depend on,
// abstracted so tests can substitute fakes.
type ClientSource interface {
	ForToken(bearerToken string) (*k8s.Clients, error)
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
	verifier auth.Verifier

	auditMu  sync.Mutex
	auditLog []AuditEntry // newest first, capped at auditKeep
}

func NewServer(dev bool, factory ClientSource, verifier auth.Verifier) *Server {
	return &Server{dev: dev, factory: factory, verifier: verifier}
}

// Routes registers the /api/* handlers on mux. Probes, /metrics and static assets
// are wired in main.
func (s *Server) Routes(mux *http.ServeMux) {
	mux.Handle("GET /api/capabilities", s.withK8s(http.HandlerFunc(s.handleCapabilities)))
	mux.Handle("GET /api/resourceTypes", s.withK8s(http.HandlerFunc(s.handleResourceTypes)))
	mux.Handle("GET /api/resourceTypes/{type}/schema", s.withK8s(http.HandlerFunc(s.handleResourceSchema)))
	mux.Handle("GET /api/access/{type}/{ns}/{name}", s.withK8s(http.HandlerFunc(s.handleAccess)))
	mux.Handle("GET /api/namespaces", s.withK8s(http.HandlerFunc(s.handleNamespaces)))
	mux.Handle("GET /api/gateways", s.withK8s(http.HandlerFunc(s.handleGateways)))
	mux.Handle("GET /api/services", s.withK8s(http.HandlerFunc(s.handleServices)))
	mux.Handle("GET /api/subsets", s.withK8s(http.HandlerFunc(s.handleSubsets)))
	mux.Handle("GET /api/audit", s.withK8s(http.HandlerFunc(s.handleAudit)))
	// Unmatched /api/* returns JSON 404 (not the SPA index.html fallback).
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "NotFound", "no such API endpoint: "+r.URL.Path)
	})
	// Generic resource engine (any registered kind, typeID = resource.group).
	mux.Handle("GET /api/resources/{type}", s.withK8s(http.HandlerFunc(s.handleListResources)))
	mux.Handle("GET /api/resources/{type}/{ns}/{name}", s.withK8s(http.HandlerFunc(s.handleGetResource)))
	mux.Handle("POST /api/resources/{type}", s.withK8s(http.HandlerFunc(s.handleCreateResource)))
	mux.Handle("PUT /api/resources/{type}/{ns}/{name}", s.withK8s(http.HandlerFunc(s.handleUpdateResource)))
	mux.Handle("DELETE /api/resources/{type}/{ns}/{name}", s.withK8s(http.HandlerFunc(s.handleDeleteResource)))
}

// withK8s authenticates the request (OIDC optional) and injects a per-request
// user-scoped Kubernetes client + identity into the context.
func (s *Server) withK8s(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := auth.BearerFrom(r)
		id, err := s.verifier.Verify(r.Context(), token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Unauthorized", err.Error())
			return
		}
		client, err := s.factory.ForToken(token)
		if err != nil {
			if errors.Is(err, k8s.ErrTokenRequired) {
				writeError(w, http.StatusUnauthorized, "Unauthorized", err.Error())
			} else {
				writeError(w, http.StatusInternalServerError, "Internal", err.Error())
			}
			return
		}
		ctx := withIdentity(withClient(r.Context(), client), id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
