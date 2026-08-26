package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// 실제 요청 테스터: 사용자가 고른 파드 안에서 curl을 실행해 진짜 HTTP 요청을 보낸다.
// 그 파드의 사이드카를 통과하므로 VirtualService 라우팅·AuthorizationPolicy·mTLS가
// 실제로 어떻게 동작하는지 확인할 수 있다.
//
// 위험한 기능이라 3중으로 잠근다: ① REQUEST_TESTER 환경변수(헬름 opt-in)
// ② admin 역할 ③ argv 직접 구성(셸 없음) + 입력 검증 + 타임아웃·크기 상한.

const (
	reqTestMaxBody     = 64 << 10  // 요청 본문 상한
	reqTestMaxResponse = 256 << 10 // 응답 상한 (초과분은 잘림)
	reqTestMaxTimeout  = 30
)

var reqTestMethods = map[string]bool{
	"GET": true, "POST": true, "PUT": true, "PATCH": true,
	"DELETE": true, "HEAD": true, "OPTIONS": true,
}

type podRef struct {
	Name       string   `json:"name"`
	Containers []string `json:"containers"`
	Mesh       bool     `json:"mesh"` // istio-proxy 사이드카 있음 = 라우팅 검증 가능
	Ready      bool     `json:"ready"`
}

