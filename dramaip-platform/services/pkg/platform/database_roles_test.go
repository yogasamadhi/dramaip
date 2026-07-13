package platform

import (
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDatabaseRoleForSchema(t *testing.T) {
	role, err := DatabaseRoleForSchema("billing")
	if err != nil {
		t.Fatalf("DatabaseRoleForSchema() error = %v", err)
	}
	if role.Name != "dramaip_billing" || role.PasswordEnv != "POSTGRES_BILLING_PASSWORD" {
		t.Fatalf("DatabaseRoleForSchema() = %#v", role)
	}
	if _, err := DatabaseRoleForSchema("unknown"); err == nil {
		t.Fatal("DatabaseRoleForSchema() accepted an unknown schema")
	}
}

func TestPostgresDSNForRoleUsesRuntimeCredentials(t *testing.T) {
	t.Setenv("POSTGRES_DSN", "postgres://ddl:secret@example.test:5432/dramaip?sslmode=require")
	dsn, err := postgresDSNForRole("dramaip_billing", "runtime-password")
	if err != nil {
		t.Fatalf("postgresDSNForRole() error = %v", err)
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("url.Parse(%q) error = %v", dsn, err)
	}
	if got := parsed.User.Username(); got != "dramaip_billing" {
		t.Fatalf("runtime user = %q", got)
	}
	password, ok := parsed.User.Password()
	if !ok || password != "runtime-password" {
		t.Fatalf("runtime password = %q, set=%t", password, ok)
	}
	if got := parsed.Query().Get("sslmode"); got != "require" {
		t.Fatalf("sslmode = %q", got)
	}
}

func TestPostgresDSNForRoleRejectsKeywordDSN(t *testing.T) {
	t.Setenv("POSTGRES_DSN", "host=localhost user=ddl")
	if _, err := postgresDSNForRole("dramaip_auth", "password"); err == nil {
		t.Fatal("postgresDSNForRole() accepted a keyword DSN")
	}
}

func TestDatabaseRoleMigrationHasCompleteRoleMatrix(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "migrations", "platform", "018_database_role_isolation.up.sql"))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read role migration: %v", err)
	}
	sql := string(raw)
	for _, role := range DatabaseRoles {
		for _, statement := range []string{
			"GRANT USAGE ON SCHEMA " + role.Schema + " TO " + role.Name,
			"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA " + role.Schema + " TO " + role.Name,
			"ALTER DEFAULT PRIVILEGES IN SCHEMA " + role.Schema + " GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO " + role.Name,
		} {
			if !strings.Contains(sql, statement) {
				t.Fatalf("role migration missing %q", statement)
			}
		}
	}
	if !strings.Contains(sql, "REVOKE ALL ON SCHEMA auth, user_profile, billing, quota, ai_gateway, notification FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification") {
		t.Fatal("role migration does not revoke every domain schema before grants")
	}
}
