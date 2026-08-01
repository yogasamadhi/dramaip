package com.dramaip.platform.creation.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ReviewRetentionJob {
    private final ReviewPackageService reviews;
    public ReviewRetentionJob(ReviewPackageService reviews) { this.reviews = reviews; }
    @Scheduled(fixedDelayString = "${dramaip.creation.review-retention-ms:3600000}")
    public void purgeExpired() { reviews.purgeExpired(); }
}
