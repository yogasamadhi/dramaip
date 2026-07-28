package biz

import (
	"context"
	"log"
	"time"
)

type ReviewRetention struct{ review *ReviewUsecase }

func NewReviewRetention(review *ReviewUsecase) *ReviewRetention {
	return &ReviewRetention{review: review}
}

func (retention *ReviewRetention) Start() {
	go func() {
		retention.purgeOnce()
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			retention.purgeOnce()
		}
	}()
}

func (retention *ReviewRetention) purgeOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if _, err := retention.review.PurgeExpired(ctx); err != nil {
		// Review titles, manifests, tokens and object keys are intentionally
		// excluded from retention logs.
		log.Printf("review retention sweep failed: %v", err)
	}
}
