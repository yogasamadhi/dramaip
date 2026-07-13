package biz

import (
	"context"
	"testing"
	"time"

	billingeventsv1 "github.com/dramaip/dramaip-platform/services/events/billing/v1"
	envelopev1 "github.com/dramaip/dramaip-platform/services/events/envelope/v1"
	"github.com/dramaip/dramaip-platform/services/pkg/events"
)

func TestReadModelStoresOnceAndReplaysProjection(t *testing.T) {
	store := &fakeStore{}
	uc := NewReadModelUsecase(store)
	envelope := events.NewCheckoutCreated("event-1", "trace-1", time.Now().UTC(), &billingeventsv1.CheckoutCreated{OrderId: "order-1", UserId: "user-1", PlanCode: "pro", Provider: "simulated", Amount: "19.00", Currency: "CNY"})
	raw, err := events.MarshalEnvelope(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if err := uc.Apply(context.Background(), envelope, raw); err != nil {
		t.Fatal(err)
	}
	if err := uc.Apply(context.Background(), envelope, raw); err != nil {
		t.Fatal(err)
	}
	if store.projections != 1 {
		t.Fatalf("projection count = %d", store.projections)
	}
	if err := uc.Rebuild(context.Background(), events.ParseEnvelope); err != nil {
		t.Fatal(err)
	}
	if store.replays != 1 || store.projections != 2 || store.resets != 1 {
		t.Fatalf("rebuild = %#v", store)
	}
}

type fakeStore struct {
	stored                       map[string][]byte
	projections, replays, resets int
}

func (*fakeStore) Checks() map[string]func(context.Context) error { return nil }
func (f *fakeStore) StoreAndProject(_ context.Context, envelope *envelopev1.EventEnvelope, raw []byte) (bool, error) {
	if f.stored == nil {
		f.stored = map[string][]byte{}
	}
	if _, ok := f.stored[envelope.GetEventId()]; ok {
		return false, nil
	}
	f.stored[envelope.GetEventId()] = raw
	f.projections++
	return true, nil
}
func (f *fakeStore) ResetProjection(context.Context) error { f.resets++; return nil }
func (f *fakeStore) ProjectStored(context.Context, *envelopev1.EventEnvelope) error {
	f.projections++
	return nil
}
func (f *fakeStore) Replay(ctx context.Context, handler func(context.Context, []byte) error) error {
	f.replays++
	for _, raw := range f.stored {
		if err := handler(ctx, raw); err != nil {
			return err
		}
	}
	return nil
}
