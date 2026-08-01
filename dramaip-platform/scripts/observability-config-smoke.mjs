#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function read(relativePath) {
  return readFile(resolve(root, relativePath), 'utf8')
}

const [prometheus, alerts, compose, dashboardProvisioning, dashboardSource, prometheusDatasource, elasticsearchDatasource] = await Promise.all([
  read('deploy/docker-drama/prometheus/prometheus.yml'),
  read('deploy/docker-drama/prometheus/alerts.yml'),
  read('deploy/docker-drama/docker-compose.yaml'),
  read('deploy/docker-drama/grafana/provisioning/dashboards/dashboard.yml'),
  read('deploy/docker-drama/grafana/dashboards/platform-reliability.json'),
  read('deploy/docker-drama/grafana/provisioning/datasources/prometheus.yml'),
  read('deploy/docker-drama/grafana/provisioning/datasources/elasticsearch.yml'),
])

const requiredTargets = ['web-bff:8100', 'billing:8103', 'quota:8104', 'ai-gateway:8105', 'billing-job:8106', 'rabbitmq:15692']
for (const target of requiredTargets) assert(prometheus.includes(target), `Prometheus target is missing: ${target}`)
assert(prometheus.includes('/etc/prometheus/alerts.yml'), 'Prometheus does not load the alert rule file')
assert(compose.includes('./prometheus/alerts.yml:/etc/prometheus/alerts.yml:ro'), 'Compose does not mount alert rules')
assert(compose.includes('./grafana/dashboards:/var/lib/grafana/dashboards:ro'), 'Compose does not mount Grafana dashboards')
assert(alerts.includes('LM3-22-指标告警与错误聚合.md#'), 'Every alert must point to the LM3-22 runbook')

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
assert(dashboard.panels.every((panel) => panel.datasource?.uid === 'prometheus'), 'Dashboard panels must use the provisioned Prometheus source')
assert(dashboardProvisioning.includes('/var/lib/grafana/dashboards'), 'Grafana dashboard provider path is incorrect')
assert(prometheusDatasource.includes('uid: prometheus'), 'Prometheus datasource UID is missing')
assert(elasticsearchDatasource.includes('uid: elasticsearch'), 'Elasticsearch datasource UID is missing')
assert(elasticsearchDatasource.includes('type: elasticsearch'), 'Grafana must use the Elasticsearch datasource')
for (const image of [
  'elastic/filebeat:9.4.2',
  'elasticsearch:9.4.2',
  'kibana:9.4.2',
]) assert(compose.includes(image), `Elastic Stack image is missing: ${image}`)
assert(!/opensearch|fluent-bit/i.test(compose), 'Compose must not retain the legacy OpenSearch or Fluent Bit stack')

console.log(JSON.stringify({ ok: true, alerts: requiredAlerts.length, panels: dashboard.panels.length }, null, 2))