// handlePods lists pods for the source-pod picker. 요청 테스터가 켜져 있을 때만 응답한다.
func (s *Server) handlePods(w http.ResponseWriter, r *http.Request) {
	if !s.requestTesterAllowed(w, r) {
		return
	}
	ctx := r.Context()
	list, err := clientFrom(ctx).Kube.CoreV1().Pods(r.URL.Query().Get("ns")).List(ctx, metav1.ListOptions{})
	if err != nil {
		writeK8sError(w, err)
		return
	}
	out := make([]podRef, 0, len(list.Items))
	for i := range list.Items {
		p := &list.Items[i]
		if p.Status.Phase != "Running" {
			continue
		}
		ref := podRef{Name: p.Name, Ready: true}
		for _, c := range p.Spec.Containers {
			ref.Containers = append(ref.Containers, c.Name)
			if c.Name == "istio-proxy" {
				ref.Mesh = true
			}
		}
		for _, cs := range p.Status.ContainerStatuses {
			if !cs.Ready {
				ref.Ready = false
			}
		}
		out = append(out, ref)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	writeJSON(w, http.StatusOK, out)
}

// requestTesterAllowed enforces the opt-in flag and the admin role.
func (s *Server) requestTesterAllowed(w http.ResponseWriter, r *http.Request) bool {
	if !s.requestTester {
		writeError(w, http.StatusForbidden, "Forbidden",
			"요청 테스터가 비활성화되어 있습니다 (헬름 값 requestTester.enabled=true 필요)")
		return false
	}
	if identityFrom(r.Context()).Role != "admin" {
		writeError(w, http.StatusForbidden, "Forbidden", "요청 테스터는 admin만 쓸 수 있습니다")
		return false
	}
	return true
}

type reqTestInput struct {
	Namespace string            `json:"namespace"`
	Pod       string            `json:"pod"`
	Container string            `json:"container"`
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers"`
	Body      string            `json:"body"`
	TimeoutS  int               `json:"timeoutSeconds"`
}

type reqTestResult struct {
	Status     int               `json:"status,omitempty"`
	StatusText string            `json:"statusText,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	Body       string            `json:"body,omitempty"`
	DurationMs int64             `json:"durationMs"`
	Truncated  bool              `json:"truncated,omitempty"`
	Error      string            `json:"error,omitempty"`
	Hint       string            `json:"hint,omitempty"` // Istio 문맥 해석
}

// handleRequestTest sends one HTTP request from inside the chosen pod.
func (s *Server) handleRequestTest(w http.ResponseWriter, r *http.Request) {
	if !s.requestTesterAllowed(w, r) {
		return
	}
	id := identityFrom(r.Context())
	var in reqTestInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, reqTestMaxBody+8<<10)).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "BadRequest", "잘못된 요청 형식입니다")
		return
	}
	argv, err := buildCurlArgv(&in)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BadRequest", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(in.TimeoutS+5)*time.Second)
	defer cancel()
	start := time.Now()
	stdout, stderr, execErr := factoryFrom(r.Context()).
		ExecInPod(ctx, in.Namespace, in.Pod, in.Container, argv, reqTestMaxResponse)
	out := reqTestResult{DurationMs: time.Since(start).Milliseconds()}
	if stdout != "" {
		parseCurlOutput(stdout, &out)
	}
	if execErr != nil && out.Status == 0 {
		out.Error = summarizeExecError(execErr, stderr)
	}
	out.Hint = istioHint(out.Status, out.Body, out.Headers)
	out.Truncated = len(stdout) >= reqTestMaxResponse

	slog.Info("request test", slog.Bool("audit", true), slog.String("user", id.Name),
		slog.String("cluster", clusterFrom(r.Context())), slog.String("pod", in.Namespace+"/"+in.Pod),
		slog.String("method", in.Method), slog.String("url", in.URL), slog.Int("status", out.Status))
	writeJSON(w, http.StatusOK, out)
}

// buildCurlArgv validates the input and builds argv — 셸을 거치지 않으므로
// 값이 그대로 인자가 되고, 검증만 통과하면 인젝션 여지가 없다.
func buildCurlArgv(in *reqTestInput) ([]string, error) {
	if in.Namespace == "" || in.Pod == "" {
		return nil, fmt.Errorf("출발 파드를 선택하세요")
	}
	in.Method = strings.ToUpper(strings.TrimSpace(in.Method))
	if in.Method == "" {
		in.Method = "GET"
	}
	if !reqTestMethods[in.Method] {
		return nil, fmt.Errorf("지원하지 않는 메서드입니다: %s", in.Method)
	}
	u, err := url.Parse(strings.TrimSpace(in.URL))
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("URL 형식이 잘못되었습니다 (예: http://svc.ns:8080/path)")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("http/https만 지원합니다")
	}
	if in.TimeoutS <= 0 {
		in.TimeoutS = 10
	}
	if in.TimeoutS > reqTestMaxTimeout {
		in.TimeoutS = reqTestMaxTimeout
	}
	if len(in.Body) > reqTestMaxBody {
		return nil, fmt.Errorf("요청 본문이 너무 큽니다 (최대 %dKB)", reqTestMaxBody>>10)
	}
	argv := []string{"curl", "-sS", "-i", "--max-time", fmt.Sprint(in.TimeoutS), "-X", in.Method}
	for _, k := range sortedHeaderKeys(in.Headers) {
		v := in.Headers[k]
		if strings.ContainsAny(k, "\r\n: ") || strings.ContainsAny(v, "\r\n") {
			return nil, fmt.Errorf("헤더 이름/값에 쓸 수 없는 문자가 있습니다: %s", k)
		}
		argv = append(argv, "-H", k+": "+v)
	}
	if in.Body != "" {
		argv = append(argv, "--data-binary", in.Body)
	}
	argv = append(argv, "--", u.String()) // "--" 이후는 옵션으로 해석되지 않는다
	return argv, nil
}

func sortedHeaderKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		if strings.TrimSpace(k) != "" {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

// parseCurlOutput splits "curl -i" output into status line, headers and body.
func parseCurlOutput(raw string, out *reqTestResult) {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	head, body, found := strings.Cut(raw, "\n\n")
	if !found {
		out.Body = raw
		return
	}
	lines := strings.Split(head, "\n")
	if len(lines) == 0 {
		out.Body = body
		return
	}
	if parts := strings.SplitN(lines[0], " ", 3); len(parts) >= 2 && strings.HasPrefix(parts[0], "HTTP/") {
		fmt.Sscanf(parts[1], "%d", &out.Status)
		if len(parts) == 3 {
			out.StatusText = parts[2]
		}
	}
	out.Headers = map[string]string{}
	for _, l := range lines[1:] {
		if k, v, ok := strings.Cut(l, ":"); ok {
			out.Headers[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
		}
	}
	out.Body = body
}

func summarizeExecError(err error, stderr string) string {
	msg := strings.TrimSpace(stderr)
	switch {
	case strings.Contains(msg, "executable file not found"), strings.Contains(msg, "no such file or directory"):
		return "이 컨테이너에 curl이 없습니다 (distroless 이미지 등). curl이 있는 다른 파드를 고르세요."
	case msg != "":
		return msg
	default:
		return err.Error()
	}
}

// istioHint translates common mesh failures into an actionable sentence.
func istioHint(status int, body string, headers map[string]string) string {
	switch {
	case status == 403 && strings.Contains(body, "RBAC: access denied"):
		return "AuthorizationPolicy가 요청을 거부했습니다."
	case status == 503 && strings.Contains(body, "upstream connect error"):
		return "사이드카가 업스트림에 연결하지 못했습니다 — mTLS 설정 불일치이거나 정상 엔드포인트가 없습니다."
	case status == 404 && headers["server"] == "istio-envoy":
		return "Envoy까지는 갔지만 매치되는 라우트가 없습니다 — 호스트/경로를 확인하세요 (경로 확인 기능으로 대조해 보세요)."
	case status == 0:
		return ""
	case headers["server"] != "istio-envoy" && headers["x-envoy-upstream-service-time"] == "":
		return "응답에 Envoy 흔적이 없습니다 — 사이드카를 거치지 않았을 수 있습니다(메시 밖 파드이거나 직접 접근)."
	}
	return ""
}
