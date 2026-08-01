package com.dramaip.platform.creation.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Clears expired ciphertext and expired resumable-upload chunks even for inactive users. */
@Component
public class SnapshotRetentionJob {
    private final ProjectSnapshotService snapshots;
    public SnapshotRetentionJob(ProjectSnapshotService snapshots) { this.snapshots = snapshots; }
    @Scheduled(fixedDelayString = "${dramaip.creation.snapshot-retention-ms:3600000}")
    public void purgeExpired() { snapshots.purgeExpired(); }
}
