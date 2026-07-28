package data

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

// PlanEntitlements is the strongly typed, non-token product contract captured
// on every order and subscription. Media generation remains BYOK and is not
// represented as an included quota.
type PlanEntitlements struct {
	IncludedSeats         int32 `json:"included_seats"`
	BYOKEnabled           bool  `json:"byok_enabled"`
	OfflineReviewEnabled  bool  `json:"offline_review_enabled"`
	AdvancedExportEnabled bool  `json:"advanced_export_enabled"`
	CloudReviewEnabled    bool  `json:"cloud_review_enabled"`
	ReviewStorageBytes    int64 `json:"review_storage_bytes"`
	ReviewRetentionDays   int32 `json:"review_retention_days"`
	PrivateGatewayEnabled bool  `json:"private_gateway_enabled"`
}

func (entitlements *PlanEntitlements) Scan(value any) error {
	if entitlements == nil {
		return fmt.Errorf("scan plan entitlements into nil receiver")
	}
	var raw []byte
	switch typed := value.(type) {
	case nil:
		raw = []byte(`{}`)
	case []byte:
		raw = typed
	case string:
		raw = []byte(typed)
	default:
		return fmt.Errorf("scan plan entitlements from %T", value)
	}
	if len(raw) == 0 {
		raw = []byte(`{}`)
	}
	return json.Unmarshal(raw, entitlements)
}

func (entitlements PlanEntitlements) Value() (driver.Value, error) {
	return json.Marshal(entitlements)
}

func (entitlements PlanEntitlements) JSON() string {
	raw, err := json.Marshal(entitlements)
	if err != nil {
		return "{}"
	}
	return string(raw)
}
