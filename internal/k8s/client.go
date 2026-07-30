// Package k8s builds Kubernetes clients for the dashboard.
//
// Auth model (see DESIGN.md §2): each user request carries a bearer token that is
// passed through to the API server, so Kubernetes RBAC authorizes per user. A
// separate base config (in-cluster SA in prod, local kubeconfig in dev) is used
// only for cluster-scoped CRD discovery — never for user-scoped reads/writes.
package k8s

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	istio "istio.io/client-go/pkg/clientset/versioned"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	gateway "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
)

// Clients bundles the clients a request needs, all built from the same
// (user-scoped) config so RBAC applies uniformly. Dynamic drives the generic
// resource engine (any registered CRD); the typed clients back specific helpers.
type Clients struct {
	Kube    kubernetes.Interface
	Gateway gateway.Interface
	Istio   istio.Interface
	Dynamic dynamic.Interface
}

// ErrTokenRequired is returned by ForToken when a non-dev request carries no
// bearer token. Without this guard the request would silently act as the pod's
// ServiceAccount instead of a user. Handlers map it to 401.
var ErrTokenRequired = errors.New("bearer token required")

type ClientFactory struct {
	dev     bool
	baseCfg *rest.Config // dev: local kubeconfig; prod: in-cluster SA (discovery only)
	baseDyn dynamic.Interface

	newDiscovery func() (discovery.DiscoveryInterface, error) // swappable in tests

	catMu       sync.Mutex
	catalog     []ResolvedType // lazily cached; restart to pick up newly installed CRDs
	schemaMu    sync.Mutex
	schemaCache map[string]json.RawMessage // typeID -> spec schema
	istiodMu    sync.Mutex
	istiodVer   *string // lazily cached control-plane version ("" = not detected)
}

func NewClientFactory(dev bool, kubeconfig string) (*ClientFactory, error) {
	var cfg *rest.Config
	var err error
	if dev {
		// Default rules honor $KUBECONFIG and ~/.kube/config; ExplicitPath overrides.
		rules := clientcmd.NewDefaultClientConfigLoadingRules()
		if kubeconfig != "" {
			rules.ExplicitPath = kubeconfig
		}
		cfg, err = clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
			rules, &clientcmd.ConfigOverrides{},
		).ClientConfig()
	} else {
		cfg, err = rest.InClusterConfig()
	}
	if err != nil {
		return nil, fmt.Errorf("load base kube config: %w", err)
	}
	baseDyn, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("base dynamic client: %w", err)
	}
	f := &ClientFactory{dev: dev, baseCfg: cfg, baseDyn: baseDyn}
	f.newDiscovery = func() (discovery.DiscoveryInterface, error) {
		return discovery.NewDiscoveryClientForConfig(f.baseCfg)
	}
	return f, nil
}

// ForToken returns clients acting as the user identified by bearerToken.
// In dev they act as the base kubeconfig identity; outside dev a token is
// mandatory — falling back to the base (SA) config would let unauthenticated
// requests act as the pod's ServiceAccount.
func (f *ClientFactory) ForToken(bearerToken string) (*Clients, error) {
	if !f.dev && bearerToken == "" {
		return nil, ErrTokenRequired
	}
	cfg := f.userConfig(bearerToken)
	kube, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	gw, err := gateway.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	is, err := istio.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	dyn, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	return &Clients{Kube: kube, Gateway: gw, Istio: is, Dynamic: dyn}, nil
}

func (f *ClientFactory) userConfig(bearerToken string) *rest.Config {
	if f.dev {
		return f.baseCfg
	}
	// Keep the base transport (TLS/CA, host) but swap auth to the user's token,
	// clearing any SA/client-cert credentials so only the user token is used.
	c := rest.CopyConfig(f.baseCfg)
	c.BearerToken = bearerToken
	c.BearerTokenFile = ""
	c.Username, c.Password = "", ""
	c.CertData, c.KeyData, c.CertFile, c.KeyFile = nil, nil, "", ""
	return c
}

// Discovery returns a discovery client on the base config — cluster-scoped CRD
// presence/version checks only.
func (f *ClientFactory) Discovery() (discovery.DiscoveryInterface, error) {
	return f.newDiscovery()
}
