package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

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
	clients *k8s.Clients
	baseErr error
}

func (s *stubSource) Base() (*k8s.Clients, error) {
	return s.clients, s.baseErr
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
func (s *stubSource) IstiodVersion(context.Context) string       { return "" }

var testSessions = auth.NewSessions("test-secret")

func newTestMux(t *testing.T, source ClientSource) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	NewServer(false, source, auth.NewStore(t.TempDir()), testSessions).Routes(mux)
	return mux
}

// authedReq builds a request carrying a valid editor session cookie.
func authedReq(method, path string, body *strings.Reader) *http.Request {
	var r *http.Request
	if body == nil {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, body)
	}
	r.AddCookie(&http.Cookie{
		Name:  "istio_dash_session",
		Value: testSessions.Sign(auth.Identity{Name: "tester", Role: "editor"}, time.Hour),
	})
	return r
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

// A request without a session cookie must be rejected as 401.
func TestWithAuth_MissingSessionIs401(t *testing.T) {
	mux := newTestMux(t, &stubSource{})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/resourceTypes", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

// A forged/tampered cookie must be rejected as 401.
func TestWithAuth_BadCookieIs401(t *testing.T) {
	mux := newTestMux(t, &stubSource{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/resourceTypes", nil)
	req.AddCookie(&http.Cookie{Name: "istio_dash_session", Value: "dGVzdGVy|admin|9999999999|forged"})
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

// viewer role must not pass mutating methods (403 before any k8s call).
func TestWithAuth_ViewerWriteIs403(t *testing.T) {
	mux := newTestMux(t, &stubSource{})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/resources/"+vsTypeID, strings.NewReader(vsBody))
	req.AddCookie(&http.Cookie{
		Name:  "istio_dash_session",
		Value: testSessions.Sign(auth.Identity{Name: "ro", Role: "viewer"}, time.Hour),
	})
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403: %s", rec.Code, rec.Body.String())
	}
}

func TestWithAuth_FactoryFailureIs500(t *testing.T) {
	mux := newTestMux(t, &stubSource{baseErr: errors.New("boom")})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedReq("GET", "/api/resourceTypes", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

// Login round-trip against a real accounts dir: wrong password 401, right
// password sets a cookie that authenticates subsequent requests.
func TestLogin_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	hash, err := bcrypt.GenerateFromPassword([]byte("s3cret"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "alice"), []byte("editor:"+string(hash)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	NewServer(false, &stubSource{clients: &k8s.Clients{Kube: kubefake.NewClientset()}},
		auth.NewStore(dir), testSessions).Routes(mux)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"username":"alice","password":"wrong"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password: status = %d, want 401", rec.Code)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"username":"alice","password":"s3cret"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("login: status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("no session cookie set")
	}

	rec = httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/capabilities", nil)
	req.AddCookie(cookies[0])
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("capabilities with session: status = %d, want 200: %s", rec.Code, rec.Body.String())
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
	mux.ServeHTTP(rec, authedReq("POST", "/api/resources/"+vsTypeID, strings.NewReader(vsBody)))
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
	mux.ServeHTTP(rec, authedReq("POST", "/api/resources/"+vsTypeID, strings.NewReader(vsBody)))
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

// If the SA itself is rejected by the API server, capabilities surfaces the 401
// instead of half-working.
func TestCapabilities_SAUnauthorizedIs401(t *testing.T) {
	kube := kubefake.NewClientset()
	kube.PrependReactor("create", "selfsubjectaccessreviews", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewUnauthorized("token rejected")
	})
	mux := newTestMux(t, &stubSource{clients: &k8s.Clients{Kube: kube}})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedReq("GET", "/api/capabilities", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
	}
}

func TestCapabilities_WithSessionIs200(t *testing.T) {
	mux := newTestMux(t, &stubSource{clients: &k8s.Clients{Kube: kubefake.NewClientset()}})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedReq("GET", "/api/capabilities", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
}

func TestCreateResource_DryRunIsNotAudited(t *testing.T) {
	logs := captureLogs(t)
	clients, _ := fakeDynamicClients()
	mux := newTestMux(t, &stubSource{clients: clients})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedReq("POST", "/api/resources/"+vsTypeID+"?dryRun=true", strings.NewReader(vsBody)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if audit := findAudit(logs()); audit != nil {
		t.Errorf("dry-run should not be audited: %v", audit)
	}
}
