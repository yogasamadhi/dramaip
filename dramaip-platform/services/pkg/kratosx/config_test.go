package kratosx

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseDotEnvLine(t *testing.T) {
	tests := []struct {
		name  string
		line  string
		key   string
		value string
		ok    bool
	}{
		{name: "plain", line: "POSTGRES_HOST=localhost", key: "POSTGRES_HOST", value: "localhost", ok: true},
		{name: "export", line: "export REDIS_DB=0", key: "REDIS_DB", value: "0", ok: true},
		{name: "quoted", line: `JWT_ACCESS_SECRET="abc#123"`, key: "JWT_ACCESS_SECRET", value: "abc#123", ok: true},
		{name: "comment", line: "AI_PROVIDER_API_KEY=sk-test # local", key: "AI_PROVIDER_API_KEY", value: "sk-test", ok: true},
		{name: "blank", line: "  ", ok: false},
		{name: "invalid", line: "1BAD=value", ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key, value, ok, err := parseDotEnvLine(tt.line)
			if err != nil {
				t.Fatalf("parseDotEnvLine() error = %v", err)
			}
			if ok != tt.ok || key != tt.key || value != tt.value {
				t.Fatalf("parseDotEnvLine() = (%q, %q, %t), want (%q, %q, %t)", key, value, ok, tt.key, tt.value, tt.ok)
			}
		})
	}
}

func TestLoadDotEnvFileDoesNotOverrideExistingEnvironment(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("DRAMAIP_TEST_ENV=from-file\nDRAMAIP_KEEP_ENV=from-file\n"), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	t.Setenv("DRAMAIP_KEEP_ENV", "from-shell")
	t.Setenv("DRAMAIP_TEST_ENV", "")
	_ = os.Unsetenv("DRAMAIP_TEST_ENV")

	if err := loadDotEnvFile(path); err != nil {
		t.Fatalf("loadDotEnvFile() error = %v", err)
	}
	if got := os.Getenv("DRAMAIP_TEST_ENV"); got != "from-file" {
		t.Fatalf("DRAMAIP_TEST_ENV = %q", got)
	}
	if got := os.Getenv("DRAMAIP_KEEP_ENV"); got != "from-shell" {
		t.Fatalf("DRAMAIP_KEEP_ENV = %q", got)
	}
}
