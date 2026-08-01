package data

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestIsUniqueViolationUsesPostgresErrorCode(t *testing.T) {
	if !IsUniqueViolation(&pgconn.PgError{Code: "23505"}) {
		t.Fatal("23505 must be recognized as a unique constraint violation")
	}
	if IsUniqueViolation(&pgconn.PgError{Code: "23503"}) {
		t.Fatal("foreign-key failures must not be treated as unique violations")
	}
	if IsUniqueViolation(errors.New("duplicate key value violates unique constraint")) {
		t.Fatal("plain error strings must not be treated as authoritative Postgres errors")
	}
}
