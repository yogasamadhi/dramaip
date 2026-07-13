package platform

import (
	"context"
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// RabbitConsumerConfig creates a dedicated durable subscription. Routing keys
// must be explicit so a consumer cannot accidentally own another domain's
// side effect.
type RabbitConsumerConfig struct {
	Rabbit             RabbitConfig
	Queue              string
	DeadLetterExchange string
	DeadLetterQueue    string
	ConsumerTag        string
	RoutingKeys        []string
	Prefetch           int
	MaxRetries         int
}

type RabbitConsumer struct {
	config   RabbitConsumerConfig
	conn     *amqp.Connection
	ch       *amqp.Channel
	confirms <-chan amqp.Confirmation
}

// RabbitDeliveryHandler must return an error for a retryable processing
// failure. The consumer republishes the exact message with a bounded retry
// counter, then dead-letters it after MaxRetries.
type RabbitDeliveryHandler func(context.Context, amqp.Delivery) error

func NewRabbitConsumer(config RabbitConsumerConfig) (*RabbitConsumer, error) {
	if config.Rabbit.Exchange == "" {
		return nil, fmt.Errorf("rabbitmq topic exchange is required for a dedicated consumer queue")
	}
	if config.Queue == "" || config.DeadLetterExchange == "" || config.DeadLetterQueue == "" || config.ConsumerTag == "" {
		return nil, fmt.Errorf("rabbitmq consumer queue, dead-letter topology, and consumer tag are required")
	}
	if len(config.RoutingKeys) == 0 {
		return nil, fmt.Errorf("rabbitmq consumer routing keys are required")
	}
	if config.Prefetch <= 0 {
		config.Prefetch = 1
	}
	if config.MaxRetries < 0 {
		config.MaxRetries = 0
	}

	conn, err := amqp.Dial(config.Rabbit.URL)
	if err != nil {
		return nil, err
	}
	ch, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if err := declareConsumerTopology(ch, config); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}
	if err := ch.Qos(config.Prefetch, 0, false); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}
	if err := ch.Confirm(false); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}
	return &RabbitConsumer{config: config, conn: conn, ch: ch, confirms: ch.NotifyPublish(make(chan amqp.Confirmation, 1))}, nil
}

func declareConsumerTopology(ch *amqp.Channel, config RabbitConsumerConfig) error {
	if err := ch.ExchangeDeclare(config.Rabbit.Exchange, "topic", true, false, false, false, nil); err != nil {
		return err
	}
	if err := ch.ExchangeDeclare(config.DeadLetterExchange, "topic", true, false, false, false, nil); err != nil {
		return err
	}
	if _, err := ch.QueueDeclare(config.DeadLetterQueue, true, false, false, false, nil); err != nil {
		return err
	}
	if err := ch.QueueBind(config.DeadLetterQueue, "#", config.DeadLetterExchange, false, nil); err != nil {
		return err
	}
	if _, err := ch.QueueDeclare(config.Queue, true, false, false, false, amqp.Table{
		"x-dead-letter-exchange": config.DeadLetterExchange,
	}); err != nil {
		return err
	}
	for _, routingKey := range config.RoutingKeys {
		if err := ch.QueueBind(config.Queue, routingKey, config.Rabbit.Exchange, false, nil); err != nil {
			return err
		}
	}
	return nil
}

func (c *RabbitConsumer) Health(context.Context) error {
	if c == nil || c.conn == nil || c.ch == nil {
		return fmt.Errorf("rabbitmq consumer is not initialized")
	}
	if c.conn.IsClosed() {
		return fmt.Errorf("rabbitmq connection is closed")
	}
	return nil
}

func (c *RabbitConsumer) Consume(ctx context.Context, handler RabbitDeliveryHandler) error {
	if err := c.Health(ctx); err != nil {
		return err
	}
	deliveries, err := c.ch.Consume(c.config.Queue, c.config.ConsumerTag, false, false, false, false, nil)
	if err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case delivery, ok := <-deliveries:
			if !ok {
				return fmt.Errorf("rabbitmq delivery stream closed")
			}
			if err := c.handleDelivery(ctx, delivery, handler); err != nil {
				return err
			}
		}
	}
}

