package com.dramaip.platform.ai.controller;

import com.dramaip.platform.ai.service.InspirationService;
import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Positive;
import java.util.List;
import java.util.Map;
import org.springframework.http.MediaType;
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
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/v1")
public class InspirationController {
    private final InspirationService inspiration;

    public InspirationController(InspirationService inspiration) {
        this.inspiration = inspiration;
    }

    @GetMapping("/inspiration-conversations")
    public Result<InspirationService.Page<InspirationService.Conversation>> conversations(
            Authentication authentication,
            @RequestParam(defaultValue = "false") boolean archived,
            @RequestParam(defaultValue = "") String cursor,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit) {
        return Result.ok(inspiration.conversations(CurrentUser.id(authentication), archived, cursor, limit));
    }

    @PostMapping("/inspiration-conversations")
    public Result<InspirationService.Conversation> createConversation(Authentication authentication,
            @Valid @RequestBody ConversationCreate request) {
        return Result.ok(inspiration.createConversation(CurrentUser.id(authentication), request.creativeMode(), request.title()));
    }

    @PostMapping("/inspiration-conversations/import")
    public Result<InspirationService.Conversation> importHistory(Authentication authentication,
            @Valid @RequestBody HistoryImport request) {
        return Result.ok(inspiration.importHistory(CurrentUser.id(authentication), request.title(),
                request.messages().stream().map(item -> new InspirationService.ImportedMessage(item.role(), item.content())).toList()));
    }

    @GetMapping("/inspiration-conversations/{id}")
    public Result<InspirationService.Conversation> conversation(Authentication authentication, @PathVariable String id) {
        return Result.ok(inspiration.conversation(CurrentUser.id(authentication), id));
    }

    @PatchMapping("/inspiration-conversations/{id}")
    public Result<InspirationService.Conversation> updateConversation(Authentication authentication, @PathVariable String id,
            @RequestBody ConversationPatch request) {
        return Result.ok(inspiration.updateConversation(CurrentUser.id(authentication), id, request.title(),
                request.creativeMode(), request.archived()));
    }

    @PostMapping("/inspiration-conversations/{id}/fork")
    public Result<InspirationService.Conversation> fork(Authentication authentication, @PathVariable String id) {
        return Result.ok(inspiration.fork(CurrentUser.id(authentication), id));
    }

    @DeleteMapping("/inspiration-conversations/{id}")
    public Result<Map<String, Boolean>> deleteConversation(Authentication authentication, @PathVariable String id) {
        inspiration.deleteConversation(CurrentUser.id(authentication), id);
        return Result.ok(Map.of("deleted", true));
    }

    @GetMapping("/inspiration-conversations/{id}/messages")
    public Result<InspirationService.Page<InspirationService.Message>> messages(Authentication authentication,
            @PathVariable String id, @RequestParam(defaultValue = "") String cursor,
            @RequestParam(defaultValue = "100") @Min(1) @Max(200) int limit) {
        return Result.ok(inspiration.messages(CurrentUser.id(authentication), id, cursor, limit));
    }

    @PostMapping("/inspiration-conversations/{id}/messages")
    public Result<InspirationService.MessageStart> sendMessage(Authentication authentication, @PathVariable String id,
            @RequestHeader("Idempotency-Key") String idempotencyKey, @Valid @RequestBody MessageCreate request) {
        return Result.ok(inspiration.sendMessage(CurrentUser.id(authentication), id, idempotencyKey,
                request.model(), request.content(), request.maxTokens()));
    }

    @GetMapping(value = "/inspiration-conversations/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(Authentication authentication, @PathVariable String id,
            @RequestHeader(name = "Last-Event-ID", defaultValue = "0") long lastEventId) {
        return inspiration.events(CurrentUser.id(authentication), id, lastEventId);
    }

    @PostMapping("/inspiration-conversations/{id}/runs/{runId}/cancel")
    public Result<com.dramaip.platform.ai.service.ChatService.CancelResult> cancelRun(Authentication authentication,
            @PathVariable String id, @PathVariable String runId) {
        return Result.ok(inspiration.cancelRun(CurrentUser.id(authentication), id, runId));
    }

    @GetMapping("/inspiration-conversations/{id}/cards")
    public Result<List<InspirationService.Card>> cards(Authentication authentication, @PathVariable String id) {
        return Result.ok(inspiration.cards(CurrentUser.id(authentication), id));
    }

    @PostMapping("/inspiration-conversations/{id}/cards")
    public Result<InspirationService.Card> createCard(Authentication authentication, @PathVariable String id,
            @Valid @RequestBody CardCreate request) {
        return Result.ok(inspiration.createCard(CurrentUser.id(authentication), id, request.sourceMessageId(),
                request.kind(), request.title(), request.content()));
    }

    @PatchMapping("/inspiration-conversations/cards/{id}")
    public Result<InspirationService.Card> updateCard(Authentication authentication, @PathVariable String id,
            @Valid @RequestBody CardPatch request) {
        return Result.ok(inspiration.updateCard(CurrentUser.id(authentication), id, request.title(), request.content(),
                request.kind(), request.adopted(), request.version()));
    }

