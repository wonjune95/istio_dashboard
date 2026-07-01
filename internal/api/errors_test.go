package api

import (
	"errors"
	"net/http/httptest"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestWriteK8sError_StatusMapping(t *testing.T) {
	gr := schema.GroupResource{Group: "gateway.networking.k8s.io", Resource: "httproutes"}
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"conflict", apierrors.NewConflict(gr, "app", errors.New("changed")), 409},
		{"forbidden", apierrors.NewForbidden(gr, "app", errors.New("nope")), 403},
		{"notfound", apierrors.NewNotFound(gr, "app"), 404},
		{"invalid", apierrors.NewInvalid(schema.GroupKind{Kind: "HTTPRoute"}, "app", nil), 422},
		{"other", errors.New("boom"), 500},
		{"unauthorized", apierrors.NewUnauthorized("no token"), 401},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeK8sError(rec, c.err)
			if rec.Code != c.want {
				t.Fatalf("status = %d, want %d", rec.Code, c.want)
			}
		})
	}
}
