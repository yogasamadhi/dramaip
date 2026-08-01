package com.dramaip.platform.creation.controller;

import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.creation.service.ReviewPackageService;
import jakarta.validation.Valid;
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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/review-packages")
public class ReviewPackageController {
    private final ReviewPackageService reviews;
    public ReviewPackageController(ReviewPackageService reviews) { this.reviews = reviews; }

    @PostMapping
    public ResponseEntity<Result<ReviewPackageService.Created>> create(Authentication authentication, @Valid @RequestBody CreateRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Result.ok(reviews.create(CurrentUser.id(authentication), request.toService())));
    }

    @PostMapping("/{packageId}/media/{mediaId}/upload-target")
    public Result<ReviewPackageService.UploadTarget> refreshUploadTarget(Authentication authentication, @PathVariable String packageId, @PathVariable String mediaId) {
        return Result.ok(reviews.refreshUploadTarget(CurrentUser.id(authentication), packageId, mediaId));
    }

    @PostMapping("/{packageId}/complete")
    public Result<ReviewPackageService.PackageView> complete(Authentication authentication, @PathVariable String packageId) {
        return Result.ok(reviews.complete(CurrentUser.id(authentication), packageId));
    }

    @GetMapping("/{packageId}/sync")
    public Result<ReviewPackageService.Sync> sync(Authentication authentication, @PathVariable String packageId, @RequestParam(defaultValue = "0") long afterCursor) {
        return Result.ok(reviews.sync(CurrentUser.id(authentication), packageId, afterCursor));
    }

    @DeleteMapping("/{packageId}")
    public Result<ReviewPackageService.Deleted> delete(Authentication authentication, @PathVariable String packageId) {
        return Result.ok(reviews.delete(CurrentUser.id(authentication), packageId));
    }

    @GetMapping("/public/{token}")
    public Result<ReviewPackageService.PackageView> publicPackage(@PathVariable String token, @RequestParam(required = false) String pin) {
        return Result.ok(reviews.publicPackage(token, pin));
    }

    @PostMapping("/public/{token}/comments")
    public Result<ReviewPackageService.Comment> submitComment(@PathVariable String token, @Valid @RequestBody PublicCommentRequest request) {
        return Result.ok(reviews.submitComment(token, request.toService()));
    }

    @PostMapping("/public/{token}/decisions")
    public Result<ReviewPackageService.Decision> submitDecision(@PathVariable String token, @Valid @RequestBody PublicDecisionRequest request) {
        return Result.ok(reviews.submitDecision(token, request.toService()));
    }

    public record CreateRequest(@NotBlank String workspaceId, @NotBlank String desktopPackageId, @NotBlank String title, @NotBlank String manifestJson, String pin, @NotNull List<ReviewPackageService.MediaDeclaration> media) {
        ReviewPackageService.CreateRequest toService() { return new ReviewPackageService.CreateRequest(workspaceId, desktopPackageId, title, manifestJson, pin, media); }
    }
    public record PublicCommentRequest(String pin, @NotBlank String clientId, String shotId, double timecodeSeconds, String authorAlias, @NotBlank String body) {
        ReviewPackageService.PublicCommentRequest toService() { return new ReviewPackageService.PublicCommentRequest(pin, clientId, shotId, timecodeSeconds, authorAlias, body); }
    }
    public record PublicDecisionRequest(String pin, @NotBlank String clientId, String shotId, @NotBlank String decision, String authorAlias, String note) {
        ReviewPackageService.PublicDecisionRequest toService() { return new ReviewPackageService.PublicDecisionRequest(pin, clientId, shotId, decision, authorAlias, note); }
    }
}
