package platform

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strings"

	envelopev1 "github.com/dramaip/dramaip-platform/services/events/envelope/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/events"
	amqp "github.com/rabbitmq/amqp091-go"
	"go.opentelemetry.io/otel"
)

type RabbitConfig struct {
	URL      string
	Queue    string
	Exchange string
}

type RabbitPublisher struct {
	config RabbitConfig
	conn   *amqp.Connection
	ch     *amqp.Channel
}

func RabbitConfigFromEnv() RabbitConfig {
	return RabbitConfig{
		URL:      rabbitURLFromEnv(),
		Queue:    Env("RABBITMQ_EVENTS_QUEUE", "dramaip.platform.events"),
		Exchange: Env("RABBITMQ_EXCHANGE", ""),
	}
}

func rabbitURLFromEnv() string {
	if value := Env("RABBITMQ_URL", ""); value != "" {
		return value
	}
	user := Env("RABBITMQ_USER", "dramaip")
	password := Env("RABBITMQ_PASSWORD", "dramaip")
	host := Env("RABBITMQ_HOST", "localhost")
	port := Env("RABBITMQ_PORT", "5672")
	vhost := Env("RABBITMQ_VHOST", "/")
	uri := url.URL{
		Scheme: "amqp",
		User:   url.UserPassword(user, password),
		Host:   net.JoinHostPort(host, port),
	}
	if vhost == "/" || vhost == "" {
		uri.Path = "/"
	} else {
		uri.Path = "/" + strings.TrimPrefix(vhost, "/")
	}
	return uri.String()
}

func NewRabbitPublisher(config RabbitConfig) (*RabbitPublisher, error) {
	conn, err := amqp.Dial(config.URL)
	if err != nil {
		return nil, err
	}
	ch, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if _, err := ch.QueueDeclare(config.Queue, true, false, false, false, nil); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}
	return &RabbitPublisher{config: config, conn: conn, ch: ch}, nil
}

func (p *RabbitPublisher) Health(context.Context) error {
	if p == nil || p.conn == nil || p.ch == nil {
		return fmt.Errorf("rabbitmq publisher is not initialized")
	}
	if p.conn.IsClosed() {
		return fmt.Errorf("rabbitmq connection is closed")
	}
	return nil
}

// Publish serializes the generated event envelope and uses its versioned event
// type for AMQP routing. Arbitrary JSON maps are intentionally not accepted.
func (p *RabbitPublisher) Publish(ctx context.Context, envelope *envelopev1.EventEnvelope) error {
	if err := p.Health(ctx); err != nil {
		return err
	}
	raw, err := events.MarshalEnvelope(envelope)
	if err != nil {
		return err
	}
	headers := amqp.Table{}
	otel.GetTextMapPropagator().Inject(ctx, amqpHeaderCarrier(headers))
	if traceID := TraceID(ctx); traceID != "" {
		headers["trace_id"] = traceID
	}
	if envelope.GetTraceId() != "" {
		headers["trace_id"] = envelope.GetTraceId()
	}
	headers["event_id"] = envelope.GetEventId()
	headers["schema_version"] = envelope.GetSchemaVersion()
	return p.ch.PublishWithContext(ctx, p.config.Exchange, p.config.Queue, false, false, amqp.Publishing{
		ContentType:  "application/protobuf+json",
		Type:         envelope.GetEventType(),
		DeliveryMode: amqp.Persistent,
		Headers:      headers,
		Body:         raw,
	})
}

func (p *RabbitPublisher) Close() error {
	if p == nil {
		return nil
	}
	var err error
	if p.ch != nil {
		err = p.ch.Close()
	}
	if p.conn != nil {
		if closeErr := p.conn.Close(); err == nil {
			err = closeErr
		}
	}
	return err
}

type amqpHeaderCarrier amqp.Table

func (c amqpHeaderCarrier) Get(key string) string {
	value, ok := amqp.Table(c)[key]
	if !ok {
		return ""
	}
	switch v := value.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	default:
		return fmt.Sprint(v)
	}
}

func (c amqpHeaderCarrier) Set(key string, value string) {
	amqp.Table(c)[key] = value
}

func (c amqpHeaderCarrier) Keys() []string {
	keys := make([]string, 0, len(c))
	for key := range c {
		keys = append(keys, key)
	}
	return keys
}
