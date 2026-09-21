#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function read(relativePath) {
  return readFile(resolve(root, relativePath), 'utf8')
}

const [prometheus, hostPrometheus, alerts, compose, alloy, loki, tempo,
  dashboardProvisioning, dashboardSource, prometheusDatasource, lokiDatasource,
  tempoDatasource, launcher, helmValues, helmDevValues, helmStagingValues,
  helmTemporaryValues, helmObservability, helmJava, helmDevInfra,
  helmRelease, helmAlerts, helmDashboardSource, helmSchema, helmPrometheusRule,
  makefile, gitlabCI, runtimeSmoke, logCanary, javaDockerfile] = await Promise.all([
  read('deploy/docker-drama/prometheus/prometheus.yml'),
  read('deploy/docker-drama/prometheus/prometheus-host.yml'),
  read('deploy/docker-drama/prometheus/alerts.yml'),
  read('deploy/docker-drama/docker-compose.yaml'),
  read('deploy/docker-drama/alloy/config.alloy'),
  read('deploy/docker-drama/loki/config.yaml'),
  read('deploy/docker-drama/tempo/config.yaml'),
  read('deploy/docker-drama/grafana/provisioning/dashboards/dashboard.yml'),
  read('deploy/docker-drama/grafana/dashboards/platform-reliability.json'),
  read('deploy/docker-drama/grafana/provisioning/datasources/prometheus.yml'),
  read('deploy/docker-drama/grafana/provisioning/datasources/loki.yml'),
  read('deploy/docker-drama/grafana/provisioning/datasources/tempo.yml'),
  read('../run-platform-dev.ts'),
  read('deploy/helm/dramaip-platform/values.yaml'),
  read('deploy/helm/dramaip-platform/values-dev.yaml'),
  read('deploy/helm/dramaip-platform/values-staging.yaml'),
  read('deploy/helm/dramaip-platform/values-staging-temporary.yaml'),
  read('deploy/helm/dramaip-platform/templates/observability.yaml'),
  read('deploy/helm/dramaip-platform/templates/java-stack.yaml'),
  read('deploy/helm/dramaip-platform/templates/dev-infra.yaml'),
  read('deploy/release/helm-release.sh'),
  read('deploy/helm/dramaip-platform/files/prometheus/alerts.yml'),
  read('deploy/helm/dramaip-platform/files/grafana/platform-reliability.json'),
  read('deploy/helm/dramaip-platform/values.schema.json'),
  read('deploy/helm/dramaip-platform/templates/prometheus-rule.yaml'),
  read('Makefile'),
  read('../.gitlab-ci.yml'),
  read('scripts/observability-smoke.mjs'),
  read('scripts/observability-log-canary.mjs'),
  read('server/Dockerfile'),
])

const requiredTargets = [
  'java-gateway:8080', 'identity:8080', 'java-notification:8080',
  'java-reporting:8080', 'creation:8080', 'java-quota:8080', 'ai:8080',
  'java-billing:8080', 'rabbitmq:15692', 'alloy:12345', 'loki:3100',
  'tempo:3200',
]
for (const target of requiredTargets) {
  assert(prometheus.includes(target), `Prometheus target is missing: ${target}`)
}
assert(prometheus.includes('/etc/prometheus/alerts.yml'), 'Prometheus does not load the alert rule file')
for (const value of ['host-targets/gateway.json', 'host-targets/services.json']) {
  assert(hostPrometheus.includes(value), `Host Prometheus configuration is missing: ${value}`)
}
for (const target of ['alloy:12345', 'loki:3100', 'tempo:3200']) {
  assert(hostPrometheus.includes(target), `Host Prometheus target is missing: ${target}`)
}

