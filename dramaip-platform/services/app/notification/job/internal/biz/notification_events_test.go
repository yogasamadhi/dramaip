package biz

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/notification/internal/data"
	"github.com/dramaip/dramaip-platform/services/app/notification/job/internal/conf"
	billingeventsv1 "github.com/dramaip/dramaip-platform/services/events/billing/v1"
	envelopev1 "github.com/dramaip/dramaip-platform/services/events/envelope/v1"
	notificationeventsv1 "github.com/dramaip/dramaip-platform/services/events/notification/v1"
	quotaeventsv1 "github.com/dramaip/dramaip-platform/services/events/quota/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/events"
)

func TestNotificationEventUsecaseDeduplicatesInboxAndSourceEvent(t *testing.T) {
	usecase, repo := newEventUsecase(t, InAppChannel{})
	raw := mustEnvelope(t, events.NewNotificationRequested("event-1", "trace-1", time.Now(), &notificationeventsv1.NotificationRequested{
		NotificationId: "11111111-1111-4111-8111-111111111111", UserId: "user-1", Category: "payment_succeeded",
		Title: "Payment confirmed", Body: "Your subscription is active.", SourceEventId: "payment:order-1",
	}))
	if err := usecase.Handle(context.Background(), raw); err != nil {
		t.Fatalf("first Handle() error = %v", err)
	}
	if err := usecase.Handle(context.Background(), raw); err != nil {
		t.Fatalf("duplicate Handle() error = %v", err)
	}
	if got := len(repo.notifications); got != 1 {
		t.Fatalf("notification count = %d, want 1", got)
	}
	if !repo.inbox["event-1"].completed {
		t.Fatalf("event inbox was not completed: %+v", repo.inbox["event-1"])
	}
	if got := len(repo.deliveryAttempts); got != 1 {
		t.Fatalf("delivery attempts = %d, want 1", got)
	}
}

func TestNotificationEventUsecaseRetriesFailedChannelWithoutDuplicateNotification(t *testing.T) {
	failing := &flakyChannel{failures: 1}
	usecase, repo := newEventUsecase(t, failing)
	raw := mustEnvelope(t, events.NewNotificationRequested("event-retry", "", time.Now(), &notificationeventsv1.NotificationRequested{
		NotificationId: "22222222-2222-4222-8222-222222222222", UserId: "user-1", Category: "account",
		Title: "Action required", Body: "Please review your account.", SourceEventId: "account:review-1",
	}))
	if err := usecase.Handle(context.Background(), raw); err == nil {
		t.Fatal("first Handle() error = nil, want delivery failure")
	}
	if repo.inbox["event-retry"].completed {
		t.Fatal("failed delivery must not complete inbox")
	}
	if err := usecase.Retry(context.Background(), raw); err != nil {
		t.Fatalf("Retry() error = %v", err)
	}
	if len(repo.notifications) != 1 {
		t.Fatalf("notification count = %d, want 1", len(repo.notifications))
	}
	if got := fmt.Sprint(repo.deliveryAttempts); got != "[failed delivered]" {
		t.Fatalf("delivery attempts = %s, want [failed delivered]", got)
	}
	if !repo.inbox["event-retry"].completed {
		t.Fatal("successful retry must complete inbox")
	}
}

func TestNotificationEventUsecaseRejectsRetryOfCompletedEvent(t *testing.T) {
	usecase, _ := newEventUsecase(t, InAppChannel{})
	raw := mustEnvelope(t, events.NewNotificationRequested("event-completed", "", time.Now(), &notificationeventsv1.NotificationRequested{
		NotificationId: "33333333-3333-4333-8333-333333333333", UserId: "user-1", Category: "account",
		Title: "Complete", Body: "Already delivered.", SourceEventId: "account:completed",
	}))
	if err := usecase.Handle(context.Background(), raw); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if err := usecase.Retry(context.Background(), raw); err == nil {
		t.Fatal("Retry() error = nil, want completed event rejection")
	}
}

