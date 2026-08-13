{{- define "periplus.name" -}}{{ .Chart.Name }}{{- end -}}

{{- define "periplus.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "periplus.labels" -}}
app.kubernetes.io/name: {{ include "periplus.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "periplus.selectorLabels" -}}
app.kubernetes.io/name: {{ include "periplus.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
