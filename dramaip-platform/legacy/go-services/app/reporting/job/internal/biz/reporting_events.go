package biz

import (
	"context"

	reportingbiz "github.com/dramaip/dramaip-platform/services/app/reporting/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/reporting/job/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/events"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type EventSource interface {
	Checks() map[string]func(context.Context) error
	Consume(context.Context, func(context.Context, []byte) error) error
}

type ReportingEventUsecase struct {
	source         EventSource
	model          *reportingbiz.ReadModelUsecase
	rebuildOnStart bool
}

func NewReportingEventUsecase(source EventSource, store reportingbiz.EventStore, cfg *conf.Bootstrap) *ReportingEventUsecase {
	return &ReportingEventUsecase{source: source, model: reportingbiz.NewReadModelUsecase(store), rebuildOnStart: cfg.Job.RebuildOnStart}
}
func (u *ReportingEventUsecase) Checks() map[string]func(context.Context) error {
	checks := map[string]func(context.Context) error{}
	for name, check := range u.source.Checks() {
		checks[name] = check
	}
	for name, check := range u.model.Checks() {
		checks[name] = check
	}
	return checks
}
func (u *ReportingEventUsecase) Run(ctx context.Context) error {
	if u.rebuildOnStart {
		if err := u.model.Rebuild(ctx, events.ParseEnvelope); err != nil {
			return err
		}
		platform.StructuredLog(ctx, "reporting-job", "info", "reporting_read_model_rebuilt", nil)
	}
	return u.source.Consume(ctx, u.Handle)
}
func (u *ReportingEventUsecase) Handle(ctx context.Context, raw []byte) error {
	envelope, err := events.ParseEnvelope(raw)
	if err != nil {
		return err
	}
	if err := u.model.Apply(ctx, envelope, raw); err != nil {
		return err
	}
	platform.StructuredLog(ctx, "reporting-job", "info", "reporting_event_projected", map[string]any{"event_id": envelope.GetEventId(), "event_type": envelope.GetEventType()})
	return nil
}
