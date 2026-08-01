package com.dramaip.platform.creation.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ReviewObjectStoreTest {
    @Test
    void signsPrivateMediaUploadWithRequiredIntegrityHeaders() {
        ReviewObjectStore store = new ReviewObjectStore("https://storage.example.test/base", "us-east-1", "review-bucket", "access", "secret", false);

        ReviewObjectStore.SignedUrl target = store.presignPut("review/workspace/package/media", "video/mp4", "a".repeat(64));

        assertEquals("https", target.url().getScheme());
        assertTrue(target.url().getPath().endsWith("/base/review-bucket/review/workspace/package/media"));
        assertTrue(target.url().getQuery().contains("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
        assertEquals("video/mp4", target.headers().get("content-type"));
        assertEquals("a".repeat(64), target.headers().get("x-amz-meta-sha256"));
    }
}
