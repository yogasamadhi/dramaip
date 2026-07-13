package data

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

var (
	ErrConfirmationInvalid = errors.New("admin confirmation is invalid")
	ErrPrincipalState      = errors.New("admin principal state cannot change")
)

type Principal struct {
	ID, Email, PasswordHash, Status string
	Roles                           []string
}
type Confirmation struct{ ID, Action, TargetID, Reason, ExpiresAt string }
type AuditLog struct {
	ID, ActorID, Action, ResourceType, ResourceID, Reason, TraceID, CreatedAt string
	BeforeState, AfterState                                                   json.RawMessage
}
type SessionInput struct {
	ID, PrincipalID, TokenIDHash string
	TraceID                      string
	ExpiresAt                    time.Time
}
type ConfirmationInput struct {
	ID, ActorID, Action, TargetID, Reason, TraceID string
	ExpiresAt                                      time.Time
}

type AdminRepo struct{ data *Data }

func NewAdminRepo(data *Data) *AdminRepo { return &AdminRepo{data: data} }
func (r *AdminRepo) Checks() map[string]func(context.Context) error {
	return map[string]func(context.Context) error{"postgres": func(ctx context.Context) error { return platform.CheckPostgres(ctx, r.data.DB) }}
}

func (r *AdminRepo) FindPrincipalByEmail(ctx context.Context, email string) (Principal, error) {
	var row Principal
	err := r.data.DB.WithContext(ctx).Raw(`SELECT id::text AS id, email, password_hash, status FROM admin.principals WHERE email = ? LIMIT 1`, strings.ToLower(strings.TrimSpace(email))).Scan(&row).Error
	if err != nil || row.ID == "" {
		return Principal{}, gorm.ErrRecordNotFound
	}
	roles, err := r.Roles(ctx, row.ID)
	if err != nil {
		return Principal{}, err
	}
	row.Roles = roles
	return row, nil
}

func (r *AdminRepo) FindPrincipalByID(ctx context.Context, id string) (Principal, error) {
	var row Principal
	err := r.data.DB.WithContext(ctx).Raw(`SELECT id::text AS id, email, password_hash, status FROM admin.principals WHERE id = ?::uuid LIMIT 1`, id).Scan(&row).Error
	if err != nil || row.ID == "" {
		return Principal{}, gorm.ErrRecordNotFound
	}
	roles, err := r.Roles(ctx, row.ID)
	if err != nil {
		return Principal{}, err
	}
	row.Roles = roles
	return row, nil
}

func (r *AdminRepo) Roles(ctx context.Context, principalID string) ([]string, error) {
	var rows []struct{ Role string }
	if err := r.data.DB.WithContext(ctx).Raw(`SELECT role FROM admin.principal_roles WHERE principal_id = ?::uuid ORDER BY role`, principalID).Scan(&rows).Error; err != nil {
		return nil, err
	}
	roles := make([]string, 0, len(rows))
	for _, row := range rows {
		roles = append(roles, row.Role)
	}
	return roles, nil
}

func (r *AdminRepo) CreateSession(ctx context.Context, input SessionInput) error {
	before, _ := json.Marshal(map[string]string{"status": "none"})
	after, _ := json.Marshal(map[string]string{"status": "active", "expires_at": input.ExpiresAt.UTC().Format(time.RFC3339)})
	return r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`INSERT INTO admin.sessions (id, principal_id, token_id_hash, expires_at) VALUES (?::uuid, ?::uuid, ?, ?)`, input.ID, input.PrincipalID, input.TokenIDHash, input.ExpiresAt).Error; err != nil {
			return err
		}
		return insertAudit(ctx, tx, input.PrincipalID, "admin.session.created", "session", input.ID, "admin_login", before, after, input.TraceID)
	})
}

func (r *AdminRepo) SessionActive(ctx context.Context, principalID, tokenIDHash string) (bool, error) {
	var active bool
	err := r.data.DB.WithContext(ctx).Raw(`SELECT EXISTS (SELECT 1 FROM admin.sessions s JOIN admin.principals p ON p.id = s.principal_id WHERE s.principal_id = ?::uuid AND s.token_id_hash = ? AND s.revoked_at IS NULL AND s.expires_at > now() AND p.status = 'active')`, principalID, tokenIDHash).Scan(&active).Error
	return active, err
}

func (r *AdminRepo) CreateConfirmation(ctx context.Context, input ConfirmationInput) (Confirmation, error) {
	before, _ := json.Marshal(map[string]string{"status": "none"})
	after, _ := json.Marshal(map[string]string{"status": "pending", "action": input.Action, "target_id": input.TargetID})
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`INSERT INTO admin.confirmations (id, actor_id, action, target_id, reason, expires_at) VALUES (?::uuid, ?::uuid, ?, ?::uuid, ?, ?)`, input.ID, input.ActorID, input.Action, input.TargetID, input.Reason, input.ExpiresAt).Error; err != nil {
			return err
		}
		return insertAudit(ctx, tx, input.ActorID, "admin.confirmation.created", "confirmation", input.ID, input.Reason, before, after, input.TraceID)
	})
	if err != nil {
		return Confirmation{}, err
	}
	return Confirmation{ID: input.ID, Action: input.Action, TargetID: input.TargetID, Reason: input.Reason, ExpiresAt: input.ExpiresAt.UTC().Format(time.RFC3339)}, nil
}

