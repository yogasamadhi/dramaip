package biz

import (
	"testing"

	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/data"
	"golang.org/x/crypto/bcrypt"
)

func TestRegistrationRetryRequiresTheExistingPassword(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	user := data.UserRow{ID: "user-1", PasswordHash: string(hash)}
	if !registrationRetryAllowed(user, "correct-password") {
		t.Fatal("matching credentials must be accepted as an idempotent registration retry")
	}
	if registrationRetryAllowed(user, "wrong-password") {
		t.Fatal("different credentials must not recover an existing registration")
	}
	if registrationRetryAllowed(data.UserRow{PasswordHash: string(hash)}, "correct-password") {
		t.Fatal("a missing user identity must not be treated as a registration retry")
	}
}
