package com.dramaip.platform.creation.controller;

import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.creation.service.ProjectSnapshotService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class ProjectSnapshotController {
    private final ProjectSnapshotService snapshots;
    public ProjectSnapshotController(ProjectSnapshotService snapshots) { this.snapshots = snapshots; }

    @GetMapping("/project-snapshots")
    public Result<List<ProjectSnapshotService.Snapshot>> list(Authentication authentication) {
        return Result.ok(snapshots.list(CurrentUser.id(authentication)));
    }

    @PostMapping("/project-snapshots")
    public ResponseEntity<Result<ProjectSnapshotService.Snapshot>> create(Authentication authentication, @Valid @RequestBody CreateSnapshotRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Result.ok(snapshots.create(CurrentUser.id(authentication), request.idempotencyKey(), request.encryptedEnvelope())));
    }

    @GetMapping("/project-snapshots/{snapshotId}")
    public Result<ProjectSnapshotService.DownloadedSnapshot> get(Authentication authentication, @PathVariable String snapshotId) {
        return Result.ok(snapshots.get(CurrentUser.id(authentication), snapshotId));
    }

    @DeleteMapping("/project-snapshots/{snapshotId}")
    public Result<ProjectSnapshotService.DeletedSnapshot> delete(Authentication authentication, @PathVariable String snapshotId) {
        return Result.ok(snapshots.delete(CurrentUser.id(authentication), snapshotId));
    }

    @PostMapping("/upload-sessions")
    public ResponseEntity<Result<ProjectSnapshotService.UploadStart>> startUpload(Authentication authentication, @Valid @RequestBody StartUploadRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Result.ok(snapshots.startUpload(CurrentUser.id(authentication), request.idempotencyKey(), request.encryptedBytes(), request.encryptedSha256())));
    }

    @PutMapping("/upload-sessions/{uploadId}/chunks/{chunkIndex}")
    public Result<ProjectSnapshotService.Upload> uploadChunk(Authentication authentication, @PathVariable String uploadId, @PathVariable int chunkIndex, @Valid @RequestBody UploadChunkRequest request) {
        return Result.ok(snapshots.uploadChunk(CurrentUser.id(authentication), uploadId, chunkIndex, request.encryptedChunkSha256(), request.encryptedChunk()));
    }

    @PostMapping("/upload-sessions/{uploadId}/complete")
    public Result<ProjectSnapshotService.Snapshot> completeUpload(Authentication authentication, @PathVariable String uploadId) {
        return Result.ok(snapshots.completeUpload(CurrentUser.id(authentication), uploadId));
    }

    public record CreateSnapshotRequest(@NotBlank String idempotencyKey, @NotNull byte[] encryptedEnvelope) { }
    public record StartUploadRequest(@NotBlank String idempotencyKey, @Min(1) @Max(67108864) long encryptedBytes, @NotBlank String encryptedSha256) { }
    public record UploadChunkRequest(@NotBlank String encryptedChunkSha256, @NotNull byte[] encryptedChunk) { }
}
