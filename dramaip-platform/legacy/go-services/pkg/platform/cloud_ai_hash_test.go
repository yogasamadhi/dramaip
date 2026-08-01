package platform

import "testing"

func TestCloudAIRequestHashHasStableCrossRuntimeWireFormat(t *testing.T) {
	hash, err := CloudAIRequestHash("test", "test-dramaip-chat", 32, []CloudAIHashMessage{
		{Role: "system", Content: "short instruction"},
		{Role: "user", Content: "write one line"},
	})
	if err != nil {
		t.Fatalf("CloudAIRequestHash: %v", err)
	}
	if hash != "1t8IT5Nm0U1hmv99OBhz4jNMkOT1MbflE_xD6URWdO8" {
		t.Fatalf("request hash = %q", hash)
	}
	if !ValidCloudAIRequestHash(hash) || ValidCloudAIRequestHash("not-a-hash") {
		t.Fatal("hash validation did not retain the SHA-256 base64url boundary")
	}
}
