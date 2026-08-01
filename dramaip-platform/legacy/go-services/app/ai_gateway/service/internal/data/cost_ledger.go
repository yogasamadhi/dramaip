package data

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

const priceUnitTokens int64 = 1_000_000

type ProviderPricing struct {
	InputUnitPrice    string
	OutputUnitPrice   string
	Currency          string
	ExchangeRateToCNY string
	PricingSource     string
}

type CostQuote struct {
	ProviderPricing
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
	CostAmount       string
	CostCNYAmount    string
}

type CostGuardInput struct {
	AuditID          string
	UserID           string
	ClientIP         string
	EstimatedCostCNY string
	Window           time.Duration
	UserLimitCNY     string
	IPLimitCNY       string
}

type ProviderCostInput struct {
	AuditID           string
	UserID            string
	RequestID         string
	ReservationID     string
	Provider          string
	Model             string
	UsageKnown        bool
	CostStatus        string
	Quote             CostQuote
	AlertThresholdCNY string
	ClientIP          string
}

// CostAlert is intentionally a narrow operational projection. It joins the
// immutable alert to its request audit only for the trace id; prompts, client
// IPs, pricing secrets and response payloads remain inside the AI domain.
type CostAlert struct {
	ID, AuditID, UserID, EventType, ObservedCostCNY, ThresholdCNY, TraceID, CreatedAt string
}

func (d *Data) ListCostAlerts(ctx context.Context, limit int, userID string) ([]CostAlert, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var rows []CostAlert
	query := `
		SELECT a.id::text AS id, a.audit_id::text AS audit_id, a.user_id::text AS user_id,
		       a.event_type, a.observed_cost_cny::text AS observed_cost_cny,
		       a.threshold_cny::text AS threshold_cny, COALESCE(r.trace_id, '') AS trace_id,
		       a.created_at::text AS created_at
		FROM ai_gateway.provider_cost_alerts a
		JOIN ai_gateway.request_audits r ON r.id = a.audit_id`
	args := []any{}
	if strings.TrimSpace(userID) != "" {
		query += ` WHERE a.user_id = ?::uuid`
		args = append(args, strings.TrimSpace(userID))
	}
	query += ` ORDER BY a.created_at DESC, a.id DESC LIMIT ?`
	args = append(args, limit)
	err := d.DB.WithContext(ctx).Raw(query, args...).Scan(&rows).Error
	return rows, err
}

func (d *Data) PricingFor(provider Provider, model string) (ProviderPricing, error) {
	if provider.Name == "test" || provider.Name == "test-openai-compatible" {
		return ProviderPricing{InputUnitPrice: "0.10", OutputUnitPrice: "0.20", Currency: "CNY", ExchangeRateToCNY: "1", PricingSource: "test_fixture"}, nil
	}
	providerPrefix := "AI_PROVIDER_" + envKey(provider.Name)
	modelPrefix := providerPrefix + "_" + envKey(model)
	inputPrice, inputPriceSource := firstNonEmptyEnv(modelPrefix+"_INPUT_PRICE_PER_MILLION", providerPrefix+"_INPUT_PRICE_PER_MILLION", "AI_INPUT_PRICE_PER_MILLION")
	outputPrice, outputPriceSource := firstNonEmptyEnv(modelPrefix+"_OUTPUT_PRICE_PER_MILLION", providerPrefix+"_OUTPUT_PRICE_PER_MILLION", "AI_OUTPUT_PRICE_PER_MILLION")
	currency, currencySource := firstNonEmptyEnv(modelPrefix+"_CURRENCY", providerPrefix+"_CURRENCY", "AI_PROVIDER_CURRENCY")
	exchangeRate, exchangeRateSource := firstNonEmptyEnv(modelPrefix+"_EXCHANGE_RATE_TO_CNY", providerPrefix+"_EXCHANGE_RATE_TO_CNY", "AI_EXCHANGE_RATE_TO_CNY")
	pricing := ProviderPricing{
		InputUnitPrice:    inputPrice,
		OutputUnitPrice:   outputPrice,
		Currency:          strings.ToUpper(currency),
		ExchangeRateToCNY: exchangeRate,
		PricingSource: "env:" + strings.Join([]string{
			"input=" + inputPriceSource,
			"output=" + outputPriceSource,
			"currency=" + currencySource,
			"exchange=" + exchangeRateSource,
		}, ";"),
	}
	if pricing.Currency == "CNY" && pricing.ExchangeRateToCNY == "" {
		pricing.ExchangeRateToCNY = "1"
	}
	if _, err := pricing.quote(0, 0); err != nil {
		return ProviderPricing{}, status.Errorf(codes.FailedPrecondition, "provider pricing is not configured for %s/%s: %v", provider.Name, model, err)
	}
	return pricing, nil
}

func (p ProviderPricing) Quote(promptTokens, completionTokens int64) (CostQuote, error) {
	return p.quote(promptTokens, completionTokens)
}

