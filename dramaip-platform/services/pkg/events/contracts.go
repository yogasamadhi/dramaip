// Package events owns the generated RabbitMQ envelope boundary used by all
// platform producers and consumers.
package events

import (
	"fmt"
	"strings"
	"time"

	billingeventsv1 "github.com/dramaip/dramaip-platform/services/events/billing/v1"
	envelopev1 "github.com/dramaip/dramaip-platform/services/events/envelope/v1"
	notificationeventsv1 "github.com/dramaip/dramaip-platform/services/events/notification/v1"
	quotaeventsv1 "github.com/dramaip/dramaip-platform/services/events/quota/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	CheckoutCreatedEventType       = "billing.checkout.created.v1"
	PaymentSucceededEventType      = "payment.succeeded.v1"
	SubscriptionActivatedEventType = "subscription.activated.v1"
	TokenUsageRecordedEventType    = "token.usage.recorded.v1"
	NotificationRequestedEventType = "notification.requested.v1"
)

// NewCheckoutCreated constructs the generated envelope for a newly persisted
// pending billing order.
func NewCheckoutCreated(eventID, traceID string, occurredAt time.Time, payload *billingeventsv1.CheckoutCreated) *envelopev1.EventEnvelope {
	envelope := newEnvelope(eventID, CheckoutCreatedEventType, "billing.order", payload.GetOrderId(), traceID, occurredAt)
	envelope.Payload = &envelopev1.EventEnvelope_CheckoutCreated{CheckoutCreated: payload}
	return envelope
}

// NewPaymentSucceeded constructs the generated envelope for a confirmed payment.
func NewPaymentSucceeded(eventID, traceID string, occurredAt time.Time, payload *billingeventsv1.PaymentSucceeded) *envelopev1.EventEnvelope {
	envelope := newEnvelope(eventID, PaymentSucceededEventType, "billing.payment", payload.GetPaymentId(), traceID, occurredAt)
	envelope.Payload = &envelopev1.EventEnvelope_PaymentSucceeded{PaymentSucceeded: payload}
	return envelope
}

// NewSubscriptionActivated constructs the generated envelope for a usable subscription.
func NewSubscriptionActivated(eventID, traceID string, occurredAt time.Time, payload *billingeventsv1.SubscriptionActivated) *envelopev1.EventEnvelope {
	envelope := newEnvelope(eventID, SubscriptionActivatedEventType, "billing.subscription", payload.GetSubscriptionId(), traceID, occurredAt)
	envelope.Payload = &envelopev1.EventEnvelope_SubscriptionActivated{SubscriptionActivated: payload}
	return envelope
}

// NewTokenUsageRecorded constructs the generated envelope for a durable quota record.
func NewTokenUsageRecorded(eventID, traceID string, occurredAt time.Time, payload *quotaeventsv1.TokenUsageRecorded) *envelopev1.EventEnvelope {
	envelope := newEnvelope(eventID, TokenUsageRecordedEventType, "quota.usage", payload.GetUsageId(), traceID, occurredAt)
	envelope.Payload = &envelopev1.EventEnvelope_TokenUsageRecorded{TokenUsageRecorded: payload}
	return envelope
}

// NewNotificationRequested constructs the generated envelope for the notification domain.
func NewNotificationRequested(eventID, traceID string, occurredAt time.Time, payload *notificationeventsv1.NotificationRequested) *envelopev1.EventEnvelope {
	envelope := newEnvelope(eventID, NotificationRequestedEventType, "notification.request", payload.GetNotificationId(), traceID, occurredAt)
	envelope.Payload = &envelopev1.EventEnvelope_NotificationRequested{NotificationRequested: payload}
	return envelope
}

func newEnvelope(eventID, eventType, aggregateType, aggregateID, traceID string, occurredAt time.Time) *envelopev1.EventEnvelope {
	return &envelopev1.EventEnvelope{
		EventId:       eventID,
		EventType:     eventType,
		SchemaVersion: 1,
		AggregateType: aggregateType,
		AggregateId:   aggregateID,
		OccurredAt:    timestamppb.New(occurredAt.UTC()),
		TraceId:       traceID,
	}
}

