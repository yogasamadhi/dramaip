// Package data owns the reporting read-model persistence boundary. It has no
// client for any domain database: all facts arrive as public event envelopes.
package data

import (
	"context"

	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"gorm.io/gorm"
)

type Data struct{ DB *gorm.DB }

func NewData() (*Data, func(), error) {
	db, err := platform.OpenDomainPostgres(context.Background(), "reporting")
	if err != nil {
		return nil, nil, err
	}
	return &Data{DB: db}, func() {}, nil
}
