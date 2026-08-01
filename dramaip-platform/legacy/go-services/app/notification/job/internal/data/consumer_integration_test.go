package data

import (
	"context"
	"errors"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/notification/job/internal/conf"
	notificationeventsv1 "github.com/dramaip/dramaip-platform/services/events/notification/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/events"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	amqp "github.com/rabbitmq/amqp091-go"
)

// This uses the configured local RabbitMQ only when explicitly opted in. It
// proves that a topic publication reaches notification-job's dedicated queue;
// normal unit runs stay hermetic.
func TestNotificationConsumerRabbitMQIntegration(t *testing.T) {
	if os.Getenv("NOTIFICATION_RABBITMQ_INTEGRATION") != "1" {
		t.Skip("set NOTIFICATION_RABBITMQ_INTEGRATION=1 to run against configured RabbitMQ")
	}
	cfg, err := conf.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	suffix := platform.NewUUID()
	exchange := "dramaip.notification.test." + suffix
	cfg.Job.ConsumerQueue = "dramaip.notification.test.queue." + suffix
	cfg.Job.DeadLetterExchange = "dramaip.notification.test.dlx." + suffix
	cfg.Job.DeadLetterQueue = "dramaip.notification.test.dlq." + suffix
	t.Setenv("RABBITMQ_EXCHANGE", exchange)
	t.Setenv("RABBITMQ_EVENTS_QUEUE", "dramaip.notification.test.events."+suffix)

	consumer, cleanup, err := NewConsumerData(cfg)
	if err != nil {
		t.Fatalf("new consumer: %v", err)
	}
	defer cleanup()
	defer deleteIntegrationTopology(cfg, exchange)
	publisher, err := platform.NewRabbitPublisher(platform.RabbitConfigFromEnv())
	if err != nil {
		t.Fatalf("new publisher: %v", err)
	}
	defer publisher.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	received := make(chan string, 1)
	done := make(chan error, 1)
	go func() {
		done <- consumer.Consume(ctx, func(_ context.Context, raw []byte) error {
			envelope, err := events.ParseEnvelope(raw)
			if err != nil {
				return err
			}
			received <- envelope.GetEventId()
			return nil
		})
	}()

	envelope := events.NewNotificationRequested("notification-consumer-test", "", time.Now().UTC(), &notificationeventsv1.NotificationRequested{
		NotificationId: platform.NewUUID(), UserId: platform.NewUUID(), Category: "test", Title: "RabbitMQ test", Body: "Dedicated queue received the event.", SourceEventId: "source:" + suffix,
	})
	if err := publisher.Publish(context.Background(), envelope); err != nil {
		t.Fatalf("publish: %v", err)
	}
	select {
	case eventID := <-received:
		if eventID != envelope.GetEventId() {
			t.Fatalf("event id = %q, want %q", eventID, envelope.GetEventId())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("notification consumer did not receive topic message")
	}
	cancel()
	if err := <-done; err != nil && !errors.Is(err, context.Canceled) {
		t.Fatalf("consume: %v", err)
	}
}

func TestNotificationConsumerRabbitMQRetryAndDeadLetterIntegration(t *testing.T) {
	if os.Getenv("NOTIFICATION_RABBITMQ_INTEGRATION") != "1" {
		t.Skip("set NOTIFICATION_RABBITMQ_INTEGRATION=1 to run against configured RabbitMQ")
	}
	cfg, err := conf.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	suffix := platform.NewUUID()
	exchange := "dramaip.notification.retry.test." + suffix
	cfg.Job.ConsumerQueue = "dramaip.notification.retry.test.queue." + suffix
	cfg.Job.DeadLetterExchange = "dramaip.notification.retry.test.dlx." + suffix
	cfg.Job.DeadLetterQueue = "dramaip.notification.retry.test.dlq." + suffix
	cfg.Job.MaxRetries = 1
	t.Setenv("RABBITMQ_EXCHANGE", exchange)
	t.Setenv("RABBITMQ_EVENTS_QUEUE", "dramaip.notification.retry.test.events."+suffix)

	consumer, cleanup, err := NewConsumerData(cfg)
	if err != nil {
		t.Fatalf("new consumer: %v", err)
	}
	defer cleanup()
	defer deleteIntegrationTopology(cfg, exchange)
	publisher, err := platform.NewRabbitPublisher(platform.RabbitConfigFromEnv())
	if err != nil {
		t.Fatalf("new publisher: %v", err)
	}
	defer publisher.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var attempts atomic.Int32
	retried := make(chan struct{}, 1)
	done := make(chan error, 1)
	go func() {
		done <- consumer.Consume(ctx, func(context.Context, []byte) error {
			if attempts.Add(1) == int32(cfg.Job.MaxRetries+1) {
				retried <- struct{}{}
			}
			return errors.New("temporary delivery failure")
		})
	}()
	envelope := events.NewNotificationRequested("notification-dead-letter-test", "", time.Now().UTC(), &notificationeventsv1.NotificationRequested{
		NotificationId: platform.NewUUID(), UserId: platform.NewUUID(), Category: "test", Title: "Retry test", Body: "Must reach the DLQ.", SourceEventId: "source:" + suffix,
	})
	if err := publisher.Publish(context.Background(), envelope); err != nil {
		t.Fatalf("publish: %v", err)
	}
	select {
	case <-retried:
	case <-time.After(10 * time.Second):
		t.Fatalf("consumer attempts = %d, want %d", attempts.Load(), cfg.Job.MaxRetries+1)
	}

	conn, err := amqp.Dial(platform.RabbitConfigFromEnv().URL)
	if err != nil {
		t.Fatalf("dial DLQ: %v", err)
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		t.Fatalf("open DLQ channel: %v", err)
	}
	defer ch.Close()
	delivery, ok, err := ch.Get(cfg.Job.DeadLetterQueue, true)
	if err != nil {
		t.Fatalf("get DLQ message: %v", err)
	}
	if !ok {
		t.Fatal("expected failed event in notification DLQ")
	}
	deadLetter, err := events.ParseEnvelope(delivery.Body)
	if err != nil || deadLetter.GetEventId() != envelope.GetEventId() {
		t.Fatalf("dead-letter event = %+v err=%v", deadLetter, err)
	}
	cancel()
	if err := <-done; err != nil && !errors.Is(err, context.Canceled) {
		t.Fatalf("consume: %v", err)
	}
}

func deleteIntegrationTopology(cfg *conf.Bootstrap, exchange string) {
	conn, err := amqp.Dial(platform.RabbitConfigFromEnv().URL)
	if err != nil {
		return
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		return
	}
	defer ch.Close()
	_, _ = ch.QueueDelete(cfg.Job.ConsumerQueue, false, false, false)
	_, _ = ch.QueueDelete(cfg.Job.DeadLetterQueue, false, false, false)
	_, _ = ch.QueueDelete(platform.RabbitConfigFromEnv().Queue, false, false, false)
	_ = ch.ExchangeDelete(cfg.Job.DeadLetterExchange, false, false)
	_ = ch.ExchangeDelete(exchange, false, false)
}
