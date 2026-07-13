package platform

import (
	"context"
	"os"
	"testing"
	"time"

	notificationeventsv1 "github.com/dramaip/dramaip-platform/services/events/notification/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/events"
	amqp "github.com/rabbitmq/amqp091-go"
)

func TestRabbitConfigFromEnvUsesURL(t *testing.T) {
	t.Setenv("RABBITMQ_URL", "amqp://user:pass@example:5672/vhost")
	t.Setenv("RABBITMQ_EVENTS_QUEUE", "events")
	t.Setenv("RABBITMQ_EXCHANGE", "domain")

	config := RabbitConfigFromEnv()
	if config.URL != "amqp://user:pass@example:5672/vhost" {
		t.Fatalf("URL = %q", config.URL)
	}
	if config.Queue != "events" || config.Exchange != "domain" {
		t.Fatalf("config = %+v", config)
	}
}

func TestRabbitConfigFromEnvBuildsURL(t *testing.T) {
	t.Setenv("RABBITMQ_USER", "user")
	t.Setenv("RABBITMQ_PASSWORD", "pass")
	t.Setenv("RABBITMQ_HOST", "rabbitmq")
	t.Setenv("RABBITMQ_PORT", "5673")
	t.Setenv("RABBITMQ_VHOST", "drama")

	config := RabbitConfigFromEnv()
	if config.URL != "amqp://user:pass@rabbitmq:5673/drama" {
		t.Fatalf("URL = %q", config.URL)
	}
}

func TestRabbitConfigFromEnvDefaultsToTopicExchange(t *testing.T) {
	t.Setenv("RABBITMQ_EXCHANGE", "")
	config := RabbitConfigFromEnv()
	if config.Exchange != "dramaip.platform.events" {
		t.Fatalf("Exchange = %q", config.Exchange)
	}
}

func TestRabbitRetryCount(t *testing.T) {
	for name, test := range map[string]struct {
		headers map[string]any
		want    int
	}{
		"missing": {want: 0},
		"int32":   {headers: map[string]any{"x-retry-count": int32(2)}, want: 2},
		"invalid": {headers: map[string]any{"x-retry-count": "2"}, want: 0},
	} {
		t.Run(name, func(t *testing.T) {
			headers := amqp.Table(test.headers)
			if got := retryCount(headers); got != test.want {
				t.Fatalf("retryCount() = %d, want %d", got, test.want)
			}
		})
	}
}

func TestRabbitHealthUninitialized(t *testing.T) {
	var publisher *RabbitPublisher
	if err := publisher.Health(context.Background()); err == nil {
		t.Fatalf("Health() expected error")
	}
}

func TestRabbitPublisherIntegration(t *testing.T) {
	rawURL := os.Getenv("RABBITMQ_TEST_URL")
	if rawURL == "" {
		t.Skip("RABBITMQ_TEST_URL not set")
	}
	publisher, err := NewRabbitPublisher(RabbitConfig{URL: rawURL, Queue: "platform.test.events"})
	if err != nil {
		t.Fatalf("NewRabbitPublisher() error = %v", err)
	}
	defer publisher.Close()
	if err := publisher.Health(context.Background()); err != nil {
		t.Fatalf("Health() error = %v", err)
	}
	envelope := events.NewNotificationRequested("event-1", "", time.Now().UTC(), &notificationeventsv1.NotificationRequested{
		NotificationId: "notification-1",
		UserId:         "user-1",
		Category:       "test",
		Title:          "Platform test",
		Body:           "RabbitMQ integration test",
		SourceEventId:  "source-1",
	})
	if err := publisher.Publish(context.Background(), envelope); err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
}
