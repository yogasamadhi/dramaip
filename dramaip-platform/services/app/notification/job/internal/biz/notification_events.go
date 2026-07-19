package biz

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/notification/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/notification/job/internal/conf"
	billingeventsv1 "github.com/dramaip/dramaip-platform/services/events/billing/v1"
	envelopev1 "github.com/dramaip/dramaip-platform/services/events/envelope/v1"
	notificationeventsv1 "github.com/dramaip/dramaip-platform/services/events/notification/v1"
	quotaeventsv1 "github.com/dramaip/dramaip-platform/services/events/quota/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/events"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type EventSource interface {
	Checks() map[string]func(context.Context) error
	Consume(context.Context, func(context.Context, []byte) error) error
}

type EventRepository interface {
	Checks() map[string]func(context.Context) error
	ClaimInbox(context.Context, string, string, string, []byte, time.Duration) (bool, error)
	CompleteInbox(context.Context, string) error
	ReleaseInbox(context.Context, string, error) error
	CreateEventNotification(context.Context, string, string, string, string, string, string) (data.NotificationRow, error)
	RecordDeliveryAttempt(context.Context, string, string, string, string, string) error
}

// DeliveryChannel separates a durable in-app notification from optional
// channel providers. Future email/SMS adapters implement this same contract.
type DeliveryChannel interface {
	Name() string
	Deliver(context.Context, EventNotification) error
}

type EventNotification struct {
	ID            string
	UserID        string
	Type          string
	Title         string
	Body          string
	SourceEventID string
}

type NotificationEventUsecase struct {
	source   EventSource
	repo     EventRepository
	channels []DeliveryChannel
	lease    time.Duration
}

func NewNotificationEventUsecase(source EventSource, repo EventRepository, channels []DeliveryChannel, cfg *conf.Bootstrap) (*NotificationEventUsecase, error) {
	lease, err := time.ParseDuration(cfg.Job.InboxLease)
	if err != nil || lease <= 0 {
		return nil, fmt.Errorf("invalid notification inbox lease %q", cfg.Job.InboxLease)
	}
	return &NotificationEventUsecase{source: source, repo: repo, channels: channels, lease: lease}, nil
}

func NewDeliveryChannels(cfg *conf.Bootstrap) ([]DeliveryChannel, error) {
	channels := make([]DeliveryChannel, 0, len(cfg.Job.Channels))
	seen := map[string]struct{}{}
	for _, configured := range cfg.Job.Channels {
		name := strings.ToLower(strings.TrimSpace(configured))
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		switch name {
		case "in_app":
			channels = append(channels, InAppChannel{})
		default:
			return nil, fmt.Errorf("unsupported notification channel %q", name)
		}
	}
	if len(channels) == 0 {
		return nil, fmt.Errorf("at least one notification channel is required")
	}
	return channels, nil
}

// InAppChannel is fulfilled by the notification row itself. It remains an
// explicit adapter so email/SMS providers can be added without changing event
// idempotency or the consumer control flow.
type InAppChannel struct{}

func (InAppChannel) Name() string                                     { return "in_app" }
func (InAppChannel) Deliver(context.Context, EventNotification) error { return nil }

func (u *NotificationEventUsecase) Checks() map[string]func(context.Context) error {
	checks := map[string]func(context.Context) error{}
	for name, check := range u.source.Checks() {
		checks[name] = check
	}
	for name, check := range u.repo.Checks() {
		checks[name] = check
	}
	return checks
}

func (u *NotificationEventUsecase) Run(ctx context.Context) error {
	return u.source.Consume(ctx, u.Handle)
}

func (u *NotificationEventUsecase) Handle(ctx context.Context, raw []byte) error {
	return u.handle(ctx, raw, false)
}

// Retry uses the original durable event envelope and the exact same inbox and
// channel workflow as broker consumption. It differs only in reporting an
// already leased/completed event to the operator instead of silently no-oping.
func (u *NotificationEventUsecase) Retry(ctx context.Context, raw []byte) error {
	return u.handle(ctx, raw, true)
}

