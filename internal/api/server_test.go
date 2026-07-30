package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubefake "k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"

	"istio-dashboard/internal/auth"
	"istio-dashboard/internal/k8s"
)

var vsGVR = schema.GroupVersionResource{Group: "networking.istio.io", Version: "v1", Resource: "virtualservices"}

const vsTypeID = "virtualservices.networking.istio.io"

// stubSource implements ClientSource for handler tests.
type stubSource struct {
	clients     *k8s.Clients
	forTokenErr error
}

func (s *stubSource) ForToken(string) (*k8s.Clients, error) {
	return s.clients, s.forTokenErr
}

func (s *stubSource) ResolveType(typeID string) (k8s.ResolvedType, error) {
	if typeID != vsTypeID {
		return k8s.ResolvedType{}, errors.New("unknown resource type: " + typeID)
	}
	return k8s.ResolvedType{
		ResourceType: k8s.ResourceType{Kind: "VirtualService", Group: vsGVR.Group, Resource: vsGVR.Resource, Namespaced: true},
		TypeID:       vsTypeID,
		Version:      vsGVR.Version,
		Installed:    true,
		GVR:          vsGVR,
	}, nil
}

func (s *stubSource) CatalogCached() ([]k8s.ResolvedType, error) { return nil, nil }
func (s *stubSource) DetectCRDs() (k8s.CRDInfo, error)           { return k8s.CRDInfo{}, nil }
func (s *stubSource) SpecSchema(string) (json.RawMessage, error) { return nil, errors.New("none") }

func newTestMux(t *testing.T, source ClientSource) *http.ServeMux {
	t.Helper()
	verifier, err := auth.NewVerifier(context.Background(), "", "") // noop (no OIDC)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	NewServer(false, source, verifier).Routes(mux)
	return mux
}

// captureLogs redirects slog to a buffer and returns the emitted JSON records.
func captureLogs(t *testing.T) func() []map[string]any {
	t.Helper()
	var buf bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })
	return func() []map[string]any {
		var out []map[string]any
		for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
			if line == "" {
				continue
			}
			var rec map[string]any
			if err := json.Unmarshal([]byte(line), &rec); err == nil {
				out = append(out, rec)
			}
		}
		return out
	}
}

// A request without a bearer token must be rejected as 401 — never silently
// served with the pod ServiceAccount identity.
func TestWithK8s_MissingTokenIs401(t *testing.T) {
	mux := newTestMux(t, &stubSource{forTokenErr: k8s.ErrTokenRequired})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/resourceTypes", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestWithK8s_FactoryFailureIs500(t *testing.T) {
	mux := newTestMux(t, &stubSource{forTokenErr: errors.New("boom")})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/resourceTypes", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func fakeDynamicClients(seed ...runtime.Object) (*k8s.Clients, *dynamicfake.FakeDynamicClient) {
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(
		runtime.NewScheme(),
		map[schema.GroupVersionResource]string{vsGVR: "VirtualServiceList"},
		seed...,
	)
	return &k8s.Clients{Dynamic: dyn}, dyn
}

const vsBody = `{
	"apiVersion": "networking.istio.io/v1",
	"kind": "VirtualService",
	"metadata": {"name": "app", "namespace": "default"},
	"spec": {"hosts": ["app.example.com"]}
}`

func findAudit(records []map[string]any) map[string]any {
	for _, r := range records {
		if r["audit"] == true {
			return r
		}
	}
	return nil
}

func TestCreateResource_SuccessIsAudited(t *testing.T) {
	logs := captureLogs(t)
	clients, _ := fakeDynamicClients()
	mux := newTestMux(t, &stubSource{clients: clients})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/resources/"+vsTypeID, strings.NewReader(vsBody)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rec.Code, rec.Body.String())
	}

	audit := findAudit(logs())
	if audit == nil {
		t.Fatal("no audit record emitted")
	}
	if audit["namespace"] != "default" || audit["name"] != "app" || audit["verb"] != "create" {
		t.Errorf("audit = %v, want create default/app", audit)
	}
}

// A create rejected by the API server must still be audited with the intended
// namespace/name from the request body — "who tried what where" is the point
// of the audit log.
func TestCreateResource_FailureAuditKeepsTarget(t *testing.T) {
	logs := captureLogs(t)
	clients, dyn := fakeDynamicClients()
	dyn.PrependReactor("create", "virtualservices", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("admission webhook denied")
	})
	mux := newTestMux(t, &stubSource{clients: clients})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/resources/"+vsTypeID, strings.NewReader(vsBody)))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500: %s", rec.Code, rec.Body.String())
	}

	audit := findAudit(logs())
	if audit == nil {
		t.Fatal("no audit record emitted")
	}
	if audit["namespace"] != "default" || audit["name"] != "app" {
		t.Errorf("failed-create audit lost its target: %v, want default/app", audit)
	}
}

// Capabilities must not answer 200 for a token Kubernetes rejects — CRD info
// comes from SA discovery, so without this check an invalid token slips past
// the login gate into a UI where every later call 401s.
func TestCapabilities_InvalidTokenIs401(t *testing.T) {
	kube := kubefake.NewClientset()
	kube.PrependReactor("create", "selfsubjectaccessreviews", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewUnauthorized("token rejected")
	})
	mux := newTestMux(t, &stubSource{clients: &k8s.Clients{Kube: kube}})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/capabilities", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
	}
}

func TestCapabilities_ValidTokenIs200(t *testing.T) {
	mux := newTestMux(t, &stubSource{clients: &k8s.Clients{Kube: kubefake.NewClientset()}})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/capabilities", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
}

func TestCreateResource_DryRunIsNotAudited(t *testing.T) {
	logs := captureLogs(t)
	clients, _ := fakeDynamicClients()
	mux := newTestMux(t, &stubSource{clients: clients})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/resources/"+vsTypeID+"?dryRun=true", strings.NewReader(vsBody)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if audit := findAudit(logs()); audit != nil {
		t.Errorf("dry-run should not be audited: %v", audit)
	}
}