func TestNotificationEventUsecaseMapsPaymentSubscriptionAndQuotaEvents(t *testing.T) {
	tests := []struct {
		name string
		raw  []byte
		want string
	}{
		{
			name: "payment", want: "payment_succeeded",
			raw: mustEnvelope(t, events.NewPaymentSucceeded("payment-event", "", time.Now(), &billingeventsv1.PaymentSucceeded{
				PaymentId: "payment-1", OrderId: "order-1", SubscriptionId: "sub-1", UserId: "user-1", PlanCode: "pro", Provider: "simulated", Amount: "9.99", Currency: "USD",
			})),
		},
		{
			name: "subscription", want: "subscription_activated",
			raw: mustEnvelope(t, events.NewSubscriptionActivated("subscription-event", "", time.Now(), &billingeventsv1.SubscriptionActivated{
				SubscriptionId: "sub-1", UserId: "user-1", PlanCode: "pro", PeriodStart: "2026-07-01", PeriodEnd: "2026-08-01",
			})),
		},
		{
			name: "quota", want: "quota_usage_recorded",
			raw: mustEnvelope(t, events.NewTokenUsageRecorded("quota-event", "", time.Now(), &quotaeventsv1.TokenUsageRecorded{
				UsageId: "usage-1", AccountId: "account-1", UserId: "user-1", RequestId: "request-1", InputTokens: 10, OutputTokens: 20, TotalTokens: 30,
			})),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			usecase, repo := newEventUsecase(t, InAppChannel{})
			if err := usecase.Handle(context.Background(), test.raw); err != nil {
				t.Fatalf("Handle() error = %v", err)
			}
			for _, notification := range repo.notifications {
				if notification.Type != test.want {
					t.Fatalf("notification type = %q, want %q", notification.Type, test.want)
				}
			}
		})
	}
}

func newEventUsecase(t *testing.T, channels ...DeliveryChannel) (*NotificationEventUsecase, *fakeEventRepo) {
	t.Helper()
	repo := &fakeEventRepo{inbox: map[string]*fakeInbox{}, notifications: map[string]EventNotification{}}
	usecase, err := NewNotificationEventUsecase(fakeEventSource{}, repo, channels, &conf.Bootstrap{Job: conf.JobConfig{InboxLease: time.Minute.String()}})
	if err != nil {
		t.Fatalf("NewNotificationEventUsecase() error = %v", err)
	}
	return usecase, repo
}

func mustEnvelope(t *testing.T, envelope *envelopev1.EventEnvelope) []byte {
	t.Helper()
	raw, err := events.MarshalEnvelope(envelope)
	if err != nil {
		t.Fatalf("MarshalEnvelope() error = %v", err)
	}
	return raw
}

type fakeEventSource struct{}

func (fakeEventSource) Checks() map[string]func(context.Context) error { return nil }
func (fakeEventSource) Consume(context.Context, func(context.Context, []byte) error) error {
	return nil
}

type fakeInbox struct {
	completed bool
	claimed   bool
}

type fakeEventRepo struct {
	inbox            map[string]*fakeInbox
	notifications    map[string]EventNotification
	deliveryAttempts []string
}

func (f *fakeEventRepo) Checks() map[string]func(context.Context) error { return nil }

func (f *fakeEventRepo) ClaimInbox(_ context.Context, eventID string, _ string, _ string, _ []byte, _ time.Duration) (bool, error) {
	inbox, ok := f.inbox[eventID]
	if !ok {
		inbox = &fakeInbox{}
		f.inbox[eventID] = inbox
	}
	if inbox.completed || inbox.claimed {
		return false, nil
	}
	inbox.claimed = true
	return true, nil
}

func (f *fakeEventRepo) CompleteInbox(_ context.Context, eventID string) error {
	f.inbox[eventID].completed = true
	f.inbox[eventID].claimed = false
	return nil
}

func (f *fakeEventRepo) ReleaseInbox(_ context.Context, eventID string, _ error) error {
	f.inbox[eventID].claimed = false
	return nil
}

func (f *fakeEventRepo) CreateEventNotification(_ context.Context, id string, userID string, typ string, title string, body string, sourceEventID string) (data.NotificationRow, error) {
	if existing, ok := f.notifications[userID+":"+sourceEventID]; ok {
		return data.NotificationRow{ID: existing.ID, Type: existing.Type, Title: existing.Title, Body: existing.Body, SourceEventID: existing.SourceEventID}, nil
	}
	notification := EventNotification{ID: id, UserID: userID, Type: typ, Title: title, Body: body, SourceEventID: sourceEventID}
	f.notifications[userID+":"+sourceEventID] = notification
	return data.NotificationRow{ID: id, Type: typ, Title: title, Body: body, SourceEventID: sourceEventID}, nil
}

func (f *fakeEventRepo) RecordDeliveryAttempt(_ context.Context, _ string, _ string, _ string, status string, _ string) error {
	f.deliveryAttempts = append(f.deliveryAttempts, status)
	return nil
}

type flakyChannel struct{ failures int }

func (*flakyChannel) Name() string { return "fake" }
func (c *flakyChannel) Deliver(context.Context, EventNotification) error {
	if c.failures > 0 {
		c.failures--
		return errors.New("temporary channel failure")
	}
	return nil
}
