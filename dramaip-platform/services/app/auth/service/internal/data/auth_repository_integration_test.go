package data

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestRotateRefreshTokenDetectsReuseAndDeviceRevocation(t *testing.T) {
	dsn := os.Getenv("POSTGRES_AUTH_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_AUTH_TEST_DSN not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	if err := resetAuthSchema(db); err != nil {
		t.Fatalf("prepare auth schema: %v", err)
	}
	t.Cleanup(func() { _ = db.Exec("DROP SCHEMA IF EXISTS auth CASCADE").Error })

	ctx := context.Background()
	repo := NewAuthRepo(&Data{DB: db})
	userID := "00000000-0000-0000-0000-000000000001"
	if err := db.Exec(`INSERT INTO auth.users (id, email, password_hash) VALUES (?::uuid, ?, ?)`, userID, "rotate@example.test", "hash").Error; err != nil {
		t.Fatalf("insert user: %v", err)
	}
	original := RefreshTokenInput{
		ID:        "00000000-0000-0000-0000-000000000010",
		UserID:    userID,
		TokenHash: "original-token-hash",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
		FamilyID:  "00000000-0000-0000-0000-000000000010",
		DeviceID:  "desktop-a",
	}
	if err := repo.InsertRefreshToken(ctx, original); err != nil {
		t.Fatalf("insert original token: %v", err)
	}
	replacement := RefreshTokenInput{
		ID:        "00000000-0000-0000-0000-000000000011",
		TokenHash: "replacement-token-hash",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	user, err := repo.RotateRefreshToken(ctx, original.TokenHash, replacement)
	if err != nil {
		t.Fatalf("rotate refresh token: %v", err)
	}
	if user.ID != userID {
		t.Fatalf("rotated user id = %q, want %q", user.ID, userID)
	}

	var originalReason, replacementReason, replacementDevice string
	if err := db.Raw(`
		SELECT
			(SELECT revoked_reason FROM auth.refresh_tokens WHERE id = ?::uuid),
			(SELECT COALESCE(revoked_reason, '') FROM auth.refresh_tokens WHERE id = ?::uuid),
			(SELECT COALESCE(device_id, '') FROM auth.refresh_tokens WHERE id = ?::uuid)
	`, original.ID, replacement.ID, replacement.ID).Row().Scan(&originalReason, &replacementReason, &replacementDevice); err != nil {
		t.Fatalf("inspect rotated tokens: %v", err)
	}
	if originalReason != "rotated" || replacementReason != "" || replacementDevice != "desktop-a" {
		t.Fatalf("rotation audit = original:%q replacement:%q device:%q", originalReason, replacementReason, replacementDevice)
	}

	if _, err := repo.RotateRefreshToken(ctx, original.TokenHash, RefreshTokenInput{
		ID: "00000000-0000-0000-0000-000000000012", TokenHash: "unexpected", ExpiresAt: time.Now().UTC().Add(time.Hour),
	}); !errors.Is(err, ErrRefreshTokenReuse) {
		t.Fatalf("replay error = %v, want ErrRefreshTokenReuse", err)
	}
	if err := db.Raw(`SELECT revoked_reason FROM auth.refresh_tokens WHERE id = ?::uuid`, replacement.ID).Row().Scan(&replacementReason); err != nil {
		t.Fatalf("inspect reuse revocation: %v", err)
	}
	if replacementReason != "reuse_detected" {
		t.Fatalf("replacement revoke reason = %q", replacementReason)
	}

	deviceToken := RefreshTokenInput{
		ID:        "00000000-0000-0000-0000-000000000013",
		UserID:    userID,
		TokenHash: "device-token-hash",
		ExpiresAt: time.Now().UTC().Add(time.Hour),
		FamilyID:  "00000000-0000-0000-0000-000000000013",
		DeviceID:  "desktop-a",
	}
	if err := repo.InsertRefreshToken(ctx, deviceToken); err != nil {
		t.Fatalf("insert device token: %v", err)
	}
	if err := repo.RevokeRefreshTokensByDevice(ctx, userID, "desktop-a"); err != nil {
		t.Fatalf("revoke device tokens: %v", err)
	}
	if err := db.Raw(`SELECT revoked_reason FROM auth.refresh_tokens WHERE id = ?::uuid`, deviceToken.ID).Row().Scan(&replacementReason); err != nil {
		t.Fatalf("inspect device revocation: %v", err)
	}
	if replacementReason != "device_logout" {
		t.Fatalf("device revoke reason = %q", replacementReason)
	}
}

func TestDesktopAuthorizationCodeIsBoundAndSingleUse(t *testing.T) {
	dsn := os.Getenv("POSTGRES_AUTH_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_AUTH_TEST_DSN not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	if err := resetAuthSchema(db); err != nil {
		t.Fatalf("prepare auth schema: %v", err)
	}
	t.Cleanup(func() { _ = db.Exec("DROP SCHEMA IF EXISTS auth CASCADE").Error })

	ctx := context.Background()
	repo := NewAuthRepo(&Data{DB: db})
	userID := "00000000-0000-0000-0000-000000000021"
	if err := db.Exec(`INSERT INTO auth.users (id, email, password_hash) VALUES (?::uuid, ?, ?)`, userID, "desktop@example.test", "hash").Error; err != nil {
		t.Fatalf("insert user: %v", err)
	}
	input := DesktopAuthorizationCodeInput{
		ID: "00000000-0000-0000-0000-000000000022", UserID: userID, CodeHash: "one-time-code-hash",
		CodeChallenge: "challenge-a", RedirectURI: "http://127.0.0.1:43123/callback", DeviceID: "desktop-device-a", ExpiresAt: time.Now().UTC().Add(time.Minute),
	}
	if err := repo.CreateDesktopAuthorizationCode(ctx, input); err != nil {
		t.Fatalf("create desktop authorization code: %v", err)
	}
	if _, err := repo.ConsumeDesktopAuthorizationCode(ctx, input.CodeHash, "challenge-b", input.RedirectURI, input.DeviceID); !errors.Is(err, ErrDesktopAuthorizationCodeNotFound) {
		t.Fatalf("wrong verifier challenge error = %v", err)
	}
	user, err := repo.ConsumeDesktopAuthorizationCode(ctx, input.CodeHash, input.CodeChallenge, input.RedirectURI, input.DeviceID)
	if err != nil || user.ID != userID {
		t.Fatalf("consume desktop authorization code = %#v, %v", user, err)
	}
	if _, err := repo.ConsumeDesktopAuthorizationCode(ctx, input.CodeHash, input.CodeChallenge, input.RedirectURI, input.DeviceID); !errors.Is(err, ErrDesktopAuthorizationCodeNotFound) {
		t.Fatalf("replay error = %v", err)
	}
	var consumedReason string
	if err := db.Raw(`SELECT consumed_reason FROM auth.desktop_authorization_codes WHERE id = ?::uuid`, input.ID).Row().Scan(&consumedReason); err != nil {
		t.Fatalf("read consumption audit: %v", err)
	}
	if consumedReason != "exchanged" {
		t.Fatalf("consumed reason = %q", consumedReason)
	}
}

func resetAuthSchema(db *gorm.DB) error {
	if err := db.Exec("DROP SCHEMA IF EXISTS auth CASCADE").Error; err != nil {
		return err
	}
	for _, name := range []string{"001_auth_init.up.sql", "016_auth_jwks_refresh_rotation.up.sql", "029_auth_desktop_authorization_codes.up.sql"} {
		raw, err := os.ReadFile(filepath.Join(authMigrationsDir(), name))
		if err != nil {
			return err
		}
		if err := db.Exec(string(raw)).Error; err != nil {
			return fmt.Errorf("apply %s: %w", name, err)
		}
	}
	return nil
}

func authMigrationsDir() string {
	root, _ := filepath.Abs("../../../../..")
	return filepath.Join(root, "migrations", "auth")
}
