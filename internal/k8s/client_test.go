package k8s

import (
	"errors"
	"testing"

	"k8s.io/client-go/rest"
)

// prodFactory simulates the in-cluster factory: base config carries the pod
// ServiceAccount credentials that must never leak into user-scoped clients.
func prodFactory() *ClientFactory {
	return &ClientFactory{
		dev: false,
		baseCfg: &rest.Config{
			Host:            "https://kube.example:6443",
			BearerToken:     "sa-token",
			BearerTokenFile: "/var/run/secrets/kubernetes.io/serviceaccount/token",
			Username:        "basic-user",
			Password:        "basic-pw",
			TLSClientConfig: rest.TLSClientConfig{
				CAData:   []byte("ca-bundle"),
				CertData: []byte("client-cert"),
				KeyData:  []byte("client-key"),
				CertFile: "/certs/client.crt",
				KeyFile:  "/certs/client.key",
			},
		},
	}
}

func TestForToken_ProdRejectsEmptyToken(t *testing.T) {
	_, err := prodFactory().ForToken("")
	if !errors.Is(err, ErrTokenRequired) {
		t.Fatalf("ForToken(\"\") err = %v, want ErrTokenRequired", err)
	}
}

func TestForToken_DevAllowsEmptyToken(t *testing.T) {
	// Minimal config: client construction rejects fixture credentials that are
	// not real PEM, and dev needs none.
	f := &ClientFactory{dev: true, baseCfg: &rest.Config{Host: "https://kube.example:6443"}}
	if _, err := f.ForToken(""); err != nil {
		t.Fatalf("dev ForToken(\"\") err = %v, want nil", err)
	}
}

func TestUserConfig_SwapsToUserToken(t *testing.T) {
	f := prodFactory()
	cfg := f.userConfig("user-token")

	if cfg.BearerToken != "user-token" {
		t.Errorf("BearerToken = %q, want user-token", cfg.BearerToken)
	}
	// Every SA/static credential must be cleared so only the user token authenticates.
	if cfg.BearerTokenFile != "" {
		t.Errorf("BearerTokenFile = %q, want empty", cfg.BearerTokenFile)
	}
	if cfg.Username != "" || cfg.Password != "" {
		t.Errorf("basic auth not cleared: %q/%q", cfg.Username, cfg.Password)
	}
	if cfg.CertData != nil || cfg.KeyData != nil || cfg.CertFile != "" || cfg.KeyFile != "" {
		t.Error("client cert credentials not cleared")
	}
	// Transport identity (host, CA) must be preserved.
	if cfg.Host != f.baseCfg.Host {
		t.Errorf("Host = %q, want %q", cfg.Host, f.baseCfg.Host)
	}
	if string(cfg.CAData) != string(f.baseCfg.CAData) {
		t.Error("CAData not preserved")
	}
	// The base config must not be mutated.
	if f.baseCfg.BearerToken != "sa-token" {
		t.Errorf("base config mutated: BearerToken = %q", f.baseCfg.BearerToken)
	}
}

func TestUserConfig_DevUsesBaseConfig(t *testing.T) {
	f := prodFactory()
	f.dev = true
	if cfg := f.userConfig("ignored"); cfg != f.baseCfg {
		t.Error("dev mode should return the base config unchanged")
	}
}
