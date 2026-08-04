package k8s

import (
	"testing"

	"k8s.io/client-go/rest"
)

// Base must build the shared clients once and reuse them.
func TestBase_BuildsOnceAndCaches(t *testing.T) {
	f := &ClientFactory{baseCfg: &rest.Config{Host: "https://kube.example:6443"}}
	a, err := f.Base()
	if err != nil {
		t.Fatal(err)
	}
	b, err := f.Base()
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Error("Base() built new clients on second call, want cached")
	}
	if a.Kube == nil || a.Gateway == nil || a.Istio == nil || a.Dynamic == nil {
		t.Error("Base() returned incomplete client bundle")
	}
}
