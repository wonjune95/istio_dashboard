package api

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"

	istioapi "istio.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gwapi "sigs.k8s.io/gateway-api/apis/v1"
)

// 경로 시뮬레이터: 요청(호스트·경로·메서드·헤더)이 어느 VirtualService/HTTPRoute
// 룰에 매치되어 어디로 가는지를 설정만으로 계산한다. 실제 트래픽은 발생하지 않는다.

type routeDest struct {
	Host      string `json:"host"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
	Subset    string `json:"subset,omitempty"`
	Port      int32  `json:"port,omitempty"`
	Weight    int32  `json:"weight,omitempty"`
	External  bool   `json:"external,omitempty"`
	Exists    bool   `json:"exists"`
	Endpoints int    `json:"endpoints"`
	SubsetOK  bool   `json:"subsetOk,omitempty"` // subset이 DestinationRule에 정의돼 있나
	SubsetDR  string `json:"subsetDr,omitempty"`
}

type routeCandidate struct {
	Kind      string `json:"kind"`
	TypeID    string `json:"typeId"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	RuleIndex int    `json:"ruleIndex"`
	Matched   bool   `json:"matched"`
	Reason    string `json:"reason"`
	Winner    bool   `json:"winner,omitempty"`
}

type routeMatchResult struct {
	Matched      bool             `json:"matched"`
	Destinations []routeDest      `json:"destinations"`
	Candidates   []routeCandidate `json:"candidates"`
	Notes        []string         `json:"notes,omitempty"`
}

