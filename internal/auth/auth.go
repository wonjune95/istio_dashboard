// Package auth verifies user identity. OIDC verification is a thin, optional layer:
// the bearer token is passed through to Kubernetes regardless (RBAC authorizes), so
// when no issuer is configured (dev / non-OIDC SA tokens) a noop verifier is used.
package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
)

type Identity struct {
	Subject string
	Email   string
}

// User returns a stable display identity for audit logs.
func (i Identity) User() string {
	if i.Email != "" {
		return i.Email
	}
	return i.Subject
}

type Verifier interface {
	Verify(ctx context.Context, rawToken string) (Identity, error)
}

// NewVerifier returns an OIDC verifier when issuer is set, otherwise a noop verifier.
func NewVerifier(ctx context.Context, issuer, audience string) (Verifier, error) {
	if issuer == "" {
		return noopVerifier{}, nil
	}
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, err
	}
	return oidcVerifier{v: provider.Verifier(&oidc.Config{ClientID: audience})}, nil
}

// noopVerifier does not validate tokens (dev / non-OIDC). K8s still authorizes.
type noopVerifier struct{}

func (noopVerifier) Verify(context.Context, string) (Identity, error) { return Identity{}, nil }

type oidcVerifier struct{ v *oidc.IDTokenVerifier }

func (o oidcVerifier) Verify(ctx context.Context, raw string) (Identity, error) {
	if raw == "" {
		return Identity{}, errors.New("missing bearer token")
	}
	t, err := o.v.Verify(ctx, raw)
	if err != nil {
		return Identity{}, err
	}
	var claims struct {
		Email string `json:"email"`
		Sub   string `json:"sub"`
	}
	if err := t.Claims(&claims); err != nil {
		return Identity{}, err
	}
	return Identity{Subject: claims.Sub, Email: claims.Email}, nil
}

// BearerFrom extracts the user's token: the Authorization bearer if present, else
// the access-token header injected by an authenticating reverse proxy
// (oauth2-proxy / ingress auth). This lets prod front the dashboard with a proxy
// instead of doing OIDC in the browser — airgap-friendly, no token in browser
// storage. The token is then passed through to the Kubernetes API server.
func BearerFrom(r *http.Request) string {
	if after, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok && after != "" {
		return after
	}
	for _, h := range []string{"X-Auth-Request-Access-Token", "X-Forwarded-Access-Token"} {
		if v := r.Header.Get(h); v != "" {
			return v
		}
	}
	return ""
}
