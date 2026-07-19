package platform

import (
	"crypto/sha256"
	"encoding/base64"
	"strconv"
)

// CloudAIHashMessage is the exact, ordered message shape covered by a Cloud
// AI preflight binding. It deliberately excludes request IDs and any transport
// metadata so retries of the same generation have the same authorization.
type CloudAIHashMessage struct {
	Role    string
	Content string
}

// CloudAIRequestHash returns the SHA-256 base64url binding for the final
// provider, model, messages and completion cap. Web BFF and AI Gateway share
// this implementation so a preflight cannot authorize a different payload.
func CloudAIRequestHash(provider, model string, maxTokens int64, messages []CloudAIHashMessage) (string, error) {
	hash := sha256.New()
	for _, part := range []string{provider, model, strconv.FormatInt(maxTokens, 10)} {
		if _, err := hash.Write([]byte(part)); err != nil {
			return "", err
		}
		if _, err := hash.Write([]byte{0}); err != nil {
			return "", err
		}
	}
	for _, message := range messages {
		for _, part := range []string{message.Role, message.Content} {
			if _, err := hash.Write([]byte(part)); err != nil {
				return "", err
			}
			if _, err := hash.Write([]byte{0}); err != nil {
				return "", err
			}
		}
	}
	return base64.RawURLEncoding.EncodeToString(hash.Sum(nil)), nil
}

// ValidCloudAIRequestHash checks the base64url SHA-256 wire representation
// before a BFF sends it to the AI Gateway.
func ValidCloudAIRequestHash(value string) bool {
	if len(value) != 43 {
		return false
	}
	for _, char := range value {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_') {
			return false
		}
	}
	return true
}