// handleRouteMatch simulates one request against the cluster's routing config.
// GET이라 viewer도 쓸 수 있다 — 읽기 전용 계산이다.
func (s *Server) handleRouteMatch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	host := strings.TrimSpace(q.Get("host"))
	if host == "" {
		writeError(w, http.StatusBadRequest, "BadRequest", "host는 필수입니다 (예: shop.example.com)")
		return
	}
	method := strings.ToUpper(strings.TrimSpace(q.Get("method")))
	if method == "" {
		method = "GET"
	}
	rawPath := q.Get("path")
	if rawPath == "" {
		rawPath = "/"
	}
	u, err := url.Parse(rawPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BadRequest", "경로 형식이 잘못되었습니다: "+err.Error())
		return
	}
	path, query := u.Path, u.Query()
	if path == "" {
		path = "/"
	}
	headers := map[string]string{}
	for _, h := range q["header"] {
		if k, v, ok := strings.Cut(h, ":"); ok {
			headers[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
		}
	}

	ctx := r.Context()
	c := clientFrom(ctx)
	out := routeMatchResult{Destinations: []routeDest{}, Candidates: []routeCandidate{}}
	winnerFound := false

	// --- VirtualService: hosts 매치 후 http 룰을 선언 순서대로, 첫 매치가 이긴다 ---
	if vss, err := c.Istio.NetworkingV1().VirtualServices("").List(ctx, metav1.ListOptions{}); err == nil {
		for _, vs := range vss.Items {
			if !hostsMatch(vs.Spec.Hosts, host, vs.Namespace) {
				continue
			}
			for i, h := range vs.Spec.Http {
				ok, reason := matchVSRule(h.Match, path, method, headers, query, host)
				cand := routeCandidate{
					Kind: "VirtualService", TypeID: "virtualservices.networking.istio.io",
					Namespace: vs.Namespace, Name: vs.Name, RuleIndex: i, Matched: ok, Reason: reason,
				}
				if ok && !winnerFound {
					winnerFound = true
					cand.Winner = true
					out.Matched = true
					for _, rt := range h.Route {
						if rt.Destination == nil {
							continue
						}
						var port int32
						if rt.Destination.Port != nil {
							port = int32(rt.Destination.Port.Number)
						}
						b := resolveDestination(rt.Destination.Host, vs.Namespace, port)
						out.Destinations = append(out.Destinations, routeDest{
							Host: rt.Destination.Host, Namespace: b.Namespace, Name: b.Name,
							Subset: rt.Destination.Subset, Port: port, Weight: rt.Weight, External: b.External,
						})
					}
					if len(h.Route) == 0 {
						out.Notes = append(out.Notes, "매치된 룰에 route가 없습니다 (redirect/delegate/fault 등은 모델링하지 않습니다)")
					}
				}
				out.Candidates = append(out.Candidates, cand)
				if ok {
					break // 이 VS에서는 첫 매치 이후 룰을 평가하지 않는다
				}
			}
		}
	}

	// --- HTTPRoute(Gateway API): 선언 순서가 아니라 명세의 우선순위로 이긴다 ---
	type hrHit struct {
		cand routeCandidate
		rank [5]int // pathType, pathLen, method, headerCount, queryCount (클수록 우선)
		rule gwapi.HTTPRouteRule
		ns   string
	}
	var hits []hrHit
	if hrs, err := c.Gateway.GatewayV1().HTTPRoutes("").List(ctx, metav1.ListOptions{}); err == nil {
		for i := range hrs.Items {
			hr := &hrs.Items[i]
			if !hostnamesMatch(hr.Spec.Hostnames, host) {
				continue
			}
			for ri, rule := range hr.Spec.Rules {
				ok, reason, rank := matchHTTPRouteRule(rule.Matches, path, method, headers, query)
				cand := routeCandidate{
					Kind: "HTTPRoute", TypeID: "httproutes.gateway.networking.k8s.io",
					Namespace: hr.Namespace, Name: hr.Name, RuleIndex: ri, Matched: ok, Reason: reason,
				}
				if ok {
					hits = append(hits, hrHit{cand: cand, rank: rank, rule: rule, ns: hr.Namespace})
				} else {
					out.Candidates = append(out.Candidates, cand)
				}
			}
		}
	}
	if len(hits) > 0 {
		sort.SliceStable(hits, func(i, j int) bool {
			for k := 0; k < len(hits[i].rank); k++ {
				if hits[i].rank[k] != hits[j].rank[k] {
					return hits[i].rank[k] > hits[j].rank[k]
				}
			}
			return false
		})
		for i := range hits {
			cand := hits[i].cand
			if i == 0 && !winnerFound {
				winnerFound = true
				cand.Winner = true
				out.Matched = true
				for _, b := range hits[i].rule.BackendRefs {
					if b.Kind != nil && *b.Kind != "Service" {
						continue
					}
					ns := hits[i].ns
					if b.Namespace != nil {
						ns = string(*b.Namespace)
					}
					var port, weight int32
					if b.Port != nil {
						port = int32(*b.Port)
					}
					if b.Weight != nil {
						weight = *b.Weight
					}
					out.Destinations = append(out.Destinations, routeDest{
						Host: string(b.Name), Namespace: ns, Name: string(b.Name), Port: port, Weight: weight,
					})
				}
			} else if i > 0 {
				cand.Reason += " (우선순위에서 밀림)"
			}
			out.Candidates = append(out.Candidates, cand)
		}
		if len(hits) > 1 {
			out.Notes = append(out.Notes, "여러 HTTPRoute 룰이 매치되어 Gateway API 우선순위(경로 타입 → 경로 길이 → 메서드 → 헤더 수)로 골랐습니다")
		}
	}

	// --- 목적지 실체 확인: 서비스 존재·엔드포인트 수·subset 정의 여부 ---
	var drs []subsetDef
	if list, err := c.Istio.NetworkingV1().DestinationRules("").List(ctx, metav1.ListOptions{}); err == nil {
		for _, dr := range list.Items {
			for _, ss := range dr.Spec.Subsets {
				drs = append(drs, subsetDef{DR: dr.Name, Namespace: dr.Namespace, Host: dr.Spec.Host, Subset: ss.Name})
			}
		}
	}
	for i := range out.Destinations {
		d := &out.Destinations[i]
		if d.External || d.Name == "" {
			continue
		}
		if _, err := c.Kube.CoreV1().Services(d.Namespace).Get(ctx, d.Name, metav1.GetOptions{}); err == nil {
			d.Exists = true
			d.Endpoints = readyEndpoints(ctx, c, d.Namespace, d.Name)
		}
		if d.Subset != "" {
			for _, sd := range drs {
				if sd.Subset != d.Subset {
					continue
				}
				b := resolveDestination(sd.Host, sd.Namespace, 0)
				if b.Namespace == d.Namespace && b.Name == d.Name {
					d.SubsetOK, d.SubsetDR = true, sd.DR
					break
				}
			}
		}
	}
	if !out.Matched {
		out.Notes = append(out.Notes, "매치되는 라우트가 없습니다 — 요청은 라우팅되지 않거나 기본 동작(직접 서비스 접근)으로 갑니다")
	}
	writeJSON(w, http.StatusOK, out)
}

type subsetDef struct{ DR, Namespace, Host, Subset string }

