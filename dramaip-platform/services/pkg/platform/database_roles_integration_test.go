package platform

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// TestDatabaseRoleMatrixIntegration exercises the actual PostgreSQL deny path.
// Set POSTGRES_ROLE_TEST_DSN to a disposable database owned by a role with
// CREATEROLE. The test creates/rotates the six shared runtime logins, so it is
// intentionally not run against a shared developer or production database.
func TestDatabaseRoleMatrixIntegration(t *testing.T) {
	dsn := os.Getenv("POSTGRES_ROLE_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_ROLE_TEST_DSN is not set")
	}
	t.Setenv("POSTGRES_DSN", dsn)
	t.Setenv("DB_ROLE_BOOTSTRAP", "true")
	for _, role := range DatabaseRoles {
		t.Setenv(role.PasswordEnv, "dramaip-role-matrix-test")
	}

	ddlDB, err := OpenPostgres()
	if err != nil {
		t.Fatalf("open DDL database: %v", err)
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	migrations := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "migrations"))
	if err := RunMigrations(ddlDB, migrations); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	for _, role := range DatabaseRoles {
		domainDB, err := OpenDomainPostgres(context.Background(), role.Schema)
		if err != nil {
			t.Fatalf("open %s role: %v", role.Schema, err)
		}
		foreignSchema := firstForeignSchema(role.Schema)
		var foreignTable string
		if err := ddlDB.Raw(`
			SELECT quote_ident(table_schema) || '.' || quote_ident(table_name)
			FROM information_schema.tables
			WHERE table_schema = ? AND table_type = 'BASE TABLE'
			ORDER BY table_name
			LIMIT 1
		`, foreignSchema).Scan(&foreignTable).Error; err != nil {
			t.Fatalf("find table in foreign schema %s: %v", foreignSchema, err)
		}
		if foreignTable == "" {
			t.Fatalf("no table found in foreign schema %s", foreignSchema)
		}
		if err := domainDB.Exec("SELECT 1 FROM " + foreignTable + " LIMIT 1").Error; err == nil {
			t.Fatalf("%s unexpectedly read foreign table %s", role.Name, foreignTable)
		}
	}
}

func firstForeignSchema(ownSchema string) string {
	for _, role := range DatabaseRoles {
		if role.Schema != ownSchema {
			return role.Schema
		}
	}
	panic(fmt.Sprintf("no foreign schema for %q", ownSchema))
}
