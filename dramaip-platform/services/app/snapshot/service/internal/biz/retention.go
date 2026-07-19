package biz

import (
	"context"
	"log"
	"time"
)

const snapshotRetentionSweepInterval = time.Hour

// ProjectSnapshotRetention owns physical ciphertext expiry. It operates only
// on opaque blobs and metadata; no user request or recovery key is involved.
type ProjectSnapshotRetention struct{ snapshots *ProjectSnapshotUsecase }

func NewProjectSnapshotRetention(snapshots *ProjectSnapshotUsecase) *ProjectSnapshotRetention {
	return &ProjectSnapshotRetention{snapshots: snapshots}
}

func (r *ProjectSnapshotRetention) Start() {
	go func() {
		r.purgeOnce()
		ticker := time.NewTicker(snapshotRetentionSweepInterval)
		defer ticker.Stop()
		for range ticker.C {
			r.purgeOnce()
		}
	}()
}

func (r *ProjectSnapshotRetention) purgeOnce() {
	if _, err := r.snapshots.PurgeExpired(context.Background()); err != nil {
		// Do not attach request data or encrypted envelopes to this log.
		log.Printf("snapshot retention sweep failed: %v", err)
	}
}