func (p ProviderPricing) quote(promptTokens, completionTokens int64) (CostQuote, error) {
	if promptTokens < 0 || completionTokens < 0 {
		return CostQuote{}, fmt.Errorf("negative token usage")
	}
	input, err := positiveDecimal(p.InputUnitPrice)
	if err != nil {
		return CostQuote{}, fmt.Errorf("input unit price: %w", err)
	}
	output, err := positiveDecimal(p.OutputUnitPrice)
	if err != nil {
		return CostQuote{}, fmt.Errorf("output unit price: %w", err)
	}
	exchange, err := positiveDecimal(p.ExchangeRateToCNY)
	if err != nil {
		return CostQuote{}, fmt.Errorf("exchange rate: %w", err)
	}
	if len(strings.TrimSpace(p.Currency)) != 3 {
		return CostQuote{}, fmt.Errorf("currency must be ISO-4217-like")
	}
	unit := big.NewRat(priceUnitTokens, 1)
	cost := new(big.Rat).Add(
		new(big.Rat).Mul(big.NewRat(promptTokens, 1), input),
		new(big.Rat).Mul(big.NewRat(completionTokens, 1), output),
	)
	cost.Quo(cost, unit)
	costCNY := new(big.Rat).Mul(cost, exchange)
	return CostQuote{
		ProviderPricing: p, PromptTokens: promptTokens, CompletionTokens: completionTokens,
		TotalTokens: promptTokens + completionTokens, CostAmount: cost.FloatString(12), CostCNYAmount: costCNY.FloatString(12),
	}, nil
}

func positiveDecimal(value string) (*big.Rat, error) {
	rat, ok := new(big.Rat).SetString(strings.TrimSpace(value))
	if !ok || rat.Sign() <= 0 {
		return nil, fmt.Errorf("must be a positive decimal")
	}
	return rat, nil
}

func firstNonEmptyEnv(keys ...string) (value string, source string) {
	for _, key := range keys {
		if value, ok := os.LookupEnv(key); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value), key
		}
	}
	return "", ""
}

