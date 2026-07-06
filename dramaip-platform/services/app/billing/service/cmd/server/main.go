package main

import (
	"context"
	"encoding/json"
	"log"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	drpc "github.com/dramaip/dramaip-platform/services/pkg/rpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type service struct{ db *gorm.DB }

func main() {
	db, err := platform.OpenPostgres()
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	svc := &service{db: db}
	health := platform.HealthServer(platform.Env("BILLING_HTTP_ADDR", ":8103"), "billing-service", map[string]func(context.Context) error{
		"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, db) },
	})
	go func() {
		if err := health.ListenAndServe(); err != nil {
			log.Printf("billing health server stopped: %v", err)
		}
	}()
	if err := platform.ServeGRPC(platform.Env("BILLING_GRPC_ADDR", ":9103"), func(server *grpc.Server) {
		drpc.RegisterBillingServiceServer(server, svc)
	}); err != nil {
		log.Fatalf("billing gRPC failed: %v", err)
	}
}

func (s *service) ListPlans(ctx context.Context, _ *drpc.ListPlansRequest) (*drpc.ListPlansReply, error) {
	var rows []struct {
		ID                string
		Code              string
		Name              string
		Price             float64
		Currency          string
		MonthlyTokenQuota int64
		ModelLevel        string
		MaxRPM            int64
	}
	if err := s.db.WithContext(ctx).Raw(`
		SELECT id::text AS id, code, name, price, currency, monthly_token_quota, model_level, max_rpm
		FROM billing.plans
		WHERE is_active = true
		ORDER BY price ASC
	`).Scan(&rows).Error; err != nil {
		return nil, err
	}
	plans := make([]drpc.Plan, 0, len(rows))
	for _, row := range rows {
		plans = append(plans, drpc.Plan{
			ID: row.Code, Code: row.Code, Name: row.Name, PriceCNY: int64(row.Price),
			Currency: row.Currency, MonthlyTokenQuota: row.MonthlyTokenQuota, ModelLevel: row.ModelLevel, MaxRPM: row.MaxRPM,
		})
	}
	return &drpc.ListPlansReply{Plans: plans}, nil
}

func (s *service) GetSubscription(ctx context.Context, req *drpc.GetSubscriptionRequest) (*drpc.Subscription, error) {
	var row drpc.Subscription
	err := s.db.WithContext(ctx).Raw(`
		SELECT
			sub.id::text AS id,
			sub.user_id::text AS user_id,
			sub.plan_id::text AS plan_id,
			plan.code AS plan_code,
			sub.status,
			sub.current_period_start::text AS current_period_start,
			sub.current_period_end::text AS current_period_end
		FROM billing.subscriptions sub
		JOIN billing.plans plan ON plan.id = sub.plan_id
		WHERE sub.user_id = ?::uuid AND sub.status = 'active'
		ORDER BY sub.created_at DESC
		LIMIT 1
	`, req.UserID).Scan(&row).Error
	if err != nil || row.ID == "" {
		return nil, status.Error(codes.NotFound, "subscription not found")
	}
	return &row, nil
}

func (s *service) CreateCheckout(ctx context.Context, req *drpc.CreateCheckoutRequest) (*drpc.CreateCheckoutReply, error) {
	provider := req.Provider
	if provider == "" {
		provider = "wechat_pay"
	}
	var plan struct {
		ID    string
		Code  string
		Price float64
	}
	if err := s.db.WithContext(ctx).Raw(`
		SELECT id::text AS id, code, price
		FROM billing.plans
		WHERE code = ? AND is_active = true
		LIMIT 1
	`, req.PlanID).Scan(&plan).Error; err != nil || plan.ID == "" {
		return nil, status.Error(codes.NotFound, "plan not found")
	}
	orderID := platform.NewUUID()
	eventID := platform.NewUUID()
	event := map[string]any{"order_id": orderID, "user_id": req.UserID, "plan": plan.Code, "channel": provider, "amount": plan.Price}
	raw, err := json.Marshal(event)
	if err != nil {
		return nil, err
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`
			INSERT INTO billing.orders (id, user_id, plan_id, amount, currency, status, provider, provider_order_id)
			VALUES (?::uuid, ?::uuid, ?::uuid, ?, 'CNY', 'pending', ?, ?)
		`, orderID, req.UserID, plan.ID, plan.Price, provider, orderID).Error; err != nil {
			return err
		}
		return tx.Exec(`
			INSERT INTO billing.outbox_events (id, aggregate_type, aggregate_id, event_type, payload)
			VALUES (?::uuid, 'billing.order', ?::uuid, 'billing.checkout.created', ?::jsonb)
		`, eventID, orderID, string(raw)).Error
	})
	if err != nil {
		return nil, err
	}
	return &drpc.CreateCheckoutReply{
		OrderID: orderID, PlanID: plan.Code, Provider: provider, Status: "pending",
		PaymentURL: "https://pay.example.com/orders/" + orderID, Event: event,
	}, nil
}
