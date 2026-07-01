package k8s

import (
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

// CRDInfo reports which routing CRDs are installed and at what API version.
type CRDInfo struct {
	HTTPRoute         bool
	VirtualService    bool
	GatewayAPIVersion string // e.g. "v1"
	IstioAPIVersion   string // e.g. "v1"
}

// DetectCRDs checks the cluster (via base/SA discovery) for HTTPRoute and
// VirtualService support. Partial discovery errors (a broken aggregated API
// group) are tolerated as long as some resource lists were returned.
func (f *ClientFactory) DetectCRDs() (CRDInfo, error) {
	d, err := f.Discovery()
	if err != nil {
		return CRDInfo{}, err
	}
	_, lists, err := d.ServerGroupsAndResources()
	if err != nil && lists == nil {
		return CRDInfo{}, fmt.Errorf("server discovery: %w", err)
	}
	var info CRDInfo
	for _, rl := range lists {
		gv, perr := schema.ParseGroupVersion(rl.GroupVersion)
		if perr != nil {
			continue
		}
		switch gv.Group {
		case "gateway.networking.k8s.io":
			for _, res := range rl.APIResources {
				if res.Name == "httproutes" {
					info.HTTPRoute = true
					info.GatewayAPIVersion = preferVersion(info.GatewayAPIVersion, gv.Version)
				}
			}
		case "networking.istio.io":
			for _, res := range rl.APIResources {
				if res.Name == "virtualservices" {
					info.VirtualService = true
					info.IstioAPIVersion = preferVersion(info.IstioAPIVersion, gv.Version)
				}
			}
		}
	}
	return info, nil
}

// preferVersion keeps the more stable of two API versions (GA > beta > alpha), so a
// resource served at both v1 and v1beta1 reports v1.
func preferVersion(cur, candidate string) string {
	if versionRank(candidate) > versionRank(cur) {
		return candidate
	}
	return cur
}

func versionRank(v string) int {
	switch {
	case v == "":
		return 0
	case strings.Contains(v, "alpha"):
		return 1
	case strings.Contains(v, "beta"):
		return 2
	default: // GA, e.g. v1, v2
		return 3
	}
}