func (c *RabbitConsumer) handleDelivery(ctx context.Context, delivery amqp.Delivery, handler RabbitDeliveryHandler) error {
	deliveryCtx := otel.GetTextMapPropagator().Extract(ctx, amqpHeaderCarrier(delivery.Headers))
	deliveryCtx = ContextWithTraceID(deliveryCtx, headerString(delivery.Headers, "trace_id"))
	deliveryCtx, span := Tracer("messaging").Start(deliveryCtx, "rabbitmq.consume "+delivery.RoutingKey,
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("messaging.system", "rabbitmq"),
			attribute.String("messaging.destination.name", c.config.Queue),
			attribute.String("messaging.operation", "process"),
			attribute.String("messaging.rabbitmq.routing_key", delivery.RoutingKey),
			attribute.String("messaging.message.id", delivery.MessageId),
		),
	)
	defer span.End()

	if err := handler(deliveryCtx, delivery); err == nil {
		if err := delivery.Ack(false); err != nil {
			span.RecordError(err)
			return err
		}
		return nil
	} else if retryCount(delivery.Headers) >= c.config.MaxRetries {
		span.RecordError(err)
		StructuredLog(deliveryCtx, c.config.ConsumerTag, "error", "event_dead_lettered", map[string]any{"routing_key": delivery.RoutingKey, "error": err})
		if rejectErr := delivery.Reject(false); rejectErr != nil {
			span.RecordError(rejectErr)
			return rejectErr
		}
		return nil
	} else if retryErr := c.retry(deliveryCtx, delivery); retryErr != nil {
		span.RecordError(err)
		span.RecordError(retryErr)
		StructuredLog(deliveryCtx, c.config.ConsumerTag, "error", "event_retry_publish_failed", map[string]any{"routing_key": delivery.RoutingKey, "error": retryErr})
		if nackErr := delivery.Nack(false, true); nackErr != nil {
			span.RecordError(nackErr)
			return nackErr
		}
		return nil
	} else if ackErr := delivery.Ack(false); ackErr != nil {
		span.RecordError(ackErr)
		return ackErr
	}
	return nil
}

func (c *RabbitConsumer) retry(ctx context.Context, delivery amqp.Delivery) error {
	ctx, span := Tracer("messaging").Start(ctx, "rabbitmq.retry "+delivery.RoutingKey,
		trace.WithSpanKind(trace.SpanKindProducer),
		trace.WithAttributes(
			attribute.String("messaging.system", "rabbitmq"),
			attribute.String("messaging.destination.name", c.config.Rabbit.Exchange),
			attribute.String("messaging.operation", "publish"),
		),
	)
	defer span.End()
	headers := amqp.Table{}
	for key, value := range delivery.Headers {
		headers[key] = value
	}
	headers["x-retry-count"] = retryCount(delivery.Headers) + 1
	otel.GetTextMapPropagator().Inject(ctx, amqpHeaderCarrier(headers))
	if traceID := TraceID(ctx); traceID != "" {
		headers["trace_id"] = traceID
	}
	if err := c.ch.PublishWithContext(ctx, c.config.Rabbit.Exchange, delivery.RoutingKey, false, false, amqp.Publishing{
		Headers:         headers,
		ContentType:     delivery.ContentType,
		ContentEncoding: delivery.ContentEncoding,
		DeliveryMode:    amqp.Persistent,
		Priority:        delivery.Priority,
		CorrelationId:   delivery.CorrelationId,
		ReplyTo:         delivery.ReplyTo,
		Expiration:      delivery.Expiration,
		MessageId:       delivery.MessageId,
		Timestamp:       delivery.Timestamp,
		Type:            delivery.Type,
		UserId:          delivery.UserId,
		AppId:           delivery.AppId,
		Body:            delivery.Body,
	}); err != nil {
		span.RecordError(err)
		return err
	}
	select {
	case confirmation, ok := <-c.confirms:
		if !ok || !confirmation.Ack {
			err := fmt.Errorf("rabbitmq retry publish was not confirmed")
			span.RecordError(err)
			return err
		}
		return nil
	case <-ctx.Done():
		err := ctx.Err()
		span.RecordError(err)
		return err
	}
}

func headerString(headers amqp.Table, key string) string {
	return amqpHeaderCarrier(headers).Get(key)
}

func retryCount(headers amqp.Table) int {
	if headers == nil {
		return 0
	}
	switch value := headers["x-retry-count"].(type) {
	case int:
		return value
	case int8:
		return int(value)
	case int16:
		return int(value)
	case int32:
		return int(value)
	case int64:
		return int(value)
	case uint8:
		return int(value)
	case uint16:
		return int(value)
	case uint32:
		return int(value)
	case uint64:
		return int(value)
	default:
		return 0
	}
}

func (c *RabbitConsumer) Close() error {
	if c == nil {
		return nil
	}
	var err error
	if c.ch != nil {
		err = c.ch.Close()
	}
	if c.conn != nil {
		if closeErr := c.conn.Close(); err == nil {
			err = closeErr
		}
	}
	return err
}
