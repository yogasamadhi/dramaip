package platform

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestScanMigrationFilesSorted(t *testing.T) {
	dir := t.TempDir()
	writeMigration(t, dir, "010_later.up.sql")
	writeMigration(t, dir, "002_earlier.up.sql")
	writeMigration(t, dir, "ignored.down.sql")

	files, err := scanMigrationFiles(dir)
	if err != nil {
		t.Fatalf("scanMigrationFiles() error = %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("scanMigrationFiles() len = %d", len(files))
	}
	if files[0].Version != 2 || files[1].Version != 10 {
		t.Fatalf("versions = %d, %d", files[0].Version, files[1].Version)
	}
}

func TestScanMigrationFilesNestedDomains(t *testing.T) {
	dir := t.TempDir()
	writeMigration(t, filepath.Join(dir, "billing"), "003_billing_init.up.sql")
	writeMigration(t, filepath.Join(dir, "auth"), "001_auth_init.up.sql")
	writeMigration(t, filepath.Join(dir, "quota"), "004_quota_init.up.sql")
	writeMigration(t, filepath.Join(dir, "user"), "002_user_init.up.sql")

	files, err := scanMigrationFiles(dir)
	if err != nil {
		t.Fatalf("scanMigrationFiles() error = %v", err)
	}
	if len(files) != 4 {
		t.Fatalf("scanMigrationFiles() len = %d", len(files))
	}
	for i, file := range files {
		want := uint(i + 1)
		if file.Version != want {
			t.Fatalf("files[%d].Version = %d, want %d", i, file.Version, want)
		}
	}
}

func TestScanMigrationFilesDuplicateVersion(t *testing.T) {
	dir := t.TempDir()
	writeMigration(t, dir, "001_first.up.sql")
	writeMigration(t, dir, "001_second.up.sql")

	_, err := scanMigrationFiles(dir)
	if err == nil || !strings.Contains(err.Error(), "duplicate migration version") {
		t.Fatalf("scanMigrationFiles() error = %v", err)
	}
}

func TestScanMigrationFilesInvalidName(t *testing.T) {
	dir := t.TempDir()
	writeMigration(t, dir, "bad.up.sql")

	_, err := scanMigrationFiles(dir)
	if err == nil || !strings.Contains(err.Error(), "invalid migration filename") {
		t.Fatalf("scanMigrationFiles() error = %v", err)
	}
}

func TestScanMigrationFilesEmptyAndMissing(t *testing.T) {
	files, err := scanMigrationFiles(t.TempDir())
	if err != nil {
		t.Fatalf("scanMigrationFiles(empty) error = %v", err)
	}
	if len(files) != 0 {
		t.Fatalf("scanMigrationFiles(empty) len = %d", len(files))
	}

	files, err = scanMigrationFiles(filepath.Join(t.TempDir(), "missing"))
	if err != nil {
		t.Fatalf("scanMigrationFiles(missing) error = %v", err)
	}
	if len(files) != 0 {
		t.Fatalf("scanMigrationFiles(missing) len = %d", len(files))
	}
}

func TestMigrationSourceURL(t *testing.T) {
	got, err := migrationSourceURL(t.TempDir())
	if err != nil {
		t.Fatalf("migrationSourceURL() error = %v", err)
	}
	if !strings.HasPrefix(got, "file://") {
		t.Fatalf("migrationSourceURL() = %q", got)
	}
}

func TestRepositoryMigrationsHaveUniqueVersions(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "migrations"))
	if _, err := scanMigrationFiles(root); err != nil {
		t.Fatalf("repository migrations are invalid: %v", err)
	}
}

func TestRunMigrationsIntegration(t *testing.T) {
	dsn := os.Getenv("POSTGRES_TEST_DSN")
	if dsn == "" {
		t.Skip("POSTGRES_TEST_DSN not set")
	}
	t.Setenv("POSTGRES_DSN", dsn)
	t.Setenv("DB_ROLE_BOOTSTRAP", "false")
	dir := t.TempDir()
	writeMigration(t, dir, "100001_platform_test.up.sql")

	db, err := OpenPostgres()
	if err != nil {
		t.Fatalf("OpenPostgres() error = %v", err)
	}
	if err := RunMigrations(db, dir); err != nil {
		t.Fatalf("RunMigrations() error = %v", err)
	}
	if err := RunMigrations(db, dir); err != nil {
		t.Fatalf("RunMigrations() no-change error = %v", err)
	}
}

func writeMigration(t *testing.T, dir string, name string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("mkdir migration dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte("SELECT 1;"), 0o600); err != nil {
		t.Fatalf("write migration: %v", err)
	}
}