// hostsMatch reports whether any VS host pattern covers the request host.
// "*" / "*.suffix" 와일드카드와 짧은 이름(같은 NS 서비스)을 지원한다.
func hostsMatch(patterns []string, host, ns string) bool {
	for _, p := range patterns {
		if _, after, found := strings.Cut(p, "/"); found { // "ns/host" 형식
			p = after
		}
		switch {
		case p == "*" || p == host:
			return true
		case strings.HasPrefix(p, "*."):
			if strings.HasSuffix(host, p[1:]) {
				return true
			}
		case !strings.Contains(p, "."):
			// 짧은 이름 → 같은 네임스페이스 서비스의 FQDN 변형들
			if host == p+"."+ns || host == p+"."+ns+".svc" || host == p+"."+ns+".svc.cluster.local" {
				return true
			}
		default:
			// 요청이 짧은 이름이고 패턴이 FQDN인 경우
			if name, rest, ok := strings.Cut(p, "."); ok && name == host && strings.HasPrefix(rest, ns) {
				return true
			}
		}
	}
	return false
}

func hostnamesMatch(hostnames []gwapi.Hostname, host string) bool {
	if len(hostnames) == 0 {
		return true // 호스트 제한 없음
	}
	for _, h := range hostnames {
		p := string(h)
		if p == host {
			return true
		}
		if strings.HasPrefix(p, "*.") && strings.HasSuffix(host, p[1:]) {
			return true
		}
	}
	return false
}

// matchVSRule evaluates one VirtualService http rule (match는 OR, 항목 내부는 AND).
func matchVSRule(ms []*istioapi.HTTPMatchRequest, path, method string, headers map[string]string, query url.Values, authority string) (bool, string) {
	if len(ms) == 0 {
		return true, "match 조건 없음 — 모든 요청이 매치됩니다"
	}
	last := ""
	for i, m := range ms {
		ok, why := matchVSOne(m, path, method, headers, query, authority)
		if ok {
			return true, fmt.Sprintf("match[%d] 일치: %s", i, why)
		}
		last = fmt.Sprintf("match[%d] %s", i, why)
	}
	return false, last
}

func matchVSOne(m *istioapi.HTTPMatchRequest, path, method string, headers map[string]string, query url.Values, authority string) (bool, string) {
	var parts []string
	check := func(label string, sm *istioapi.StringMatch, v string) (bool, string) {
		ok, desc := stringMatch(sm, v)
		if desc == "" {
			return true, ""
		}
		if !ok {
			return false, label + " " + desc + " ≠ " + quoteEmpty(v)
		}
		parts = append(parts, label+" "+desc)
		return true, ""
	}
	if ok, why := check("uri", m.Uri, path); !ok {
		return false, why
	}
	if ok, why := check("method", m.Method, method); !ok {
		return false, why
	}
	if ok, why := check("authority", m.Authority, authority); !ok {
		return false, why
	}
	for _, k := range sortedKeys(m.Headers) {
		v, has := headers[strings.ToLower(k)]
		ok, desc := stringMatch(m.Headers[k], v)
		if !has || !ok {
			return false, fmt.Sprintf("헤더 %s %s ≠ %s", k, desc, quoteEmpty(v))
		}
		parts = append(parts, fmt.Sprintf("헤더 %s %s", k, desc))
	}
	for _, k := range sortedKeys(m.WithoutHeaders) {
		if v, has := headers[strings.ToLower(k)]; has {
			if ok, _ := stringMatch(m.WithoutHeaders[k], v); ok {
				return false, fmt.Sprintf("withoutHeaders %s 조건에 걸림", k)
			}
		}
	}
	for _, k := range sortedKeys(m.QueryParams) {
		v := query.Get(k)
		ok, desc := stringMatch(m.QueryParams[k], v)
		if !ok {
			return false, fmt.Sprintf("쿼리 %s %s ≠ %s", k, desc, quoteEmpty(v))
		}
		parts = append(parts, fmt.Sprintf("쿼리 %s %s", k, desc))
	}
	if len(parts) == 0 {
		parts = append(parts, "조건 없음")
	}
	return true, strings.Join(parts, ", ")
}

