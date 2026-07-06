package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strings"

	amqp "github.com/rabbitmq/amqp091-go"
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
		Queue:    Env("RABBITMQ_EVENTS_QUEUE", "dramaip.mvp.events"),
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

func (p *RabbitPublisher) Publish(ctx context.Context, eventType string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return p.ch.PublishWithContext(ctx, p.config.Exchange, p.config.Queue, false, false, amqp.Publishing{
		ContentType:  "application/json",
		Type:         eventType,
		DeliveryMode: amqp.Persistent,
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
