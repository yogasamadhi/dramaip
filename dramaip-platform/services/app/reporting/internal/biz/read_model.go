// Package biz turns durable public domain events into a rebuildable reporting
// projection. It deliberately has no client for any domain database.
package biz

import (
	"context"
	"fmt"

	envelopev1 "github.com/dramaip/dramaip-platform/services/events/envelope/v1"
)

// EventStore owns both the immutable source-event append and the derived
// projection. Implementations must make StoreAndProject atomic so a process
// crash cannot leave a permanently recorded-but-unprojected event.
type EventStore interface {
	Checks() map[string]func(context.Context) error
	StoreAndProject(context.Context, *envelopev1.EventEnvelope, []byte) (bool, error)
	ResetProjection(context.Context) error
	ProjectStored(context.Context, *envelopev1.EventEnvelope) error
	Replay(context.Context, func(context.Context, []byte) error) error
}

type ReadModelUsecase struct{ store EventStore }

func NewReadModelUsecase(store EventStore) *ReadModelUsecase               { return &ReadModelUsecase{store: store} }
func (u *ReadModelUsecase) Checks() map[string]func(context.Context) error { return u.store.Checks() }

func (u *ReadModelUsecase) Apply(ctx context.Context, envelope *envelopev1.EventEnvelope, raw []byte) error {
	if envelope == nil || envelope.GetEventId() == "" || envelope.GetEventType() == "" {
		return fmt.Errorf("invalid reporting event")
	}
	_, err := u.store.StoreAndProject(ctx, envelope, raw)
	return err
}
func (u *ReadModelUsecase) Rebuild(ctx context.Context, parse func([]byte) (*envelopev1.EventEnvelope, error)) error {
	if err := u.store.ResetProjection(ctx); err != nil {
		return err
	}
	return u.store.Replay(ctx, func(ctx context.Context, raw []byte) error {
		envelope, err := parse(raw)
		if err != nil {
			return err
		}
		if envelope == nil || envelope.GetEventId() == "" || envelope.GetEventType() == "" {
			return fmt.Errorf("invalid stored reporting event")
		}
		return u.store.ProjectStored(ctx, envelope)
	})
}