// stringMatch returns (일치 여부, 사람이 읽을 조건 설명). 설명이 빈 값이면 조건 미설정.
func stringMatch(sm *istioapi.StringMatch, v string) (bool, string) {
	if sm == nil || sm.GetMatchType() == nil {
		return true, ""
	}
	if p := sm.GetPrefix(); p != "" {
		return strings.HasPrefix(v, p), "prefix=" + p
	}
	if rx := sm.GetRegex(); rx != "" {
		re, err := regexp.Compile(rx)
		if err != nil {
			return false, "regex=" + rx + " (컴파일 실패)"
		}
		return re.MatchString(v), "regex=" + rx
	}
	e := sm.GetExact()
	return v == e, "exact=" + e
}

// matchHTTPRouteRule evaluates a Gateway API rule and returns its precedence rank.
func matchHTTPRouteRule(ms []gwapi.HTTPRouteMatch, path, method string, headers map[string]string, query url.Values) (bool, string, [5]int) {
	var zero [5]int
	if len(ms) == 0 {
		// 명세 기본값: PathPrefix "/"
		return true, "match 조건 없음 — 기본 PathPrefix=/ 로 모든 요청 매치", [5]int{1, 1, 0, 0, 0}
	}
	last := ""
	for i, m := range ms {
		ok, why, rank := matchHTTPRouteOne(m, path, method, headers, query)
		if ok {
			return true, fmt.Sprintf("matches[%d] 일치: %s", i, why), rank
		}
		last = fmt.Sprintf("matches[%d] %s", i, why)
	}
	return false, last, zero
}

func matchHTTPRouteOne(m gwapi.HTTPRouteMatch, path, method string, headers map[string]string, query url.Values) (bool, string, [5]int) {
	var rank [5]int
	var parts []string
	if m.Path != nil && m.Path.Value != nil {
		t := gwapi.PathMatchPathPrefix
		if m.Path.Type != nil {
			t = *m.Path.Type
		}
		val := *m.Path.Value
		switch t {
		case gwapi.PathMatchExact:
			if path != val {
				return false, "path exact=" + val + " ≠ " + path, rank
			}
			rank[0] = 3
		case gwapi.PathMatchRegularExpression:
			re, err := regexp.Compile(val)
			if err != nil || !re.MatchString(path) {
				return false, "path regex=" + val + " 불일치", rank
			}
			rank[0] = 2
		default: // PathPrefix — 세그먼트 경계로만 매치된다 (/foo는 /foobar에 안 걸림)
			if !prefixSegmentMatch(path, val) {
				return false, "path prefix=" + val + " ≠ " + path, rank
			}
			rank[0] = 1
		}
		rank[1] = len(val)
		parts = append(parts, "path "+string(t)+"="+val)
	} else {
		rank[0], rank[1] = 1, 1
	}
	if m.Method != nil {
		if string(*m.Method) != method {
			return false, "method=" + string(*m.Method) + " ≠ " + method, rank
		}
		rank[2] = 1
		parts = append(parts, "method="+method)
	}
	for _, h := range m.Headers {
		v, has := headers[strings.ToLower(string(h.Name))]
		okH := has
		if okH && h.Type != nil && *h.Type == gwapi.HeaderMatchRegularExpression {
			re, err := regexp.Compile(h.Value)
			okH = err == nil && re.MatchString(v)
		} else if okH {
			okH = v == h.Value
		}
		if !okH {
			return false, fmt.Sprintf("헤더 %s=%s ≠ %s", h.Name, h.Value, quoteEmpty(v)), rank
		}
		parts = append(parts, fmt.Sprintf("헤더 %s=%s", h.Name, h.Value))
	}
	rank[3] = len(m.Headers)
	for _, qp := range m.QueryParams {
		if query.Get(string(qp.Name)) != qp.Value {
			return false, fmt.Sprintf("쿼리 %s=%s 불일치", qp.Name, qp.Value), rank
		}
		parts = append(parts, fmt.Sprintf("쿼리 %s=%s", qp.Name, qp.Value))
	}
	rank[4] = len(m.QueryParams)
	if len(parts) == 0 {
		parts = append(parts, "조건 없음")
	}
	return true, strings.Join(parts, ", "), rank
}

// prefixSegmentMatch implements Gateway API PathPrefix semantics.
func prefixSegmentMatch(path, prefix string) bool {
	prefix = strings.TrimSuffix(prefix, "/")
	if prefix == "" {
		return true
	}
	return path == prefix || strings.HasPrefix(path, prefix+"/")
}

func sortedKeys(m map[string]*istioapi.StringMatch) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func quoteEmpty(v string) string {
	if v == "" {
		return "(없음)"
	}
	return v
}
