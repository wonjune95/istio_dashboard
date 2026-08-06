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

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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
	NewServer(false, source, auth.NewStore(t.TempDir()), testSessions, AccountsCMRef{}).Routes(mux)
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
		auth.NewStore(dir), testSessions, AccountsCMRef{}).Routes(mux)

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

// Password change: wrong current password 401; correct one patches the accounts
// ConfigMap with a hash the new password verifies against.
func TestPasswordChange_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	hash, _ := bcrypt.GenerateFromPassword([]byte("oldpw123"), bcrypt.MinCost)
	if err := os.WriteFile(filepath.Join(dir, "alice"), []byte("viewer:"+string(hash)), 0o600); err != nil {
		t.Fatal(err)
	}
	kube := kubefake.NewClientset(&corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "accounts", Namespace: "ns1"},
		Data:       map[string]string{"alice": "viewer:" + string(hash)},
	})
	mux := http.NewServeMux()
	NewServer(false, &stubSource{clients: &k8s.Clients{Kube: kube}},
		auth.NewStore(dir), testSessions, AccountsCMRef{Namespace: "ns1", Name: "accounts"}).Routes(mux)
	cookie := &http.Cookie{
		Name:  "istio_dash_session",
		Value: testSessions.Sign(auth.Identity{Name: "alice", Role: "viewer"}, time.Hour),
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/account/password", strings.NewReader(`{"currentPassword":"wrong","newPassword":"newpw1234"}`))
	req.AddCookie(cookie)
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong current pw: status = %d, want 401: %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/api/account/password", strings.NewReader(`{"currentPassword":"oldpw123","newPassword":"newpw1234"}`))
	req.AddCookie(cookie)
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("change: status = %d, want 204: %s", rec.Code, rec.Body.String())
	}

	cm, err := kube.CoreV1().ConfigMaps("ns1").Get(context.Background(), "accounts", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	role, newHash, _ := strings.Cut(cm.Data["alice"], ":")
	if role != "viewer" {
		t.Errorf("role = %q, want viewer preserved", role)
	}
	if bcrypt.CompareHashAndPassword([]byte(newHash), []byte("newpw1234")) != nil {
		t.Error("patched hash does not verify the new password")
	}
}

// Fresh install: no accounts CM → EnsureInitialAdmin creates it with an
// admin entry whose password is "admin".
func TestEnsureInitialAdmin_FreshInstall(t *testing.T) {
	kube := kubefake.NewClientset()
	s := NewServer(false, &stubSource{clients: &k8s.Clients{Kube: kube}},
		auth.NewStore(t.TempDir()), testSessions, AccountsCMRef{Namespace: "ns1", Name: "accounts"})

	s.EnsureInitialAdmin(context.Background())

	cm, err := kube.CoreV1().ConfigMaps("ns1").Get(context.Background(), "accounts", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("accounts CM not created: %v", err)
	}
	role, hash, _ := strings.Cut(cm.Data["admin"], ":")
	if role != "admin" {
		t.Fatalf("admin entry = %q, want admin role", cm.Data["admin"])
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte("admin")) != nil {
		t.Error("initial admin hash does not verify password \"admin\"")
	}

	// 이미 admin이 있으면 아무것도 바꾸지 않는다.
	s.EnsureInitialAdmin(context.Background())
	cm2, _ := kube.CoreV1().ConfigMaps("ns1").Get(context.Background(), "accounts", metav1.GetOptions{})
	if cm2.Data["admin"] != cm.Data["admin"] {
		t.Error("second run must not rotate the admin password")
	}
}
