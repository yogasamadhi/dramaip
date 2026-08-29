package com.dramaip.platform.ai.controller;

import com.dramaip.platform.ai.client.AdminConfirmationClient;
import com.dramaip.platform.ai.service.CreativeIntelligenceService;
import com.dramaip.platform.common.security.AdminAccess;
import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.common.web.Result;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class CreativeIntelligenceController {
    private final CreativeIntelligenceService creative;
    private final AdminConfirmationClient confirmations;

    public CreativeIntelligenceController(CreativeIntelligenceService creative, AdminConfirmationClient confirmations) {
        this.creative = creative;
        this.confirmations = confirmations;
    }

    @GetMapping("/creative-corpus/search")
    public Result<CreativeIntelligenceService.Page<CreativeIntelligenceService.CorpusItem>> search(
            Authentication authentication, @RequestParam(defaultValue = "") String query,
            @RequestParam(defaultValue = "public") String visibility,
            @RequestParam(defaultValue = "") String cursor,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit) {
        return Result.ok(creative.search(CurrentUser.id(authentication), query, visibility, cursor, limit));
    }

    @PostMapping("/creative-corpus/items")
    public Result<CreativeIntelligenceService.CorpusItem> createPrivateItem(Authentication authentication,
            @Valid @RequestBody PrivateItemCreate request) {
        return Result.ok(creative.createPrivateItem(CurrentUser.id(authentication), new CreativeIntelligenceService.ItemCreate(
                request.kind(), request.title(), request.trigger(), request.mechanism(), request.emotionalEffect(),
                request.contexts(), request.riskTags(), request.tags(), request.freshness(), request.locale())));
    }

    @GetMapping("/creative-collections")
    public Result<List<CreativeIntelligenceService.CollectionItem>> collections(Authentication authentication) {
        return Result.ok(creative.collections(CurrentUser.id(authentication)));
    }

    @PostMapping("/creative-collections")
    public Result<CreativeIntelligenceService.CollectionItem> collect(Authentication authentication,
            @Valid @RequestBody CollectionCreate request) {
        return Result.ok(creative.collect(CurrentUser.id(authentication), new CreativeIntelligenceService.CollectionCreate(
                request.corpusItemId(), request.title(), request.mechanism(), request.notes(), request.tags())));
    }

    @PostMapping("/creative-collections/import-url")
    public Result<CreativeIntelligenceService.Source> importUrl(Authentication authentication,
            @Valid @RequestBody UrlRequest request) {
        return Result.ok(creative.submitSource(CurrentUser.id(authentication), request.url()));
    }

    @GetMapping("/creative-fingerprint")
    public Result<CreativeIntelligenceService.Fingerprint> fingerprint(Authentication authentication) {
        return Result.ok(creative.fingerprint(CurrentUser.id(authentication)));
    }

    @PutMapping("/creative-fingerprint/settings")
    public Result<CreativeIntelligenceService.Fingerprint> fingerprintSettings(Authentication authentication,
            @Valid @RequestBody FingerprintSettings request) {
        return Result.ok(creative.setFingerprintEnabled(CurrentUser.id(authentication), request.enabled()));
    }

    @PatchMapping("/creative-fingerprint")
    public Result<CreativeIntelligenceService.Fingerprint> updateFingerprint(Authentication authentication,
            @Valid @RequestBody FingerprintPatch request) {
        return Result.ok(creative.updateFingerprint(CurrentUser.id(authentication), request.version(),
                request.dimensions().stream().map(value -> new CreativeIntelligenceService.DimensionPatch(
                        value.key(), value.score(), value.frozen())).toList(), request.avoidances(), request.goals()));
    }

    @DeleteMapping("/creative-fingerprint")
    public Result<Map<String, Boolean>> clearFingerprint(Authentication authentication) {
        creative.clearFingerprint(CurrentUser.id(authentication));
        return Result.ok(Map.of("cleared", true));
    }

    @GetMapping("/inspiration-experiments")
    public Result<CreativeIntelligenceService.Page<CreativeIntelligenceService.Experiment>> experiments(
            Authentication authentication, @RequestParam(defaultValue = "") String cursor,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit) {
        return Result.ok(creative.experiments(CurrentUser.id(authentication), cursor, limit));
    }

    @PostMapping("/inspiration-experiments")
    public Result<CreativeIntelligenceService.Experiment> createExperiment(Authentication authentication,
            @RequestHeader("Idempotency-Key") String key, @Valid @RequestBody ExperimentCreate request) {
        return Result.ok(creative.createExperiment(CurrentUser.id(authentication), key,
                new CreativeIntelligenceService.ExperimentCreate(request.originType(), request.originId(),
                        request.prompt(), request.model(), request.maxTokens())));
    }

    @PostMapping("/inspiration-experiments/{id}/review")
    public Result<CreativeIntelligenceService.Experiment> reviewExperiment(Authentication authentication,
            @PathVariable String id, @Valid @RequestBody ExperimentReview request) {
        return Result.ok(creative.reviewExperiment(CurrentUser.id(authentication), id, request.version(),
                request.selectedVariantId(), request.rejected()));
    }

    @GetMapping("/creative-corpus/snapshots/latest")
    public Result<Map<String, Object>> snapshot() {
        return Result.ok(creative.snapshot());
    }

    @GetMapping("/admin/creative-corpus/sources")
    public Result<List<CreativeIntelligenceService.Source>> adminSources(Authentication authentication,
            @RequestParam(defaultValue = "100") int limit) {
        AdminAccess.require(authentication, "corpus.read");
        return Result.ok(creative.adminSources(limit));
    }

    @GetMapping("/admin/creative-corpus/jobs")
    public Result<List<CreativeIntelligenceService.IngestionJob>> adminJobs(Authentication authentication,
            @RequestParam(defaultValue = "100") int limit) {
        AdminAccess.require(authentication, "corpus.read");
        return Result.ok(creative.adminJobs(limit));
    }

    @PostMapping("/admin/creative-corpus/sources")
    public Result<CreativeIntelligenceService.Source> adminSubmit(Authentication authentication,
            @Valid @RequestBody UrlRequest request) {
        AdminAccess.require(authentication, "corpus.write");
        return Result.ok(creative.adminSubmit(request.url()));
    }

    @PostMapping("/admin/creative-corpus/sources/{id}/actions")
    public Result<CreativeIntelligenceService.Source> govern(Authentication authentication, @PathVariable String id,
            @Valid @RequestBody SourceAction request) {
        String permission = request.action().equals("block") || request.action().equals("takedown")
                ? "corpus.takedown" : "corpus.write";
        AdminAccess.require(authentication, permission);
        String reason = request.reason();
        if (request.action().equals("block") || request.action().equals("takedown")) {
            if (request.confirmationId() == null || request.confirmationId().isBlank()) {
                throw new BusinessException("CORPUS_CONFIRMATION_REQUIRED", "confirmation is required",
                        HttpStatus.PRECONDITION_REQUIRED);
            }
            String action = "corpus.source." + request.action();
            var consumed = confirmations.consume(request.confirmationId(),
                    new AdminConfirmationClient.ConsumeRequest(action, id)).data();
            reason = consumed.reason();
        }
        return Result.ok(creative.governSource(id, request.version(), request.action(), reason));
    }

    public record PrivateItemCreate(@NotBlank String kind, @NotBlank String title, String trigger,
            @NotBlank String mechanism, String emotionalEffect, List<String> contexts, List<String> riskTags,
            List<String> tags, @NotBlank String freshness, String locale) {
        public PrivateItemCreate { contexts = copy(contexts); riskTags = copy(riskTags); tags = copy(tags); }
    }
    public record CollectionCreate(String corpusItemId, @NotBlank String title, @NotBlank String mechanism,
            String notes, List<String> tags) { public CollectionCreate { tags = copy(tags); } }
    public record UrlRequest(@NotBlank String url) { }
    public record FingerprintSettings(boolean enabled) { }
    public record DimensionPatch(@NotBlank String key, Double score, Boolean frozen) { }
    public record FingerprintPatch(@Positive int version, List<@Valid DimensionPatch> dimensions,
            List<String> avoidances, List<String> goals) {
        public FingerprintPatch { dimensions = copy(dimensions); }
    }
    public record ExperimentCreate(@NotBlank String originType, String originId, @NotBlank String prompt,
            @NotBlank String model, @Positive @Max(32_000) int maxTokens) { }
    public record ExperimentReview(@Positive int version, String selectedVariantId, boolean rejected) { }
    public record SourceAction(@Positive int version, @NotBlank String action, String reason, String confirmationId) { }
    private static <T> List<T> copy(List<T> values) { return values == null ? List.of() : List.copyOf(values); }
}
