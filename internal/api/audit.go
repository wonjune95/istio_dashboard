package api

import (
	"context"
	"log/slog"

	"istio-dashboard/internal/k8s"
)

// auditResource audits a generic-engine mutation, flagging high-risk kinds so
// monitoring can alert on them (Gemini review ⑦).
func (s *Server) auditResource(ctx context.Context, verb, typeID, ns, name string, dryRun bool, err error) {
	if dryRun {
		return
	}
	danger := k8s.IsDangerous(typeID)
	attrs := []any{
		slog.Bool("audit", true),
		slog.Bool("dangerous", danger),
		slog.String("user", identityFrom(ctx).User()),
		slog.String("verb", verb),
		slog.String("type", typeID),
		slog.String("namespace", ns),
		slog.String("name", name),
	}
	switch {
	case err != nil:
		slog.Error("resource mutation failed", append(attrs, slog.String("err", err.Error()))...)
	case danger:
		slog.Warn("HIGH-RISK resource mutated", attrs...)
	default:
		slog.Info("resource mutated", attrs...)
	}
}
