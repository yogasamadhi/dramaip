package data

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/app/notification/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/events"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	amqp "github.com/rabbitmq/amqp091-go"
)

type ConsumerData struct {
	consumer *platform.RabbitConsumer
}

func NewConsumerData(cfg *conf.Bootstrap) (*ConsumerData, func(), error) {
	consumer, err := platform.NewRabbitConsumer(platform.RabbitConsumerConfig{
		Rabbit:             platform.RabbitConfigFromEnv(),
		Queue:              cfg.Job.ConsumerQueue,
		DeadLetterExchange: cfg.Job.DeadLetterExchange,
		DeadLetterQueue:    cfg.Job.DeadLetterQueue,
		ConsumerTag:        "notification-job",
		RoutingKeys: []string{
			events.PaymentSucceededEventType,
			events.SubscriptionActivatedEventType,
			events.TokenUsageRecordedEventType,
			events.NotificationRequestedEventType,
		},
		Prefetch:   cfg.Job.ConsumerPrefetch,
		MaxRetries: cfg.Job.MaxRetries,
	})
	if err != nil {
		return nil, nil, err
	}
	return &ConsumerData{consumer: consumer}, func() { _ = consumer.Close() }, nil
}

func (d *ConsumerData) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{"rabbitmq": d.consumer.Health}
}

func (d *ConsumerData) Consume(ctx context.Context, handler func(context.Context, []byte) error) error {
	return d.consumer.Consume(ctx, func(deliveryCtx context.Context, delivery amqp.Delivery) error {
		return handler(deliveryCtx, delivery.Body)
	})
}
