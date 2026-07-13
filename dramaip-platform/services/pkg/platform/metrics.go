package platform

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Metrics is a deliberately small process-local Prometheus registry. It keeps
// labels bounded at the instrumentation boundary and lets every standalone
// Kratos service expose the same metrics without a shared HTTP dependency.
// Prometheus provides persistence and cross-process aggregation.
type metricsRegistry struct {
	mu           sync.RWMutex
	counters     map[metricKey]float64
	gauges       map[metricKey]float64
	observations map[metricKey]metricObservation
}

type metricKey struct {
	name   string
	labels string
}

type metricObservation struct {
	count   float64
	sum     float64
	buckets []float64
}

// durationBuckets are shared by every duration metric. Keeping a fixed,
// deliberately small set makes request and provider latency percentile
// queries available without accepting caller-defined bucket labels.
var durationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30, 60}

var processMetrics = metricsRegistry{
	counters:     map[metricKey]float64{},
	gauges:       map[metricKey]float64{},
	observations: map[metricKey]metricObservation{},
}

func IncCounter(name string, labels map[string]string) {
	processMetrics.mu.Lock()
	defer processMetrics.mu.Unlock()
	processMetrics.counters[newMetricKey(name, labels)]++
}

func SetGauge(name string, value float64, labels map[string]string) {
	processMetrics.mu.Lock()
	defer processMetrics.mu.Unlock()
	processMetrics.gauges[newMetricKey(name, labels)] = value
}

func Observe(name string, value float64, labels map[string]string) {
	if value < 0 {
		value = 0
	}
	processMetrics.mu.Lock()
	defer processMetrics.mu.Unlock()
	key := newMetricKey(name, labels)
	current := processMetrics.observations[key]
	current.count++
	current.sum += value
	if current.buckets == nil {
		current.buckets = make([]float64, len(durationBuckets))
	}
	for index, upperBound := range durationBuckets {
		if value <= upperBound {
			current.buckets[index]++
		}
	}
	processMetrics.observations[key] = current
}

func ObserveRequest(transport, operation, outcome string, duration time.Duration) {
	labels := map[string]string{
		"transport": normalizeMetricValue(transport),
		"operation": normalizeMetricValue(operation),
		"outcome":   normalizeMetricValue(outcome),
	}
	IncCounter("dramaip_requests_total", labels)
	Observe("dramaip_request_duration_seconds", duration.Seconds(), labels)
}

func ObserveHTTP(method, path string, statusCode int, duration time.Duration) {
	outcome := "success"
	if statusCode >= 400 {
		outcome = "error"
	}
	ObserveRequest("http", strings.ToUpper(method)+" "+NormalizeHTTPRoute(path), outcome, duration)
}

func RecordBusinessEvent(event, outcome string) {
	IncCounter("dramaip_business_events_total", map[string]string{
		"event":   normalizeMetricValue(event),
		"outcome": normalizeMetricValue(outcome),
	})
}

func ObserveProvider(provider, outcome string, duration time.Duration) {
	labels := map[string]string{
		"provider": normalizeMetricValue(provider),
		"outcome":  normalizeMetricValue(outcome),
	}
	IncCounter("dramaip_provider_requests_total", labels)
	Observe("dramaip_provider_request_duration_seconds", duration.Seconds(), labels)
}

func RecordQuotaReservation(outcome string) {
	IncCounter("dramaip_quota_reservations_total", map[string]string{"outcome": normalizeMetricValue(outcome)})
}

func SetOutboxPending(value int64) {
	SetGauge("dramaip_outbox_pending_events", float64(value), nil)
}

func RecordCostAlert(event string) {
	IncCounter("dramaip_provider_cost_alerts_total", map[string]string{"event": normalizeMetricValue(event)})
}

// ReportError is the in-process error aggregation signal. It intentionally
// stores only a bounded class and operation in Prometheus; the correlated
// structured log and trace retain the diagnostic context without exporting an
// error message, request body, credential or prompt as a metric label.
func ReportError(_ context.Context, operation string, err error) {
	if err == nil {
		return
	}
	IncCounter("dramaip_errors_total", map[string]string{
		"operation": normalizeMetricValue(operation),
		"class":     errorClass(err),
	})
}

func errorClass(err error) string {
	if err == nil {
		return "none"
	}
	if code := status.Code(err); code != codes.Unknown {
		return strings.ToLower(code.String())
	}
	return "internal"
}

func ObserveDBStats(stats sql.DBStats) {
	SetGauge("dramaip_db_connections", float64(stats.OpenConnections), map[string]string{"state": "open"})
	SetGauge("dramaip_db_connections", float64(stats.InUse), map[string]string{"state": "in_use"})
	SetGauge("dramaip_db_connections", float64(stats.Idle), map[string]string{"state": "idle"})
	SetGauge("dramaip_db_max_open_connections", float64(stats.MaxOpenConnections), nil)
	SetGauge("dramaip_db_wait_count", float64(stats.WaitCount), nil)
	SetGauge("dramaip_db_wait_duration_seconds", stats.WaitDuration.Seconds(), nil)
}

func WritePrometheus(w io.Writer, service string) {
	processMetrics.mu.RLock()
	counters := copyMetrics(processMetrics.counters)
	gauges := copyMetrics(processMetrics.gauges)
	observations := copyObservations(processMetrics.observations)
	processMetrics.mu.RUnlock()

	_, _ = fmt.Fprintln(w, "# HELP dramaip_service_up Service process availability gauge.")
	_, _ = fmt.Fprintln(w, "# TYPE dramaip_service_up gauge")
	_, _ = fmt.Fprintf(w, "dramaip_service_up{service=%q} 1\n", service)
	writeScalarMetrics(w, "counter", counters, service)
	writeScalarMetrics(w, "gauge", gauges, service)
	writeObservationMetrics(w, observations, service)
}

