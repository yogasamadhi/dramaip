package platform

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// DatabaseRole describes a runtime login that owns no DDL capability and is
// restricted to exactly one domain schema. Jobs intentionally reuse their
// domain's role; the migration process is the only DDL identity.
type DatabaseRole struct {
	Name        string
	Schema      string
	PasswordEnv string
}

var DatabaseRoles = []DatabaseRole{
	{Name: "dramaip_auth", Schema: "auth", PasswordEnv: "POSTGRES_AUTH_PASSWORD"},
	{Name: "dramaip_user", Schema: "user_profile", PasswordEnv: "POSTGRES_USER_PROFILE_PASSWORD"},
	{Name: "dramaip_billing", Schema: "billing", PasswordEnv: "POSTGRES_BILLING_PASSWORD"},
	{Name: "dramaip_quota", Schema: "quota", PasswordEnv: "POSTGRES_QUOTA_PASSWORD"},
	{Name: "dramaip_ai_gateway", Schema: "ai_gateway", PasswordEnv: "POSTGRES_AI_GATEWAY_PASSWORD"},
	{Name: "dramaip_notification", Schema: "notification", PasswordEnv: "POSTGRES_NOTIFICATION_PASSWORD"},
}

func DatabaseRoleForSchema(schema string) (DatabaseRole, error) {
	for _, role := range DatabaseRoles {
		if role.Schema == schema {
			return role, nil
		}
	}
	return DatabaseRole{}, fmt.Errorf("no database role is configured for schema %q", schema)
}

// OpenDomainPostgres connects a runtime process with its domain role and
// verifies, during startup, that the role cannot use any other domain schema.
// The migration job must use OpenPostgres because it is the DDL identity.
func OpenDomainPostgres(ctx context.Context, schema string) (*gorm.DB, error) {
	role, err := DatabaseRoleForSchema(schema)
	if err != nil {
		return nil, err
	}
	password := Env(role.PasswordEnv, Env("POSTGRES_PASSWORD", ""))
	if password == "" {
		return nil, fmt.Errorf("%s is required for database role %s", role.PasswordEnv, role.Name)
	}
	dsn, err := postgresDSNForRole(role.Name, password)
	if err != nil {
		return nil, err
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	if err := VerifyDomainDatabaseRole(ctx, db, role); err != nil {
		return nil, err
	}
	return db, nil
}

func postgresDSNForRole(user string, password string) (string, error) {
	if dsn := os.Getenv("POSTGRES_DSN"); dsn != "" {
		parsed, err := url.Parse(dsn)
		if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") {
			return "", fmt.Errorf("POSTGRES_DSN must be a postgres URL when using domain database roles")
		}
		parsed.User = url.UserPassword(user, password)
		return parsed.String(), nil
	}
	return fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=%s TimeZone=%s",
		Env("POSTGRES_HOST", "localhost"),
		user,
		password,
		Env("POSTGRES_DB", "dramaip"),
		Env("POSTGRES_PORT", "5432"),
		Env("POSTGRES_SSLMODE", "disable"),
		Env("TIMEZONE", "Asia/Shanghai"),
	), nil
}

func VerifyDomainDatabaseRole(ctx context.Context, db *gorm.DB, expected DatabaseRole) error {
	var currentUser string
	if err := db.WithContext(ctx).Raw(`SELECT current_user`).Scan(&currentUser).Error; err != nil {
		return fmt.Errorf("read current database role: %w", err)
	}
	if currentUser != expected.Name {
		return fmt.Errorf("database role check failed: connected as %q, expected %q", currentUser, expected.Name)
	}

	for _, role := range DatabaseRoles {
		var allowed bool
		if err := db.WithContext(ctx).Raw(`SELECT has_schema_privilege(current_user, ?, 'USAGE')`, role.Schema).Scan(&allowed).Error; err != nil {
			return fmt.Errorf("check database role %s on schema %s: %w", expected.Name, role.Schema, err)
		}
		if role.Schema == expected.Schema && !allowed {
			return fmt.Errorf("database role check failed: %s has no usage on schema %s", expected.Name, role.Schema)
		}
		if role.Schema != expected.Schema && allowed {
			return fmt.Errorf("database role check failed: %s can use foreign schema %s", expected.Name, role.Schema)
		}
	}
	return nil
}

// BootstrapDatabaseRoles is deliberately called only by the migration
// process. Production operators may pre-provision roles and set the switch to
// false; local/dev migration runs create or rotate the configured logins.
func BootstrapDatabaseRoles(ctx context.Context, db *gorm.DB) error {
	if !EnvBool("DB_ROLE_BOOTSTRAP", false) {
		return nil
	}
	for _, role := range DatabaseRoles {
		password := Env(role.PasswordEnv, Env("POSTGRES_PASSWORD", ""))
		if password == "" {
			return fmt.Errorf("%s is required when DB_ROLE_BOOTSTRAP=true", role.PasswordEnv)
		}
		if err := ensureDatabaseRole(ctx, db, role.Name, password); err != nil {
			return err
		}
	}
	return nil
}

func ensureDatabaseRole(ctx context.Context, db *gorm.DB, role string, password string) error {
	var exists bool
	if err := db.WithContext(ctx).Raw(`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ?)`, role).Scan(&exists).Error; err != nil {
		return err
	}
	quotedRole := quoteSQLIdentifier(role)
	quotedPassword := quoteSQLLiteral(password)
	if !exists {
		return db.WithContext(ctx).Exec(`CREATE ROLE ` + quotedRole + ` LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ` + quotedPassword).Error
	}
	return db.WithContext(ctx).Exec(`ALTER ROLE ` + quotedRole + ` LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ` + quotedPassword).Error
}

func quoteSQLIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func quoteSQLLiteral(value string) string {
	return `'` + strings.ReplaceAll(value, `'`, `''`) + `'`
}