for (const value of [
  'otelcol.receiver.otlp', 'otelcol.processor.memory_limiter',
  'otelcol.processor.transform', 'sanitize_traces',
  'delete_matching_keys', 'delete_key(attributes, "url.full")',
  'otelcol.processor.batch', 'otelcol.exporter.otlp', 'discovery.docker',
  'loki.source.docker', 'loki.source.file', 'DRAMAIP_HOST_LOG_GLOB',
  'tail_from_end', 'restart_from_end', 'stage.drop', 'sensitive_content',
  'authorization|cookie', 'prompt|password|passwd|secret',
  'api[-_.]?key|apikey|credential', 'request[-_.]?body', 'user[-_.]?id',
  'tail_from_end', 'restart_from_end', 'loki.write',
  'http://loki:3100/loki/api/v1/push',
]) {
  assert(alloy.includes(value), `Alloy configuration is missing: ${value}`)
}
for (const field of ['trace_id', 'span_id', 'request_id', 'operation']) {
  assert(alloy.includes(field), `Alloy does not retain ${field}`)
}
const labelStage = alloy.match(/stage\.labels\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? ''
assert(labelStage.includes('service_name'), 'Alloy must index the normalized service_name label')
assert(!/trace_id|span_id|request_id|operation/.test(labelStage), 'Correlation identifiers must not be Loki index labels')

assert(loki.includes('store: tsdb') && loki.includes('schema: v13'), 'Loki must use the single-node TSDB schema')
assert(loki.includes('allow_structured_metadata: true'), 'Loki structured metadata must be enabled')
assert(loki.includes('retention_enabled: true') && loki.includes('retention_period: 720h'), 'Loki must retain local logs for 720h')
assert(tempo.includes('backend: local') && tempo.includes('path: /var/lib/tempo/wal'), 'Tempo must use local filesystem and WAL storage')
assert(tempo.includes('block_retention: 720h'), 'Tempo must retain local trace blocks for 720h')

assert(compose.includes('./prometheus/alerts.yml:/etc/prometheus/alerts.yml:ro'), 'Compose does not mount alert rules')
assert(compose.includes('./grafana/dashboards:/var/lib/grafana/dashboards:ro'), 'Compose does not mount Grafana dashboards')
for (const image of [
  'prom/prometheus:v3.11.3', 'grafana/alloy:v1.19.2', 'grafana/loki:3.7.3',
  'grafana/tempo:3.0.2', 'grafana/grafana:12.3.8',
]) {
  assert(compose.includes(image), `Compose image is missing: ${image}`)
}
for (const retired of ['otel-collector:', 'jaeger:', 'filebeat:', 'elasticsearch:', 'kibana:']) {
  assert(!compose.includes(retired), `Compose still contains retired service or endpoint: ${retired}`)
}
for (const bind of [
  '127.0.0.1:${PROMETHEUS_HOST_PORT:-9090}:9090',
  '127.0.0.1:${ALLOY_HOST_PORT:-12345}:12345',
  '127.0.0.1:${ALLOY_OTLP_GRPC_HOST_PORT:-4317}:4317',
  '127.0.0.1:${ALLOY_OTLP_HTTP_HOST_PORT:-4318}:4318',
  '127.0.0.1:${LOKI_HOST_PORT:-3100}:3100',
  '127.0.0.1:${TEMPO_HOST_PORT:-3200}:3200',
  '127.0.0.1:${GRAFANA_HOST_PORT:-3000}:3000',
]) {
  assert(compose.includes(bind), `Management port is not loopback-only: ${bind}`)
}
for (const value of [
  'OTEL_JAVAAGENT_OPTS', 'OTEL_METRICS_EXPORTER: none',
  'OTEL_LOGS_EXPORTER: none', 'http://alloy:4318',
  'host.docker.internal:host-gateway',
]) {
  assert(compose.includes(value), `Compose observability configuration is missing: ${value}`)
}
assert(compose.includes('JAVA_OPTS: "${JAVA_OPTS:--Xms64m -Xmx256m -XX:+UseG1GC}"'), 'Compose must bound local Java heaps')
for (const value of [
  'observability-canary:', 'profiles: [observability-test]',
  'observability-log-canary.mjs', 'DRAMAIP_OBSERVABILITY_CANARY',
  'DRAMAIP_DEPLOYMENT_ENVIRONMENT', 'DRAMAIP_SERVICE_VERSION',
  'DRAMAIP_RELEASE_NAME',
]) {
  assert(compose.includes(value), `Compose E2E/resource contract is missing: ${value}`)
}

assert(alerts.includes('docs/OBSERVABILITY.md#'), 'Every alert must point to the observability runbook')
const requiredAlerts = [
  'DramaipTargetDown', 'DramaipHighRequestErrorRate',
  'DramaipPaymentConfirmationFailed', 'DramaipQuotaRejectionsHigh',
  'DramaipOutboxBacklog', 'DramaipRabbitMQQueueBacklog',
  'DramaipDatabasePoolSaturated', 'DramaipProviderFailureRate',
  'DramaipProviderLatencyHigh', 'DramaipProviderCostAlert',
  'DramaipErrorAggregationHigh',
  'DramaipAlloyTraceExportFailures', 'DramaipAlloyTraceQueueSaturated',
  'DramaipAlloyLogWriteDrops', 'DramaipAlloyLogWriteRetriesHigh',
  'DramaipSensitiveLogRejected',
  'DramaipLokiDiscardingLogs', 'DramaipLokiWalCorruption',
  'DramaipLokiWalDiskPressure', 'DramaipLokiWalWriteFailures',
  'DramaipTempoDiscardingSpans',
]
for (const alert of requiredAlerts) {
  assert(alerts.includes(`alert: ${alert}`), `Alert rule is missing: ${alert}`)
}
for (const metric of [
  'dramaip_requests_total', 'dramaip_business_events_total',
  'dramaip_quota_reservations_total', 'dramaip_outbox_pending_events',
  'rabbitmq_queue_messages_ready', 'dramaip_db_connections',
  'dramaip_db_max_open_connections', 'dramaip_provider_requests_total',
  'dramaip_provider_cost_alerts_total', 'dramaip_errors_total',
  'otelcol_exporter_send_failed_spans_total', 'otelcol_exporter_queue_size',
  'otelcol_exporter_queue_capacity', 'loki_write_dropped_entries_total',
  'loki_write_batch_retries_total', 'loki_process_dropped_lines_total',
  'loki_discarded_samples_total',
  'loki_ingester_wal_corruptions_total', 'loki_ingester_wal_disk_usage_percent',
  'loki_ingester_wal_disk_full_failures_total', 'tempo_discarded_spans_total',
]) {
  assert(alerts.includes(metric), `Alert rules do not cover metric: ${metric}`)
}
assert(!/error_message|trace_id|request_id|user_id|prompt|body/i.test(alerts), 'Alert labels must not include sensitive or high-cardinality fields')
assert(alerts.includes('alloy|loki|tempo'), 'TargetDown must cover Alloy, Loki and Tempo')

const dashboard = JSON.parse(dashboardSource)
assert(dashboard.uid === 'dramaip-platform-reliability', 'Unexpected Grafana dashboard UID')
const expressions = dashboard.panels.flatMap((panel) => panel.targets ?? []).map((target) => target.expr ?? '')
for (const metric of [
  'dramaip_requests_total', 'dramaip_business_events_total',
  'dramaip_quota_reservations_total', 'dramaip_outbox_pending_events',
  'rabbitmq_queue_messages_ready', 'dramaip_db_connections',
  'dramaip_db_wait_count', 'dramaip_provider_requests_total',
  'dramaip_provider_cost_alerts_total', 'dramaip_workflow_events_total',
  'dramaip_errors_total',
  'dramaip_request_duration_seconds_bucket',
  'otelcol_exporter_send_failed_spans_total', 'otelcol_exporter_sent_spans_total',
  'otelcol_exporter_queue_size', 'otelcol_exporter_queue_capacity',
  'loki_write_dropped_entries_total', 'loki_write_sent_entries_total',
  'loki_write_batch_retries_total', 'loki_process_dropped_lines_total',
  'loki_discarded_samples_total',
  'loki_ingester_wal_corruptions_total', 'loki_ingester_wal_disk_usage_percent',
  'loki_ingester_wal_disk_full_failures_total', 'tempo_discarded_spans_total',
  'tempo_distributor_spans_received_total',
]) {
  assert(expressions.some((expression) => expression.includes(metric)), `Dashboard does not graph metric: ${metric}`)
}
const logPanel = dashboard.panels.find((panel) => panel.type === 'logs')
assert(logPanel?.datasource?.uid === 'dramaip-loki', 'Dashboard must include a Loki error-log panel')
assert(dashboard.panels.filter((panel) => panel.type !== 'logs').every((panel) => panel.datasource?.uid === 'dramaip-prometheus'), 'Metric panels must use DramaIP Prometheus')
assert(dashboardProvisioning.includes('/var/lib/grafana/dashboards'), 'Grafana dashboard provider path is incorrect')
assert(expressions.some((expression) => expression.includes('sum by (service) (dramaip_db_max_open_connections)')), 'Database utilization must aggregate both sides by service')
assert(alerts === helmAlerts, 'Compose and Helm Prometheus alert rules have drifted')
assert(dashboardSource === helmDashboardSource, 'Compose and Helm Grafana dashboards have drifted')

assert(prometheusDatasource.includes('uid: dramaip-prometheus'), 'Prometheus datasource UID is missing')
assert(lokiDatasource.includes('uid: dramaip-loki') && lokiDatasource.includes('datasourceUid: dramaip-tempo'), 'Loki datasource must link trace_id to Tempo')
assert(tempoDatasource.includes('uid: dramaip-tempo'), 'Tempo datasource UID is missing')
for (const value of [
  'tracesToLogsV2', 'datasourceUid: dramaip-loki', 'key: service.name',
  'value: service_name', 'tracesToMetrics',
  'datasourceUid: dramaip-prometheus', 'value: service',
]) {
  assert(tempoDatasource.includes(value), `Tempo correlations are missing: ${value}`)
}

for (const value of [
  '--obs', 'requireObservabilityAgent', 'writeHostPrometheusTargets',
  'host.docker.internal:8080', 'DOCKER_OBSERVABILITY_SERVICES',
  'DRAMAIP_HOST_LOG_DIR',
]) {
  assert(launcher.includes(value), `Host development launcher is missing observability support: ${value}`)
}
assert(!launcher.includes('DRAMAIP_FILEBEAT_CONFIG'), 'Host launcher must not retain Filebeat variables')

for (const value of [
  'observability:', 'enabled: false', 'endpoint: ""',
  'headersSecretName: ""', 'headersSecretKey: OTEL_EXPORTER_OTLP_HEADERS',
  'sampler: always_on', 'samplerArg: ""', 'scrape: true',
  'alerting:', 'notificationRoute: ""', 'retention: 720h',
  'prometheus: prom/prometheus:v3.11.3', 'alloy: grafana/alloy:v1.19.2',
  'loki: grafana/loki:3.7.3', 'tempo: grafana/tempo:3.0.2',
  'grafana: grafana/grafana:12.3.8',
]) {
  assert(helmValues.includes(value), `Helm values interface is missing: ${value}`)
}
for (const values of [helmDevValues, helmTemporaryValues]) {
  assert(values.includes('observability:') && values.includes('enabled: true'), 'Dev and temporary staging must enable observability')
  assert(values.includes('embedded:') && values.includes('enabled: true'), 'Dev and temporary staging must enable the embedded stack')
}
assert(helmStagingValues.includes('enabled: false') && helmStagingValues.includes('https://alloy.staging.internal:4318'), 'Ordinary staging must use external observability')
for (const component of ['prometheus', 'alloy', 'loki', 'tempo', 'grafana']) {
  assert(helmObservability.includes(`observability-${component}`), `Embedded Helm stack is missing: ${component}`)
}
for (const value of [
  'kind: Role', 'kind: RoleBinding', 'resources: ["pods/log"]',
  'discovery.kubernetes', 'app.kubernetes.io/instance={{ .Release.Name }}',
  'emptyDir:', 'hostPath:', 'type: ClusterIP',
  'requires observability.enabled=true', 'requires devInfra.enabled=true',
  'headersSecretName is only valid with external observability',
]) {
  assert(helmObservability.includes(value), `Helm observability template is missing: ${value}`)
}
for (const value of [
  'OTEL_JAVAAGENT_OPTS', 'OTEL_SERVICE_NAME', 'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_PROTOCOL', 'OTEL_METRICS_EXPORTER',
  'OTEL_LOGS_EXPORTER', 'OTEL_PROPAGATORS', 'OTEL_TRACES_SAMPLER',
  'OTEL_TRACES_SAMPLER_ARG', 'DRAMAIP_DEPLOYMENT_ENVIRONMENT',
  'DRAMAIP_SERVICE_VERSION', 'DRAMAIP_RELEASE_NAME',
  'prometheus.io/scrape', '/actuator/prometheus',
]) {
  assert(helmJava.includes(value), `Java Helm telemetry contract is missing: ${value}`)
}
assert(helmDevInfra.includes('port: 15692') && helmDevInfra.includes('containerPort: 15692'), 'RabbitMQ Helm service must expose metrics')
assert(!/otel-collector|dev-otel/.test(helmDevInfra), 'devInfra must not retain the old Collector')
for (const value of [
  'DRAMAIP_OTEL_ENDPOINT', 'DRAMAIP_OTEL_HEADERS_SECRET_NAME',
  'DRAMAIP_OTEL_HEADERS_SECRET_KEY', 'DRAMAIP_ALERT_NOTIFICATION_ROUTE',
  'prometheusrules.monitoring.coreos.com',
]) {
  assert(helmRelease.includes(value), `Helm release contract is missing: ${value}`)
}
assert(!helmRelease.includes('images.tsv') || !/observability\.embedded\.images/.test(helmRelease), 'Third-party observability images must not enter the application image manifest loop')

for (const value of [
  'kind: PrometheusRule', 'monitoring.coreos.com/v1',
  'notification_route', 'dramaip_release', 'team',
  'observability.dramaip.io/rule-set',
]) {
  assert(helmPrometheusRule.includes(value), `External alert notification contract is missing: ${value}`)
}
assert(helmSchema.includes('^[A-Za-z0-9_.:-]*$'), 'Helm schema must constrain the notification route')
for (const value of ['cpuQuantity', 'memoryQuantity', 'storageQuantity', '"maxLength": 0']) {
  assert(helmSchema.includes(value), `Helm schema is missing an observability safety constraint: ${value}`)
}

for (const value of [
  '--profile observability', '--profile observability-test',
  'CI_OBSERVABILITY_PORTS', "OTEL_JAVAAGENT_OPTS='$(OTEL_JAVAAGENT_OPTS)'",
  'DRAMAIP_PROMETHEUS_URL', 'DRAMAIP_ALLOY_OTLP_HTTP_URL',
  'DRAMAIP_LOKI_URL', 'DRAMAIP_TEMPO_URL',
  'DRAMAIP_LOG_CANARY_EXPECTED=true',
]) {
  assert(makefile.includes(value), `Docker CI observability E2E contract is missing: ${value}`)
}
assert(gitlabCI.includes('make platform-ci-e2e'), 'GitLab must execute the full Platform E2E target')
assert(gitlabCI.includes('--profile observability --profile observability-test'), 'GitLab failure artifacts must include observability logs')
for (const value of [
  'assertNoSensitiveTelemetry', 'Tempo sensitive canary trace',
  'sendDirectSensitiveTrace', 'Tempo direct OTLP sensitive canary trace',
  'DRAMAIP_ALLOY_OTLP_HTTP_URL',
  'Loki synthetic log canary witness', 'loki_process_dropped_lines_total',
  'Loki retained ${leakedCanaryLines.length}',
]) {
  assert(runtimeSmoke.includes(value), `Runtime sensitive-data gate is missing: ${value}`)
}
for (const value of [
  'pipeline_witness', 'sensitive_entry_must_be_dropped',
  'authorization', 'cookie', 'prompt', 'password', 'api_key',
  'client_secret', 'clientSecret', 'credentials', 'private_key',
  'access_token', 'request_body', 'user_id', 'unstructured credential',
]) {
  assert(logCanary.includes(value), `Synthetic log canary is missing: ${value}`)
}
for (const value of [
  'deployment.environment.name', 'service.version', 'service.namespace=dramaip-platform',
  'dramaip.release', 'DRAMAIP_RELEASE_NAME',
]) {
  assert(javaDockerfile.includes(value), `Java OTel resource defaults are missing: ${value}`)
}

console.log(JSON.stringify({ ok: true, alerts: requiredAlerts.length, panels: dashboard.panels.length }, null, 2))