// SuspendWithConfirmation consumes the one-time confirmation, changes exactly
// one admin principal, and appends both confirmation and principal evidence in
// the same transaction. It never changes a customer-domain record.
func (r *AdminRepo) SuspendWithConfirmation(ctx context.Context, actorID, targetID, confirmationID, traceID string) (Principal, error) {
	var target Principal
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var confirmation Confirmation
		if err := tx.Raw(`SELECT id::text AS id, action, target_id::text AS target_id, reason, expires_at::text AS expires_at FROM admin.confirmations WHERE id = ?::uuid AND actor_id = ?::uuid AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`, confirmationID, actorID).Scan(&confirmation).Error; err != nil || confirmation.ID == "" || confirmation.Action != "principal.suspend" || confirmation.TargetID != targetID {
			return ErrConfirmationInvalid
		}
		if actorID == targetID {
			return ErrPrincipalState
		}
		if err := tx.Exec(`UPDATE admin.confirmations SET consumed_at = now() WHERE id = ?::uuid AND consumed_at IS NULL`, confirmationID).Error; err != nil {
			return err
		}
		confirmationBefore, _ := json.Marshal(map[string]string{"status": "pending"})
		confirmationAfter, _ := json.Marshal(map[string]string{"status": "consumed"})
		if err := insertAudit(ctx, tx, actorID, "admin.confirmation.consumed", "confirmation", confirmationID, confirmation.Reason, confirmationBefore, confirmationAfter, traceID); err != nil {
			return err
		}
		if err := tx.Raw(`SELECT id::text AS id, email, password_hash, status FROM admin.principals WHERE id = ?::uuid FOR UPDATE`, targetID).Scan(&target).Error; err != nil || target.ID == "" {
			return gorm.ErrRecordNotFound
		}
		if target.Status != "active" {
			return ErrPrincipalState
		}
		before, _ := json.Marshal(map[string]string{"status": target.Status})
		after, _ := json.Marshal(map[string]string{"status": "suspended"})
		if err := tx.Exec(`UPDATE admin.principals SET status = 'suspended', updated_at = now() WHERE id = ?::uuid AND status = 'active'`, targetID).Error; err != nil {
			return err
		}
		if err := insertAudit(ctx, tx, actorID, "admin.principal.suspended", "principal", targetID, confirmation.Reason, before, after, traceID); err != nil {
			return err
		}
		target.Status = "suspended"
		return nil
	})
	if err != nil {
		return Principal{}, err
	}
	roles, err := r.Roles(ctx, target.ID)
	if err != nil {
		return Principal{}, err
	}
	target.Roles = roles
	return target, nil
}

func (r *AdminRepo) ConsumeReportingExceptionConfirmation(ctx context.Context, actorID, exceptionID, confirmationID, traceID string) (string, error) {
	var reason string
	err := r.data.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var confirmation Confirmation
		if err := tx.Raw(`SELECT id::text AS id, action, target_id::text AS target_id, reason, expires_at::text AS expires_at FROM admin.confirmations WHERE id = ?::uuid AND actor_id = ?::uuid AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`, confirmationID, actorID).Scan(&confirmation).Error; err != nil || confirmation.ID == "" || confirmation.Action != "reporting.exception.resolve" || confirmation.TargetID != exceptionID {
			return ErrConfirmationInvalid
		}
		if err := tx.Exec(`UPDATE admin.confirmations SET consumed_at = now() WHERE id = ?::uuid AND consumed_at IS NULL`, confirmationID).Error; err != nil {
			return err
		}
		before, _ := json.Marshal(map[string]string{"status": "pending"})
		after, _ := json.Marshal(map[string]string{"status": "consumed"})
		if err := insertAudit(ctx, tx, actorID, "admin.confirmation.consumed", "confirmation", confirmationID, confirmation.Reason, before, after, traceID); err != nil {
			return err
		}
		request, _ := json.Marshal(map[string]string{"status": "requested"})
		if err := insertAudit(ctx, tx, actorID, "admin.reporting.exception.resolve.requested", "reporting_exception", exceptionID, confirmation.Reason, before, request, traceID); err != nil {
			return err
		}
		reason = confirmation.Reason
		return nil
	})
	return reason, err
}

func (r *AdminRepo) ListAuditLogs(ctx context.Context, limit int) ([]AuditLog, error) {
	var rows []AuditLog
	err := r.data.DB.WithContext(ctx).Raw(`SELECT id::text AS id, actor_id::text AS actor_id, action, resource_type, resource_id, reason, before_state, after_state, trace_id, created_at::text AS created_at FROM admin.audit_logs ORDER BY created_at DESC, id DESC LIMIT ?`, limit).Scan(&rows).Error
	return rows, err
}

func insertAudit(ctx context.Context, tx *gorm.DB, actorID, action, resourceType, resourceID, reason string, before, after []byte, traceID string) error {
	return tx.WithContext(ctx).Exec(`INSERT INTO admin.audit_logs (id, actor_id, action, resource_type, resource_id, reason, before_state, after_state, trace_id) VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)`, platform.NewUUID(), actorID, action, resourceType, resourceID, reason, string(before), string(after), traceID).Error
}
