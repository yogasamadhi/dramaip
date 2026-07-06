package platform

import (
	"context"
	"os"
	"testing"
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
	if err := publisher.Publish(context.Background(), "platform.test", map[string]any{"ok": true}); err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
}