// ReserveCostBudget atomically accounts for completed cost logs plus open
// estimates. Advisory locks prevent concurrent requests from bypassing a
// user/IP short-window budget.
func (d *Data) ReserveCostBudget(ctx context.Context, input CostGuardInput) error {
	if input.Window <= 0 || (isDisabledLimit(input.UserLimitCNY) && (input.ClientIP == "" || isDisabledLimit(input.IPLimitCNY))) {
		return nil
	}
	if _, err := positiveDecimal(input.EstimatedCostCNY); err != nil {
		return fmt.Errorf("estimated cost: %w", err)
	}
	tx := d.DB.WithContext(ctx).Begin()
	if tx.Error != nil {
		return tx.Error
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	for _, key := range []string{"provider-cost:user:" + input.UserID, "provider-cost:ip:" + input.ClientIP} {
		if strings.HasSuffix(key, ":") {
			continue
		}
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended(?, 0))`, key).Error; err != nil {
			return err
		}
	}
	if !isDisabledLimit(input.UserLimitCNY) {
		exceeded, err := d.costBudgetExceeded(tx, "user_id", input.UserID, input, input.UserLimitCNY)
		if err != nil {
			return err
		}
		if exceeded {
			if err := d.writeCostAlert(tx, input.AuditID, input.UserID, input.ClientIP, "user_cost_limit_rejected", input.EstimatedCostCNY, input.UserLimitCNY, "user"); err != nil {
				return err
			}
			if err := tx.Commit().Error; err != nil {
				return err
			}
			committed = true
			platform.RecordCostAlert("user_cost_limit_rejected")
			return status.Error(codes.ResourceExhausted, "ai user cost limit exceeded")
		}
	}
	if input.ClientIP != "" && !isDisabledLimit(input.IPLimitCNY) {
		exceeded, err := d.costBudgetExceeded(tx, "client_ip", input.ClientIP, input, input.IPLimitCNY)
		if err != nil {
			return err
		}
		if exceeded {
			if err := d.writeCostAlert(tx, input.AuditID, input.UserID, input.ClientIP, "ip_cost_limit_rejected", input.EstimatedCostCNY, input.IPLimitCNY, "ip"); err != nil {
				return err
			}
			if err := tx.Commit().Error; err != nil {
				return err
			}
			committed = true
			platform.RecordCostAlert("ip_cost_limit_rejected")
			return status.Error(codes.ResourceExhausted, "ai ip cost limit exceeded")
		}
	}
	if err := tx.Exec(`
		INSERT INTO ai_gateway.cost_limit_reservations (audit_id, user_id, client_ip, estimated_cost_cny)
		VALUES (?::uuid, ?::uuid, ?, ?::numeric)
		ON CONFLICT (audit_id) DO NOTHING
	`, input.AuditID, input.UserID, input.ClientIP, input.EstimatedCostCNY).Error; err != nil {
		return err
	}
	if err := tx.Commit().Error; err != nil {
		return err
	}
	committed = true
	return nil
}

func (d *Data) costBudgetExceeded(tx *gorm.DB, column string, value string, input CostGuardInput, limit string) (bool, error) {
	var exceeded bool
	query := fmt.Sprintf(`
		SELECT (
			COALESCE((SELECT SUM(cost_cny_amount) FROM ai_gateway.provider_cost_logs WHERE %s = ?%s AND priced_at >= now() - (?::bigint * interval '1 second')), 0)
			+ COALESCE((SELECT SUM(estimated_cost_cny) FROM ai_gateway.cost_limit_reservations WHERE %s = ?%s AND released_at IS NULL AND created_at >= now() - (?::bigint * interval '1 second')), 0)
			+ ?::numeric
		) > ?::numeric
	`, column, castForColumn(column), column, castForColumn(column))
	seconds := int64(input.Window.Seconds())
	err := tx.Raw(query, value, seconds, value, seconds, input.EstimatedCostCNY, limit).Scan(&exceeded).Error
	return exceeded, err
}

func castForColumn(column string) string {
	if column == "user_id" {
		return "::uuid"
	}
	return ""
}

func isDisabledLimit(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return true
	}
	rat, ok := new(big.Rat).SetString(value)
	return ok && rat.Sign() == 0
}

func (d *Data) ReleaseCostBudget(ctx context.Context, auditID string) error {
	if auditID == "" {
		return nil
	}
	return d.DB.WithContext(ctx).Exec(`
		UPDATE ai_gateway.cost_limit_reservations SET released_at = now()
		WHERE audit_id = ?::uuid AND released_at IS NULL
	`, auditID).Error
}

func (d *Data) RecordProviderCost(ctx context.Context, input ProviderCostInput) error {
	tx := d.DB.WithContext(ctx).Begin()
	if tx.Error != nil {
		return tx.Error
	}
	if err := tx.Exec(`
		INSERT INTO ai_gateway.provider_cost_logs (
			id, audit_id, user_id, client_ip, request_id, reservation_id, provider, model,
			prompt_tokens, completion_tokens, total_tokens, usage_known,
			input_unit_price, output_unit_price, price_unit_tokens, currency, exchange_rate_to_cny,
			cost_amount, cost_cny_amount, pricing_source, cost_status
		) VALUES (
			?::uuid, ?::uuid, ?::uuid, ?, ?, NULLIF(?, '')::uuid, ?, ?, ?, ?, ?, ?,
			?::numeric, ?::numeric, ?, ?, ?::numeric, ?::numeric, ?::numeric, ?, ?
		) ON CONFLICT (audit_id) DO NOTHING
	`, platform.NewUUID(), input.AuditID, input.UserID, input.ClientIP, input.RequestID, input.ReservationID, input.Provider, input.Model,
		input.Quote.PromptTokens, input.Quote.CompletionTokens, input.Quote.TotalTokens, input.UsageKnown,
		input.Quote.InputUnitPrice, input.Quote.OutputUnitPrice, priceUnitTokens, input.Quote.Currency, input.Quote.ExchangeRateToCNY,
		input.Quote.CostAmount, input.Quote.CostCNYAmount, input.Quote.PricingSource, input.CostStatus).Error; err != nil {
		_ = tx.Rollback()
		return err
	}
	alerted := false
	if !isDisabledLimit(input.AlertThresholdCNY) {
		var alert bool
		if err := tx.Raw(`SELECT ?::numeric >= ?::numeric`, input.Quote.CostCNYAmount, input.AlertThresholdCNY).Scan(&alert).Error; err != nil {
			_ = tx.Rollback()
			return err
		}
		if alert {
			if err := d.writeCostAlert(tx, input.AuditID, input.UserID, input.ClientIP, "high_request_cost", input.Quote.CostCNYAmount, input.AlertThresholdCNY, input.CostStatus); err != nil {
				_ = tx.Rollback()
				return err
			}
			alerted = true
		}
	}
	if err := tx.Exec(`UPDATE ai_gateway.cost_limit_reservations SET released_at = now() WHERE audit_id = ?::uuid AND released_at IS NULL`, input.AuditID).Error; err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit().Error; err != nil {
		return err
	}
	if alerted {
		platform.RecordCostAlert("high_request_cost")
	}
	return nil
}

func (d *Data) writeCostAlert(tx *gorm.DB, auditID, userID, clientIP, eventType, observed, threshold, scope string) error {
	details, err := json.Marshal(map[string]string{"scope": scope})
	if err != nil {
		return err
	}
	return tx.Exec(`
		INSERT INTO ai_gateway.provider_cost_alerts (id, audit_id, user_id, client_ip, event_type, observed_cost_cny, threshold_cny, details)
		VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?::numeric, ?::numeric, ?::jsonb)
		ON CONFLICT (audit_id, event_type) DO NOTHING
	`, platform.NewUUID(), auditID, userID, clientIP, eventType, observed, threshold, string(details)).Error
}
