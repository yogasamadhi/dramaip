{{- define "dramaip-platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dramaip-platform.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "dramaip-platform.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/name: {{ include "dramaip-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "dramaip-platform.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dramaip-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "dramaip-platform.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "dramaip-platform.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "dramaip-platform.secretName" -}}
{{- default (printf "%s-secret" (include "dramaip-platform.fullname" .)) .Values.secret.existingSecret -}}
{{- end -}}

{{- define "dramaip-platform.observabilityEndpoint" -}}
{{- if .Values.observability.embedded.enabled -}}
{{- printf "http://%s-alloy:4318" (include "dramaip-platform.fullname" .) -}}
{{- else -}}
{{- required "observability.otlp.endpoint is required when external observability is enabled" .Values.observability.otlp.endpoint -}}
{{- end -}}
{{- end -}}

{{- define "dramaip-platform.observabilityScheduling" -}}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{- define "dramaip-platform.observabilityDataPermissions" -}}
{{- if .Values.devInfra.persistence.enabled }}
initContainers:
  - name: data-permissions
    # The Grafana image is already part of the fixed embedded image set and
    # contains the small POSIX toolset needed to prepare root-created hostPath.
    image: {{ .Values.observability.embedded.images.grafana | quote }}
    imagePullPolicy: {{ .Values.image.pullPolicy }}
    command: ["sh", "-ec", "chown 10001:10001 /data"]
    securityContext:
      runAsNonRoot: false
      runAsUser: 0
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
        add: ["CHOWN"]
    volumeMounts:
      - { name: data, mountPath: /data }
{{- end }}
{{- end -}}