func copyMetrics(source map[metricKey]float64) map[metricKey]float64 {
	copy := make(map[metricKey]float64, len(source))
	for key, value := range source {
		copy[key] = value
	}
	return copy
}

func copyObservations(source map[metricKey]metricObservation) map[metricKey]metricObservation {
	copy := make(map[metricKey]metricObservation, len(source))
	for key, value := range source {
		copy[key] = value
	}
	return copy
}

func writeScalarMetrics(w io.Writer, metricType string, values map[metricKey]float64, service string) {
	byName := map[string][]metricKey{}
	for key := range values {
		byName[key.name] = append(byName[key.name], key)
	}
	for _, name := range sortedNames(byName) {
		_, _ = fmt.Fprintf(w, "# TYPE %s %s\n", name, metricType)
		keys := byName[name]
		sort.Slice(keys, func(i, j int) bool { return keys[i].labels < keys[j].labels })
		for _, key := range keys {
			_, _ = fmt.Fprintf(w, "%s%s %s\n", key.name, renderMetricLabels(key.labels, service), formatMetricNumber(values[key]))
		}
	}
}

func writeObservationMetrics(w io.Writer, values map[metricKey]metricObservation, service string) {
	byName := map[string][]metricKey{}
	for key := range values {
		byName[key.name] = append(byName[key.name], key)
	}
	for _, name := range sortedNames(byName) {
		_, _ = fmt.Fprintf(w, "# TYPE %s histogram\n", name)
		keys := byName[name]
		sort.Slice(keys, func(i, j int) bool { return keys[i].labels < keys[j].labels })
		for _, key := range keys {
			value := values[key]
			labels := renderMetricLabels(key.labels, service)
			for index, upperBound := range durationBuckets {
				_, _ = fmt.Fprintf(w, "%s_bucket%s %s\n", key.name, renderMetricLabelsWithExtra(key.labels, service, "le", formatMetricNumber(upperBound)), formatMetricNumber(value.buckets[index]))
			}
			_, _ = fmt.Fprintf(w, "%s_bucket%s %s\n", key.name, renderMetricLabelsWithExtra(key.labels, service, "le", "+Inf"), formatMetricNumber(value.count))
			_, _ = fmt.Fprintf(w, "%s_sum%s %s\n", key.name, labels, formatMetricNumber(value.sum))
			_, _ = fmt.Fprintf(w, "%s_count%s %s\n", key.name, labels, formatMetricNumber(value.count))
		}
	}
}

func sortedNames[T any](values map[string][]T) []string {
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func newMetricKey(name string, labels map[string]string) metricKey {
	keys := make([]string, 0, len(labels))
	for key := range labels {
		if key != "" && key != "service" {
			keys = append(keys, normalizeMetricValue(key))
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys)*2)
	for _, key := range keys {
		parts = append(parts, key, normalizeMetricValue(labels[key]))
	}
	return metricKey{name: name, labels: strings.Join(parts, "\x00")}
}

func renderMetricLabels(encoded string, service string) string {
	parts := []string{"service=\"" + escapeMetricLabel(service) + "\""}
	if encoded != "" {
		values := strings.Split(encoded, "\x00")
		for i := 0; i+1 < len(values); i += 2 {
			parts = append(parts, values[i]+"=\""+escapeMetricLabel(values[i+1])+"\"")
		}
	}
	return "{" + strings.Join(parts, ",") + "}"
}

func renderMetricLabelsWithExtra(encoded, service, key, value string) string {
	labels := strings.TrimSuffix(renderMetricLabels(encoded, service), "}")
	return labels + "," + key + "=\"" + escapeMetricLabel(value) + "\"}"
}

func escapeMetricLabel(value string) string {
	return strings.NewReplacer("\\", "\\\\", "\n", "\\n", "\"", "\\\"").Replace(value)
}

func formatMetricNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func normalizeMetricValue(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return "unknown"
	}
	if len(value) > 120 {
		return value[:120]
	}
	return value
}

// NormalizeHTTPRoute prevents identifier and query-string cardinality from
// entering Prometheus labels. Dynamic UUID- and numeric-looking segments are
// replaced with :id; callers never pass the raw query string.
func NormalizeHTTPRoute(path string) string {
	if path == "" || path == "/" {
		return "/"
	}
	segments := strings.Split(strings.Trim(path, "/"), "/")
	for i, segment := range segments {
		if isDynamicRouteSegment(segment) {
			segments[i] = ":id"
		}
	}
	return "/" + strings.Join(segments, "/")
}

func isDynamicRouteSegment(segment string) bool {
	if len(segment) >= 20 && strings.Count(segment, "-") >= 2 {
		return true
	}
	if len(segment) > 0 {
		for _, character := range segment {
			if character < '0' || character > '9' {
				return false
			}
		}
		return true
	}
	return false
}

func resetMetricsForTest() {
	processMetrics.mu.Lock()
	defer processMetrics.mu.Unlock()
	processMetrics.counters = map[metricKey]float64{}
	processMetrics.gauges = map[metricKey]float64{}
	processMetrics.observations = map[metricKey]metricObservation{}
}
