{{- define "istio-dashboard.name" -}}{{ .Chart.Name }}{{- end -}}

{{- define "istio-dashboard.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "istio-dashboard.labels" -}}
app.kubernetes.io/name: {{ include "istio-dashboard.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "istio-dashboard.selectorLabels" -}}
app.kubernetes.io/name: {{ include "istio-dashboard.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