// MarshalEnvelope validates an event before encoding it with protobuf JSON for
// RabbitMQ. Producers must use this instead of hand-built JSON maps.
func MarshalEnvelope(envelope *envelopev1.EventEnvelope) ([]byte, error) {
	if err := ValidateEnvelope(envelope); err != nil {
		return nil, err
	}
	return protojson.MarshalOptions{UseProtoNames: false}.Marshal(envelope)
}

// ParseEnvelope is the consumer entry point. DiscardUnknown keeps an older
// consumer compatible with newly added optional fields in an existing event.
func ParseEnvelope(raw []byte) (*envelopev1.EventEnvelope, error) {
	envelope := &envelopev1.EventEnvelope{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(raw, envelope); err != nil {
		return nil, fmt.Errorf("decode event envelope: %w", err)
	}
	if err := ValidateEnvelope(envelope); err != nil {
		return nil, err
	}
	return envelope, nil
}

// ValidateEnvelope rejects mismatched routing metadata and incomplete event
// bodies before they reach RabbitMQ or a consumer handler.
func ValidateEnvelope(envelope *envelopev1.EventEnvelope) error {
	if envelope == nil {
		return fmt.Errorf("event envelope is required")
	}
	if err := require("event_id", envelope.GetEventId()); err != nil {
		return err
	}
	if err := require("event_type", envelope.GetEventType()); err != nil {
		return err
	}
	if envelope.GetSchemaVersion() != 1 {
		return fmt.Errorf("unsupported event schema version %d", envelope.GetSchemaVersion())
	}
	if err := require("aggregate_type", envelope.GetAggregateType()); err != nil {
		return err
	}
	if err := require("aggregate_id", envelope.GetAggregateId()); err != nil {
		return err
	}
	if envelope.GetOccurredAt() == nil {
		return fmt.Errorf("occurred_at is required")
	}
	if err := envelope.GetOccurredAt().CheckValid(); err != nil {
		return fmt.Errorf("invalid occurred_at: %w", err)
	}

	switch payload := envelope.GetPayload().(type) {
	case *envelopev1.EventEnvelope_CheckoutCreated:
		if err := expectRoute(envelope, CheckoutCreatedEventType, "billing.order"); err != nil {
			return err
		}
		return validateCheckoutCreated(payload.CheckoutCreated)
	case *envelopev1.EventEnvelope_PaymentSucceeded:
		if err := expectRoute(envelope, PaymentSucceededEventType, "billing.payment"); err != nil {
			return err
		}
		return validatePaymentSucceeded(payload.PaymentSucceeded)
	case *envelopev1.EventEnvelope_SubscriptionActivated:
		if err := expectRoute(envelope, SubscriptionActivatedEventType, "billing.subscription"); err != nil {
			return err
		}
		return validateSubscriptionActivated(payload.SubscriptionActivated)
	case *envelopev1.EventEnvelope_TokenUsageRecorded:
		if err := expectRoute(envelope, TokenUsageRecordedEventType, "quota.usage"); err != nil {
			return err
		}
		return validateTokenUsageRecorded(payload.TokenUsageRecorded)
	case *envelopev1.EventEnvelope_NotificationRequested:
		if err := expectRoute(envelope, NotificationRequestedEventType, "notification.request"); err != nil {
			return err
		}
		return validateNotificationRequested(payload.NotificationRequested)
	default:
		return fmt.Errorf("event payload is required")
	}
}

func expectRoute(envelope *envelopev1.EventEnvelope, eventType, aggregateType string) error {
	if envelope.GetEventType() != eventType {
		return fmt.Errorf("payload requires event_type %q, got %q", eventType, envelope.GetEventType())
	}
	if envelope.GetAggregateType() != aggregateType {
		return fmt.Errorf("payload requires aggregate_type %q, got %q", aggregateType, envelope.GetAggregateType())
	}
	return nil
}

func validateCheckoutCreated(payload *billingeventsv1.CheckoutCreated) error {
	if payload == nil {
		return fmt.Errorf("checkout_created payload is required")
	}
	for name, value := range map[string]string{
		"checkout_created.order_id":  payload.GetOrderId(),
		"checkout_created.user_id":   payload.GetUserId(),
		"checkout_created.plan_code": payload.GetPlanCode(),
		"checkout_created.provider":  payload.GetProvider(),
		"checkout_created.amount":    payload.GetAmount(),
		"checkout_created.currency":  payload.GetCurrency(),
	} {
		if err := require(name, value); err != nil {
			return err
		}
	}
	return nil
}

func validatePaymentSucceeded(payload *billingeventsv1.PaymentSucceeded) error {
	if payload == nil {
		return fmt.Errorf("payment_succeeded payload is required")
	}
	for name, value := range map[string]string{
		"payment_succeeded.payment_id":      payload.GetPaymentId(),
		"payment_succeeded.order_id":        payload.GetOrderId(),
		"payment_succeeded.subscription_id": payload.GetSubscriptionId(),
		"payment_succeeded.user_id":         payload.GetUserId(),
		"payment_succeeded.plan_code":       payload.GetPlanCode(),
		"payment_succeeded.provider":        payload.GetProvider(),
		"payment_succeeded.amount":          payload.GetAmount(),
		"payment_succeeded.currency":        payload.GetCurrency(),
	} {
		if err := require(name, value); err != nil {
			return err
		}
	}
	return nil
}

func validateSubscriptionActivated(payload *billingeventsv1.SubscriptionActivated) error {
	if payload == nil {
		return fmt.Errorf("subscription_activated payload is required")
	}
	for name, value := range map[string]string{
		"subscription_activated.subscription_id": payload.GetSubscriptionId(),
		"subscription_activated.user_id":         payload.GetUserId(),
		"subscription_activated.plan_code":       payload.GetPlanCode(),
		"subscription_activated.period_start":    payload.GetPeriodStart(),
		"subscription_activated.period_end":      payload.GetPeriodEnd(),
	} {
		if err := require(name, value); err != nil {
			return err
		}
	}
	return nil
}

func validateTokenUsageRecorded(payload *quotaeventsv1.TokenUsageRecorded) error {
	if payload == nil {
		return fmt.Errorf("token_usage_recorded payload is required")
	}
	for name, value := range map[string]string{
		"token_usage_recorded.usage_id":   payload.GetUsageId(),
		"token_usage_recorded.account_id": payload.GetAccountId(),
		"token_usage_recorded.user_id":    payload.GetUserId(),
		"token_usage_recorded.request_id": payload.GetRequestId(),
	} {
		if err := require(name, value); err != nil {
			return err
		}
	}
	if payload.GetInputTokens() < 0 || payload.GetOutputTokens() < 0 || payload.GetTotalTokens() < 0 {
		return fmt.Errorf("token_usage_recorded token counts must be non-negative")
	}
	return nil
}

func validateNotificationRequested(payload *notificationeventsv1.NotificationRequested) error {
	if payload == nil {
		return fmt.Errorf("notification_requested payload is required")
	}
	for name, value := range map[string]string{
		"notification_requested.notification_id": payload.GetNotificationId(),
		"notification_requested.user_id":         payload.GetUserId(),
		"notification_requested.category":        payload.GetCategory(),
		"notification_requested.title":           payload.GetTitle(),
		"notification_requested.body":            payload.GetBody(),
		"notification_requested.source_event_id": payload.GetSourceEventId(),
	} {
		if err := require(name, value); err != nil {
			return err
		}
	}
	return nil
}

func require(name, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", name)
	}
	return nil
}