func (u *NotificationEventUsecase) handle(ctx context.Context, raw []byte, retry bool) error {
	envelope, err := events.ParseEnvelope(raw)
	if err != nil {
		return err
	}
	notification, err := notificationFromEnvelope(envelope)
	if err != nil {
		return err
	}
	claimed, err := u.repo.ClaimInbox(ctx, envelope.GetEventId(), envelope.GetEventType(), envelope.GetTraceId(), raw, u.lease)
	if err != nil {
		return err
	}
	if !claimed {
		if retry {
			return status.Error(codes.FailedPrecondition, "delivery_retry_is_not_available")
		}
		return nil
	}

	row, err := u.repo.CreateEventNotification(ctx, notification.ID, notification.UserID, notification.Type, notification.Title, notification.Body, notification.SourceEventID)
	if err != nil {
		return u.release(ctx, envelope.GetEventId(), err)
	}
	for _, channel := range u.channels {
		deliveryErr := channel.Deliver(ctx, notification)
		status, failure := "delivered", ""
		if deliveryErr != nil {
			status, failure = "failed", deliveryErr.Error()
		}
		if err := u.repo.RecordDeliveryAttempt(ctx, envelope.GetEventId(), row.ID, channel.Name(), status, failure); err != nil {
			return u.release(ctx, envelope.GetEventId(), err)
		}
		if deliveryErr != nil {
			return u.release(ctx, envelope.GetEventId(), deliveryErr)
		}
	}
	if err := u.repo.CompleteInbox(ctx, envelope.GetEventId()); err != nil {
		return err
	}
	platform.StructuredLog(ctx, "notification-job", "info", "notification_event_processed", map[string]any{
		"event_id": envelope.GetEventId(), "event_type": envelope.GetEventType(), "notification_id": row.ID,
	})
	return nil
}

func (u *NotificationEventUsecase) release(ctx context.Context, eventID string, cause error) error {
	if releaseErr := u.repo.ReleaseInbox(ctx, eventID, cause); releaseErr != nil {
		return fmt.Errorf("%w (release inbox: %v)", cause, releaseErr)
	}
	return cause
}

func notificationFromEnvelope(envelope *envelopev1.EventEnvelope) (EventNotification, error) {
	switch payload := envelope.GetPayload().(type) {
	case *envelopev1.EventEnvelope_PaymentSucceeded:
		return notificationFromPayment(envelope.GetEventId(), payload.PaymentSucceeded), nil
	case *envelopev1.EventEnvelope_SubscriptionActivated:
		return notificationFromSubscription(envelope.GetEventId(), payload.SubscriptionActivated), nil
	case *envelopev1.EventEnvelope_TokenUsageRecorded:
		return notificationFromUsage(envelope.GetEventId(), payload.TokenUsageRecorded), nil
	case *envelopev1.EventEnvelope_NotificationRequested:
		return notificationFromRequest(payload.NotificationRequested), nil
	default:
		return EventNotification{}, fmt.Errorf("unsupported notification event type %q", envelope.GetEventType())
	}
}

func notificationFromPayment(eventID string, payload *billingeventsv1.PaymentSucceeded) EventNotification {
	return EventNotification{ID: platform.NewUUID(), UserID: payload.GetUserId(), Type: "payment_succeeded", Title: "支付成功", Body: fmt.Sprintf("%s 套餐支付 %s %s 已确认。", payload.GetPlanCode(), payload.GetAmount(), payload.GetCurrency()), SourceEventID: eventID}
}

func notificationFromSubscription(eventID string, payload *billingeventsv1.SubscriptionActivated) EventNotification {
	return EventNotification{ID: platform.NewUUID(), UserID: payload.GetUserId(), Type: "subscription_activated", Title: "订阅已生效", Body: fmt.Sprintf("%s 套餐已生效，周期至 %s。", payload.GetPlanCode(), payload.GetPeriodEnd()), SourceEventID: eventID}
}

func notificationFromUsage(eventID string, payload *quotaeventsv1.TokenUsageRecorded) EventNotification {
	return EventNotification{ID: platform.NewUUID(), UserID: payload.GetUserId(), Type: "quota_usage_recorded", Title: "用量已记录", Body: fmt.Sprintf("本次已记录 %d tokens 用量。", payload.GetTotalTokens()), SourceEventID: eventID}
}

func notificationFromRequest(payload *notificationeventsv1.NotificationRequested) EventNotification {
	return EventNotification{ID: payload.GetNotificationId(), UserID: payload.GetUserId(), Type: payload.GetCategory(), Title: payload.GetTitle(), Body: payload.GetBody(), SourceEventID: payload.GetSourceEventId()}
}
