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

const [prometheus, hostPrometheus, filebeat, hostFilebeat, alerts, compose, dashboardProvisioning, dashboardSource, prometheusDatasource, elasticsearchDatasource, launcher] = await Promise.all([
  read('deploy/docker-drama/prometheus/prometheus.yml'),
  read('deploy/docker-drama/prometheus/prometheus-host.yml'),
  read('deploy/docker-drama/filebeat/filebeat.yml'),
  read('deploy/docker-drama/filebeat/filebeat-host.yml'),
  read('deploy/docker-drama/prometheus/alerts.yml'),
  read('deploy/docker-drama/docker-compose.yaml'),
  read('deploy/docker-drama/grafana/provisioning/dashboards/dashboard.yml'),
  read('deploy/docker-drama/grafana/dashboards/platform-reliability.json'),
  read('deploy/docker-drama/grafana/provisioning/datasources/prometheus.yml'),
  read('deploy/docker-drama/grafana/provisioning/datasources/elasticsearch.yml'),
  read('../run-platform-dev.ts'),
])

const requiredTargets = ['java-gateway:8080', 'identity:8080', 'java-notification:8080', 'java-reporting:8080', 'creation:8080', 'java-quota:8080', 'ai:8080', 'java-billing:8080', 'rabbitmq:15692']
for (const target of requiredTargets) assert(prometheus.includes(target), `Prometheus target is missing: ${target}`)
assert(prometheus.includes('/etc/prometheus/alerts.yml'), 'Prometheus does not load the alert rule file')
for (const value of ['host-targets/gateway.json', 'host-targets/services.json']) {
  assert(hostPrometheus.includes(value), `Host Prometheus configuration is missing: ${value}`)
}
assert(hostFilebeat.includes('/var/log/dramaip/*.log'), 'Host Filebeat configuration does not collect local Java NDJSON logs')
assert(hostFilebeat.includes('ndjson'), 'Host Filebeat configuration does not parse JSON logs')
assert(hostFilebeat.includes('normalize-service-field'), 'Host Filebeat does not normalize ECS service objects')
assert(filebeat.includes('decode_json_fields'), 'Compose Filebeat configuration does not decode container JSON logs')
assert(filebeat.includes('normalize-service-field'), 'Compose Filebeat does not normalize ECS service objects')
assert(filebeat.includes('file_identity.native') && hostFilebeat.includes('file_identity.native'), 'Filebeat must keep distinct Docker log files by mounted inode')
assert(filebeat.includes('dramaip-logs-java-') && hostFilebeat.includes('dramaip-logs-java-'), 'Filebeat must write the Java log index')
assert(compose.includes('dramaip-java-index-template.json'), 'Compose must install the Java log index mapping')
assert(compose.includes('./prometheus/alerts.yml:/etc/prometheus/alerts.yml:ro'), 'Compose does not mount alert rules')
assert(compose.includes('./grafana/dashboards:/var/lib/grafana/dashboards:ro'), 'Compose does not mount Grafana dashboards')
assert(alerts.includes('docs/OBSERVABILITY.md#'), 'Every alert must point to the observability runbook')

const requiredAlerts = [
  'DramaipTargetDown',
  'DramaipHighRequestErrorRate',
  'DramaipPaymentConfirmationFailed',
  'DramaipQuotaRejectionsHigh',
  'DramaipOutboxBacklog',
  'DramaipRabbitMQQueueBacklog',
  'DramaipDatabasePoolSaturated',
  'DramaipProviderFailureRate',
  'DramaipProviderLatencyHigh',
  'DramaipProviderCostAlert',
  'DramaipErrorAggregationHigh',
]
for (const alert of requiredAlerts) assert(alerts.includes(`alert: ${alert}`), `Alert rule is missing: ${alert}`)
for (const metric of ['dramaip_requests_total', 'dramaip_business_events_total', 'dramaip_quota_reservations_total', 'dramaip_outbox_pending_events', 'rabbitmq_queue_messages_ready', 'dramaip_db_connections', 'dramaip_db_max_open_connections', 'dramaip_provider_requests_total', 'dramaip_provider_cost_alerts_total', 'dramaip_errors_total']) {
  assert(alerts.includes(metric), `Alert rules do not cover metric: ${metric}`)
}
assert(!/error_message|trace_id|request_id|user_id|prompt|body/i.test(alerts), 'Alert labels must not include sensitive or high-cardinality fields')

const dashboard = JSON.parse(dashboardSource)
assert(dashboard.uid === 'dramaip-platform-reliability', 'Unexpected Grafana dashboard UID')
const expressions = dashboard.panels.flatMap((panel) => panel.targets ?? []).map((target) => target.expr ?? '')
for (const metric of ['dramaip_requests_total', 'dramaip_business_events_total', 'dramaip_quota_reservations_total', 'dramaip_outbox_pending_events', 'rabbitmq_queue_messages_ready', 'dramaip_db_connections', 'dramaip_db_wait_count', 'dramaip_provider_requests_total', 'dramaip_provider_cost_alerts_total', 'dramaip_errors_total', 'dramaip_request_duration_seconds_bucket']) {
  assert(expressions.some((expression) => expression.includes(metric)), `Dashboard does not graph metric: ${metric}`)
}
assert(dashboard.panels.every((panel) => panel.datasource?.uid === 'dramaip-prometheus'), 'Dashboard panels must use the provisioned Prometheus source')
assert(dashboardProvisioning.includes('/var/lib/grafana/dashboards'), 'Grafana dashboard provider path is incorrect')
assert(prometheusDatasource.includes('uid: dramaip-prometheus'), 'Prometheus datasource UID is missing')
assert(elasticsearchDatasource.includes('uid: elasticsearch'), 'Elasticsearch datasource UID is missing')
assert(elasticsearchDatasource.includes('type: elasticsearch'), 'Grafana must use the Elasticsearch datasource')
assert(elasticsearchDatasource.includes('[dramaip-logs-java-]YYYY.MM.DD'), 'Grafana Elasticsearch datasource must use the daily Java log index pattern')
for (const image of [
  'elastic/filebeat:9.4.2',
  'elasticsearch:9.4.2',
  'kibana:9.4.2',
]) assert(compose.includes(image), `Elastic Stack image is missing: ${image}`)
assert(!/opensearch|fluent-bit/i.test(compose), 'Compose must not retain the legacy OpenSearch or Fluent Bit stack')
for (const value of ['OTEL_JAVAAGENT_OPTS', 'OTEL_METRICS_EXPORTER: none', 'OTEL_LOGS_EXPORTER: none', 'host.docker.internal:host-gateway']) {
  assert(compose.includes(value), `Compose observability configuration is missing: ${value}`)
}
assert(compose.includes('JAVA_OPTS: "${JAVA_OPTS:--Xms64m -Xmx256m -XX:+UseG1GC}"'), 'Compose must bound local Java heaps')
for (const value of ['--obs', 'requireObservabilityAgent', 'writeHostPrometheusTargets', 'host.docker.internal:8080', 'DOCKER_OBSERVABILITY_SERVICES']) {
  assert(launcher.includes(value), `Host development launcher is missing observability support: ${value}`)
}

console.log(JSON.stringify({ ok: true, alerts: requiredAlerts.length, panels: dashboard.panels.length }, null, 2))
