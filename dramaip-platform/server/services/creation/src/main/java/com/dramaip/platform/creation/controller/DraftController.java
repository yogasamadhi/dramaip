package com.dramaip.platform.creation.controller;

import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.creation.service.DraftService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/drafts")
public class DraftController {
    private final DraftService drafts;
    public DraftController(DraftService drafts) { this.drafts = drafts; }
    @GetMapping public Result<List<DraftService.Draft>> list(Authentication authentication) { return Result.ok(drafts.list(CurrentUser.id(authentication))); }
    @PostMapping public ResponseEntity<Result<DraftService.Draft>> upsert(Authentication authentication, @Valid @RequestBody CreateDraftRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Result.ok(drafts.upsert(CurrentUser.id(authentication), new DraftService.CreateDraft(request.clientId(), request.kind(), request.captureMode(), request.title(), request.content()))));
    }
    @DeleteMapping("/{draftId}") public Result<Void> delete(Authentication authentication, @PathVariable String draftId) { drafts.delete(CurrentUser.id(authentication), draftId); return Result.ok(null); }
    public record CreateDraftRequest(@NotBlank String clientId, @NotBlank String kind, @NotBlank String captureMode, @NotBlank String title, @NotBlank String content) { }
}
