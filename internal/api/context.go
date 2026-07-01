package api

import (
	"context"

	"istio-dashboard/internal/auth"
	"istio-dashboard/internal/k8s"
)

// Per-request values injected by withK8s so handlers never touch auth/client
// construction directly (keeps P2/P3 handlers decoupled — see DESIGN.md §12 P1).
type ctxKey int

const (
	clientKey ctxKey = iota
	identityKey
)

func withClient(ctx context.Context, c *k8s.Clients) context.Context {
	return context.WithValue(ctx, clientKey, c)
}

func clientFrom(ctx context.Context) *k8s.Clients {
	c, _ := ctx.Value(clientKey).(*k8s.Clients)
	return c
}

func withIdentity(ctx context.Context, id auth.Identity) context.Context {
	return context.WithValue(ctx, identityKey, id)
}

func identityFrom(ctx context.Context) auth.Identity {
	id, _ := ctx.Value(identityKey).(auth.Identity)
	return id
}
