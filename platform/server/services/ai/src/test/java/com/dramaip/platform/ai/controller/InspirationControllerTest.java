package com.dramaip.platform.ai.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.dramaip.platform.ai.service.ChatService;
import com.dramaip.platform.ai.service.InspirationService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class InspirationControllerTest {
    private static final String USER_ID = "00000000-0000-0000-0000-000000000001";

    @Test
    void exposesOwnedConversationCardMemoryAndProjectContracts() {
        InspirationService service = mock(InspirationService.class);
        InspirationController controller = new InspirationController(service);
        Instant now = Instant.parse("2026-08-27T00:00:00Z");
        var conversation = new InspirationService.Conversation("conversation", "灵感", "free", "inspiration.v1",
                null, null, 0, now, now);
        var page = new InspirationService.Page<>(List.of(conversation), null);
        var message = new InspirationService.Message("message", "run", "user", "画面", "completed", 0, 0, now);
        var messagePage = new InspirationService.Page<>(List.of(message), null);
        var card = new InspirationService.Card("card", "conversation", null, "premise", "前提", "内容", false, 1,
                now, now);
        var settings = new InspirationService.MemorySettings(false, null, now);
        var memory = new InspirationService.Memory("memory", "theme", "成长", 0.8, "active", 1, now, now,
                List.of("conversation"));
        var memoryJob = new InspirationService.MemoryJob("job", "conversation", 6, "completed", "six_turns", 1,
                null, "model", 10, 5, now, now, now);
        var preview = new InspirationService.ProjectPreview("preview", "conversation", "项目", "single_season",
                Map.of("premise", "内容"), List.of("card"), List.of(), "pending", now, now, now.plusSeconds(600));
        var confirmed = new InspirationService.ConfirmedProject(preview, Map.of("schemaVersion", 4),
                Map.of("kind", "project"));
        var emitter = new SseEmitter();

        when(service.conversations(anyString(), anyBoolean(), anyString(), anyInt())).thenReturn(page);
        when(service.createConversation(anyString(), anyString(), any())).thenReturn(conversation);
        when(service.importHistory(anyString(), any(), anyList())).thenReturn(conversation);
        when(service.conversation(anyString(), anyString())).thenReturn(conversation);
        when(service.updateConversation(anyString(), anyString(), any(), any(), any())).thenReturn(conversation);
        when(service.fork(anyString(), anyString())).thenReturn(conversation);
        when(service.messages(anyString(), anyString(), anyString(), anyInt())).thenReturn(messagePage);
        when(service.sendMessage(anyString(), anyString(), anyString(), anyString(), anyString(), anyInt()))
                .thenReturn(new InspirationService.MessageStart("message", "run", "running"));
        when(service.events(anyString(), anyString(), anyLong())).thenReturn(emitter);
        when(service.cancelRun(anyString(), anyString(), anyString())).thenReturn(new ChatService.CancelResult("cancellationRequested"));
        when(service.cards(anyString(), anyString())).thenReturn(List.of(card));
        when(service.createCard(anyString(), anyString(), any(), anyString(), anyString(), anyString())).thenReturn(card);
        when(service.updateCard(anyString(), anyString(), any(), any(), any(), any(), anyInt())).thenReturn(card);
        when(service.memorySettings(anyString())).thenReturn(settings);
        when(service.updateMemorySettings(anyString(), anyBoolean())).thenReturn(settings);
        when(service.memories(anyString())).thenReturn(List.of(memory));
        when(service.memoryJobs(anyString(), anyString())).thenReturn(List.of(memoryJob));
        when(service.updateMemory(anyString(), anyString(), any(), any(), any(), anyInt())).thenReturn(memory);
        when(service.createPreview(anyString(), anyString(), anyString(), anyString(), anyMap(), anyList(), anyList()))
                .thenReturn(preview);
        when(service.preview(anyString(), anyString())).thenReturn(preview);
        when(service.confirmPreview(anyString(), anyString(), anyString())).thenReturn(confirmed);

        JwtAuthenticationToken authentication = authentication();
        assertEquals(page, controller.conversations(authentication, false, "", 20).data());
        assertEquals(conversation, controller.createConversation(authentication,
                new InspirationController.ConversationCreate("free", "灵感")).data());
        assertEquals(conversation, controller.importHistory(authentication,
                new InspirationController.HistoryImport("导入", List.of(
                        new InspirationController.HistoryMessage("user", "画面")))).data());
        assertEquals(conversation, controller.conversation(authentication, "conversation").data());
        assertEquals(conversation, controller.updateConversation(authentication, "conversation",
                new InspirationController.ConversationPatch("新标题", "guided", false)).data());
        assertEquals(conversation, controller.fork(authentication, "conversation").data());
        assertEquals(true, controller.deleteConversation(authentication, "conversation").data().get("deleted"));
        assertEquals(messagePage, controller.messages(authentication, "conversation", "", 100).data());
        assertEquals("run", controller.sendMessage(authentication, "conversation", "key",
                new InspirationController.MessageCreate("model", "画面", 100)).data().runId());
        assertEquals(emitter, controller.events(authentication, "conversation", 0));
        assertEquals("cancellationRequested", controller.cancelRun(authentication, "conversation", "run").data().status());
        assertEquals(List.of(card), controller.cards(authentication, "conversation").data());
        assertEquals(card, controller.createCard(authentication, "conversation",
                new InspirationController.CardCreate(null, "premise", "前提", "内容")).data());
        assertEquals(card, controller.updateCard(authentication, "card",
                new InspirationController.CardPatch("前提", "内容", "premise", true, 1)).data());
        assertEquals(true, controller.deleteCard(authentication, "card").data().get("deleted"));
        assertEquals(settings, controller.memorySettings(authentication).data());
        assertEquals(settings, controller.updateMemorySettings(authentication,
                new InspirationController.MemorySettingsRequest(true)).data());
        assertEquals(List.of(memory), controller.memories(authentication).data());
        assertEquals(List.of(memoryJob), controller.memoryJobs(authentication, "conversation").data());
        assertEquals(memory, controller.updateMemory(authentication, "memory",
                new InspirationController.MemoryPatch("成长", "theme", "active", 1)).data());
        assertEquals(true, controller.deleteMemory(authentication, "memory").data().get("deleted"));
        assertEquals(true, controller.clearMemories(authentication).data().get("cleared"));
        assertEquals("pending", controller.rebuildMemories(authentication,
                new InspirationController.RebuildRequest("conversation")).data().get("status"));
        assertEquals(preview, controller.createPreview(authentication,
                new InspirationController.ProjectPreviewCreate("conversation", "项目", "single_season",
                        Map.of("premise", "内容"), List.of("card"), List.of())).data());
        assertEquals(preview, controller.preview(authentication, "preview").data());
        assertEquals(confirmed, controller.confirmPreview(authentication, "preview", "key").data());
    }

    private static JwtAuthenticationToken authentication() {
        Jwt jwt = Jwt.withTokenValue("test").header("alg", "none").subject(USER_ID)
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();
        return new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority("ROLE_USER")));
    }
}
