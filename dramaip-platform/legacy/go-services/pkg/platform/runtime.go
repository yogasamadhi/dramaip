package platform

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func Env(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func EnvInt(key string, fallback int) int {
	value, err := strconv.Atoi(Env(key, ""))
	if err != nil {
		return fallback
	}
	return value
}

func EnvBool(key string, fallback bool) bool {
	value, err := strconv.ParseBool(Env(key, ""))
	if err != nil {
		return fallback
	}
	return value
}

func EnvDurationSeconds(key string, fallbackSeconds int) time.Duration {
	return time.Duration(EnvInt(key, fallbackSeconds)) * time.Second
}

func PostgresDSN() string {
	if dsn := os.Getenv("POSTGRES_DSN"); dsn != "" {
		return dsn
	}
	return fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=%s TimeZone=%s",
		Env("POSTGRES_HOST", "localhost"),
		Env("POSTGRES_USER", "dramaip"),
		Env("POSTGRES_PASSWORD", "dramaip"),
		Env("POSTGRES_DB", "dramaip"),
		Env("POSTGRES_PORT", "5432"),
		Env("POSTGRES_SSLMODE", "disable"),
		Env("TIMEZONE", "Asia/Shanghai"),
	)
}

func OpenPostgres() (*gorm.DB, error) {
	return gorm.Open(postgres.Open(PostgresDSN()), &gorm.Config{})
}

func CheckPostgres(ctx context.Context, db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		SetGauge("dramaip_dependency_up", 0, map[string]string{"dependency": "postgres"})
		return err
	}
	err = sqlDB.PingContext(ctx)
	ObserveDBStats(sqlDB.Stats())
	up := 1.0
	if err != nil {
		up = 0
	}
	SetGauge("dramaip_dependency_up", up, map[string]string{"dependency": "postgres"})
	return err
}

func NewUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	)
}

func HealthServer(addr string, service string, checks map[string]func(context.Context) error) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		ok := true
		for _, check := range checks {
			if err := check(ctx); err != nil {
				ok = false
				break
			}
		}
		status := http.StatusOK
		if !ok {
			status = http.StatusServiceUnavailable
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = fmt.Fprintf(w, `{"ok":%t,"service":%q,"version":"0.3.0"}`+"\n", ok, service)
	})
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		WritePrometheus(w, service)
	})
	return &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
}
