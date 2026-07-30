package k8s

import (
	"context"
	"os"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var deploymentsGVR = schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}

// IstiodVersion returns the Istio control-plane version, parsed from the istiod
// Deployment's image tag (…/pilot:1.30.2 → "1.30.2"). Reads via the base (SA)
// client from $ISTIO_NAMESPACE (default istio-system); any error — missing RBAC,
// no istiod, non-standard image — degrades to "" so capabilities still answer.
// Cached forever: the control plane doesn't change version under a running pod.
func (f *ClientFactory) IstiodVersion(ctx context.Context) string {
	f.istiodMu.Lock()
	defer f.istiodMu.Unlock()
	if f.istiodVer != nil {
		return *f.istiodVer
	}
	ns := os.Getenv("ISTIO_NAMESPACE")
	if ns == "" {
		ns = "istio-system"
	}
	v := ""
	list, err := f.baseDyn.Resource(deploymentsGVR).Namespace(ns).
		List(ctx, metav1.ListOptions{LabelSelector: "app=istiod"})
	if err == nil {
	scan:
		for _, d := range list.Items {
			containers, _, _ := unstructured.NestedSlice(d.Object, "spec", "template", "spec", "containers")
			for _, c := range containers {
				m, ok := c.(map[string]any)
				if !ok {
					continue
				}
				image, _ := m["image"].(string)
				if i := strings.LastIndex(image, ":"); i >= 0 && !strings.Contains(image[i+1:], "/") {
					v = image[i+1:]
					break scan
				}
			}
		}
	}
	f.istiodVer = &v
	return v
}