    @DeleteMapping("/inspiration-conversations/cards/{id}")
    public Result<Map<String, Boolean>> deleteCard(Authentication authentication, @PathVariable String id) {
        inspiration.deleteCard(CurrentUser.id(authentication), id);
        return Result.ok(Map.of("deleted", true));
    }

    @GetMapping("/inspiration-memories/settings")
    public Result<InspirationService.MemorySettings> memorySettings(Authentication authentication) {
        return Result.ok(inspiration.memorySettings(CurrentUser.id(authentication)));
    }

    @PutMapping("/inspiration-memories/settings")
    public Result<InspirationService.MemorySettings> updateMemorySettings(Authentication authentication,
            @Valid @RequestBody MemorySettingsRequest request) {
        return Result.ok(inspiration.updateMemorySettings(CurrentUser.id(authentication), request.enabled()));
    }

    @GetMapping("/inspiration-memories")
    public Result<List<InspirationService.Memory>> memories(Authentication authentication) {
        return Result.ok(inspiration.memories(CurrentUser.id(authentication)));
    }

    @GetMapping("/inspiration-conversations/{id}/memory-jobs")
    public Result<List<InspirationService.MemoryJob>> memoryJobs(Authentication authentication, @PathVariable String id) {
        return Result.ok(inspiration.memoryJobs(CurrentUser.id(authentication), id));
    }

    @PatchMapping("/inspiration-memories/{id}")
    public Result<InspirationService.Memory> updateMemory(Authentication authentication, @PathVariable String id,
            @Valid @RequestBody MemoryPatch request) {
        return Result.ok(inspiration.updateMemory(CurrentUser.id(authentication), id, request.content(), request.kind(),
                request.status(), request.version()));
    }

    @DeleteMapping("/inspiration-memories/{id}")
    public Result<Map<String, Boolean>> deleteMemory(Authentication authentication, @PathVariable String id) {
        inspiration.deleteMemory(CurrentUser.id(authentication), id);
        return Result.ok(Map.of("deleted", true));
    }

    @PostMapping("/inspiration-memories/clear")
    public Result<Map<String, Boolean>> clearMemories(Authentication authentication) {
        inspiration.clearMemories(CurrentUser.id(authentication));
        return Result.ok(Map.of("cleared", true));
    }

    @PostMapping("/inspiration-memories/rebuild")
    public Result<Map<String, String>> rebuildMemories(Authentication authentication,
            @Valid @RequestBody RebuildRequest request) {
        inspiration.rebuildMemories(CurrentUser.id(authentication), request.conversationId());
        return Result.ok(Map.of("status", "pending"));
    }

    @PostMapping("/inspiration-project-previews")
    public Result<InspirationService.ProjectPreview> createPreview(Authentication authentication,
            @Valid @RequestBody ProjectPreviewCreate request) {
        return Result.ok(inspiration.createPreview(CurrentUser.id(authentication), request.conversationId(),
                request.title(), request.projectMode(), request.brief(), request.cardIds(), request.corpusItemIds()));
    }

    @GetMapping("/inspiration-project-previews/{id}")
    public Result<InspirationService.ProjectPreview> preview(Authentication authentication, @PathVariable String id) {
        return Result.ok(inspiration.preview(CurrentUser.id(authentication), id));
    }

    @PostMapping("/inspiration-project-previews/{id}/confirm")
    public Result<InspirationService.ConfirmedProject> confirmPreview(Authentication authentication, @PathVariable String id,
            @RequestHeader("Idempotency-Key") String idempotencyKey) {
        return Result.ok(inspiration.confirmPreview(CurrentUser.id(authentication), id, idempotencyKey));
    }

    public record ConversationCreate(@NotBlank String creativeMode, String title) { }
    public record ConversationPatch(String title, String creativeMode, Boolean archived) { }
    public record HistoryImport(String title, @NotEmpty List<@Valid HistoryMessage> messages) { }
    public record HistoryMessage(@NotBlank String role, @NotBlank String content) { }
    public record MessageCreate(@NotBlank String model, @NotBlank String content, @Positive int maxTokens) { }
    public record CardCreate(String sourceMessageId, @NotBlank String kind, @NotBlank String title,
            @NotBlank String content) { }
    public record CardPatch(String title, String content, String kind, Boolean adopted, @Positive int version) { }
    public record MemorySettingsRequest(boolean enabled) { }
    public record MemoryPatch(String content, String kind, String status, @Positive int version) { }
    public record RebuildRequest(@NotBlank String conversationId) { }
    public record ProjectPreviewCreate(@NotBlank String conversationId, @NotBlank String title,
            @NotBlank String projectMode, @NotEmpty Map<String, Object> brief, List<String> cardIds,
            List<String> corpusItemIds) {
        public ProjectPreviewCreate {
            cardIds = cardIds == null ? List.of() : List.copyOf(cardIds);
            corpusItemIds = corpusItemIds == null ? List.of() : List.copyOf(corpusItemIds);
        }
    }
}
