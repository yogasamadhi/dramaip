package com.dramaip.platform.ai.controller;

import com.dramaip.platform.ai.service.ChatService;
import com.dramaip.platform.common.security.AdminAccess;
import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Positive;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/v1")
public class AiController {
    private final ChatService chats;
    public AiController(ChatService chats) { this.chats = chats; }

    @GetMapping("/models") public Result<List<String>> models(Authentication authentication) { CurrentUser.id(authentication); return Result.ok(chats.models()); }
    @PostMapping("/preflight") public Result<ChatService.Preflight> preflight(Authentication authentication, @Valid @RequestBody PreflightRequest request) { CurrentUser.id(authentication); return Result.ok(chats.preflight(request.model(), request.maxTokens())); }
    @PostMapping("/chats") public Result<ChatService.Chat> chat(Authentication authentication, @RequestHeader("Idempotency-Key") String key, @Valid @RequestBody ChatRequest request) {
        return Result.ok(chats.chat(CurrentUser.id(authentication), key, request.model(), messages(request), request.maxTokens()));
    }
    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(Authentication authentication, @RequestHeader("Idempotency-Key") String key, @Valid @RequestBody ChatRequest request) {
        return chats.stream(CurrentUser.id(authentication), key, request.model(), messages(request), request.maxTokens());
    }
    @PostMapping("/cancel") public Result<ChatService.CancelResult> cancel(Authentication authentication, @Valid @RequestBody KeyRequest request) { return Result.ok(chats.cancel(CurrentUser.id(authentication), request.idempotencyKey())); }
    @GetMapping("/chats/status") public Result<ChatService.Chat> status(Authentication authentication, @RequestParam("idempotencyKey") String key) { return Result.ok(chats.status(CurrentUser.id(authentication), key)); }
    @GetMapping("/cost-alerts") public Result<List<ChatService.CostAlert>> alerts(Authentication authentication, @RequestParam(defaultValue = "50") int limit) { return Result.ok(chats.costAlerts(CurrentUser.id(authentication), limit)); }
    @GetMapping("/admin/ai/cost-alerts")
    public Result<AdminCostAlerts> adminAlerts(Authentication authentication, @RequestParam(defaultValue = "50") int limit,
                                               @RequestParam(name = "user_id", defaultValue = "") String userId) {
        AdminAccess.require(authentication, "audit.read");
        return Result.ok(new AdminCostAlerts(chats.adminCostAlerts(limit, userId)));
    }
    @PostMapping("/expansions") public Result<ChatService.Chat> expansion(Authentication authentication, @RequestHeader("Idempotency-Key") String key, @Valid @RequestBody ExpansionRequest request) {
        return Result.ok(chats.chat(CurrentUser.id(authentication), key, request.model(), List.of(new ChatService.Message("user", request.text())), request.maxTokens()));
    }

    private static List<ChatService.Message> messages(ChatRequest request) { return request.messages().stream().map(message -> new ChatService.Message(message.role(), message.content())).toList(); }
    public record PreflightRequest(@NotBlank String model, @Positive int maxTokens) { }
    public record ChatRequest(@NotBlank String model, @NotEmpty List<MessageRequest> messages, @Positive int maxTokens) { }
    public record ExpansionRequest(@NotBlank String model, @NotBlank String text, @Positive int maxTokens) { }
    public record MessageRequest(@NotBlank String role, @NotBlank String content) { }
    public record KeyRequest(@NotBlank String idempotencyKey) { }
    public record AdminCostAlerts(List<ChatService.AdminCostAlert> alerts) { }
}
