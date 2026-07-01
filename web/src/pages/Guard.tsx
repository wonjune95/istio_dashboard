export function Guard() {
  return (
    <div className="mx-auto max-w-2xl rounded border bg-white p-8 shadow-sm">
      <h2 className="mb-2 text-xl font-semibold">
        Gateway API / Istio가 설치되지 않았습니다
      </h2>
      <p className="mb-4 text-gray-600">
        이 대시보드는 <code className="rounded bg-gray-100 px-1">HTTPRoute</code>(Gateway API)
        또는 <code className="rounded bg-gray-100 px-1">VirtualService</code>(Istio) 리소스를
        관리합니다. 클러스터에 둘 중 하나가 설치되어 있어야 합니다.
      </p>
      <pre className="overflow-x-auto rounded bg-gray-900 p-4 text-sm leading-relaxed text-gray-100">
{`# Gateway API CRDs (HTTPRoute)
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.0/standard-install.yaml

# 또는 Istio 설치 (VirtualService 포함)
istioctl install`}
      </pre>
      <p className="mt-4 text-sm text-gray-500">
        설치 후 이 페이지를 새로고침하세요.
      </p>
    </div>
  )
}
