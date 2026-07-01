// Command server runs the Istio Routing Dashboard: a single binary serving the
// embedded React SPA and a JSON API over the Kubernetes API (HTTPRoute/VirtualService).
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"istio-dashboard/internal/api"
	"istio-dashboard/internal/assets"
	"istio-dashboard/internal/auth"
	"istio-dashboard/internal/k8s"
	"istio-dashboard/internal/observability"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	dev := flag.Bool("dev", false, "dev mode: skip OIDC verification, use local kubeconfig")
	kubeconfig := flag.String("kubeconfig", "", "path to kubeconfig (dev only; default loading rules if empty)")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	// dev safety guard: --dev bypasses OIDC and uses a local kubeconfig, so it must
	// never run in a cluster. KUBERNETES_SERVICE_HOST is injected into every pod;
	// its presence means we are in-cluster — refuse to start to prevent auth bypass.
	if *dev && os.Getenv("KUBERNETES_SERVICE_HOST") != "" {
		slog.Error("--dev refused: in-cluster environment detected (would bypass OIDC auth)")
		os.Exit(1)
	}

	factory, err := k8s.NewClientFactory(*dev, *kubeconfig)
	if err != nil {
		slog.Error("kube client init failed", "err", err)
		os.Exit(1)
	}
	verifier, err := auth.NewVerifier(context.Background(), os.Getenv("OIDC_ISSUER"), os.Getenv("OIDC_AUDIENCE"))
	if err != nil {
		slog.Error("oidc verifier init failed", "err", err)
		os.Exit(1)
	}
	srv := api.NewServer(*dev, factory, verifier)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeText(w, http.StatusOK, "ok")
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) {
		// P2: verify API-server reachability + CRD discovery before reporting ready.
		writeText(w, http.StatusOK, "ready")
	})
	mux.Handle("GET /metrics", observability.MetricsHandler())
	srv.Routes(mux)
	mux.Handle("/", assets.Handler())

	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           logRequests(observability.Instrument(mux)),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("server starting", "addr", *addr, "dev", *dev)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()

	slog.Info("shutting down")
	shCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shCtx); err != nil {
		slog.Error("graceful shutdown failed", "err", err)
	}
}

func writeText(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

// logRequests is a minimal structured access log.
func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		slog.Info("request",
			"method", r.Method, "path", r.URL.Path,
			"status", rec.status, "dur_ms", time.Since(start).Milliseconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}
