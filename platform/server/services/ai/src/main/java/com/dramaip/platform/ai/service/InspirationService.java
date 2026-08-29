package com.dramaip.platform.ai.service;

import com.dramaip.platform.common.web.BusinessException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.function.Consumer;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class InspirationService {
    private static final List<String> MODES = List.of("free", "guided", "character_interview", "world_simulation", "conflict_lab");
    private static final List<String> CARD_KINDS = List.of("premise", "character", "world", "conflict", "scene", "style", "question");
    private static final List<String> MEMORY_KINDS = List.of("preference", "theme", "constraint", "avoid", "goal");
    private static final Pattern SENSITIVE = Pattern.compile(
            "(?i)(password|api[_ -]?key|secret|token|身份证|银行卡|手机号|电话|邮箱|住址|病历|诊断|财务|收入|债务)");
    private static final String POLICY_VERSION = "inspiration.v1";
    private static final Map<String, String> MODE_POLICIES = Map.of(
            "free", "开放联想，使用追问、对比和意外连接，不强迫形成结论。",
            "guided", "面向新手，一次只问一个清晰问题，逐步形成故事前提。",
            "character_interview", "通过角色访谈探索动机、秘密、欲望与内在矛盾。",
            "world_simulation", "推演世界规则、历史、阵营关系和因果后果。",
            "conflict_lab", "实验冲突、反转、悬念和至少两个替代方向。"
    );

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final ChatService chats;
    private final ExecutorService runs = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor();

    public InspirationService(JdbcTemplate jdbc, ObjectMapper json, ChatService chats) {
        this.jdbc = jdbc;
        this.json = json;
        this.chats = chats;
    }

    public Page<Conversation> conversations(String userId, boolean archived, String cursor, int limit) {
        int bounded = Math.max(1, Math.min(limit, 100));
        String before = timestampCursor(cursor);
        List<Conversation> items = jdbc.query("""
                select id::text, title, creative_mode, prompt_policy_version,
                       parent_conversation_id::text, archived_at, complete_turns, created_at, updated_at
                from ai_gateway.inspiration_conversations
                where user_id = ?::uuid and (archived_at is not null) = ?
                  and (? is null or updated_at < ?::timestamptz)
                order by updated_at desc, id desc limit ?
                """, (rs, row) -> new Conversation(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getString(5), instant(rs, 6), rs.getInt(7), instant(rs, 8), instant(rs, 9)),
                userId, archived, before, before, bounded + 1);
        String next = items.size() > bounded ? items.get(bounded - 1).updatedAt().toString() : null;
        return new Page<>(items.stream().limit(bounded).toList(), next);
    }

    public Conversation createConversation(String userId, String mode, String title) {
        requireMode(mode);
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into ai_gateway.inspiration_conversations(id, user_id, title, creative_mode, prompt_policy_version)
                values (?::uuid, ?::uuid, ?, ?, ?)
                """, id, userId, normalizedTitle(title), mode, POLICY_VERSION);
        return conversation(userId, id);
    }

    public Conversation importHistory(String userId, String title, List<ImportedMessage> messages) {
        if (messages.isEmpty() || messages.size() > 500) throw invalid("history must contain between 1 and 500 messages");
        for (ImportedMessage message : messages) {
            if (!List.of("user", "assistant").contains(message.role()) || message.content() == null
                    || message.content().isBlank() || message.content().length() > 100_000) {
                throw invalid("history message is invalid");
            }
        }
        Conversation created = createConversation(userId, "free", title);
        int completedTurns = 0;
        for (ImportedMessage message : messages) {
            jdbc.update("""
                    insert into ai_gateway.inspiration_messages(id, conversation_id, user_id, role, content, status)
                    values (gen_random_uuid(), ?::uuid, ?::uuid, ?, ?, 'completed')
                    """, created.id(), userId, message.role(), message.content());
            if ("assistant".equals(message.role())) completedTurns++;
        }
        jdbc.update("""
                update ai_gateway.inspiration_conversations set complete_turns = ?, updated_at = now()
                where id = ?::uuid and user_id = ?::uuid
                """, completedTurns, created.id(), userId);
        return conversation(userId, created.id());
    }

    public Conversation conversation(String userId, String id) {
        Conversation result = jdbc.query("""
                select id::text, title, creative_mode, prompt_policy_version,
                       parent_conversation_id::text, archived_at, complete_turns, created_at, updated_at
                from ai_gateway.inspiration_conversations where id = ?::uuid and user_id = ?::uuid
                """, rs -> rs.next() ? new Conversation(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getString(5), instant(rs, 6), rs.getInt(7), instant(rs, 8), instant(rs, 9)) : null, id, userId);
        if (result == null) throw notFound();
        return result;
    }

    public Conversation updateConversation(String userId, String id, String title, String mode, Boolean archived) {
        Conversation current = conversation(userId, id);
        String nextMode = mode == null ? current.creativeMode() : mode;
        requireMode(nextMode);
        jdbc.update("""
                update ai_gateway.inspiration_conversations
                set title = ?, creative_mode = ?, archived_at = case when ? then coalesce(archived_at, now()) else null end,
                    updated_at = now() where id = ?::uuid and user_id = ?::uuid
                """, title == null ? current.title() : normalizedTitle(title), nextMode,
                archived != null ? archived : current.archivedAt() != null, id, userId);
        if (Boolean.TRUE.equals(archived)) queueMemoryJob(userId, id, "archive", true);
        return conversation(userId, id);
    }

    public Conversation fork(String userId, String sourceId) {
        Conversation source = conversation(userId, sourceId);
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into ai_gateway.inspiration_conversations(
                    id, user_id, title, creative_mode, prompt_policy_version, parent_conversation_id, complete_turns)
                values (?::uuid, ?::uuid, ?, ?, ?, ?::uuid, ?)
                """, id, userId, source.title() + " · 分支", source.creativeMode(), source.promptPolicyVersion(), sourceId,
                source.completeTurns());
        jdbc.update("""
                insert into ai_gateway.inspiration_messages(
                    id, conversation_id, user_id, role, content, status, prompt_tokens, completion_tokens, created_at)
                select gen_random_uuid(), ?::uuid, user_id, role, content, status, prompt_tokens, completion_tokens, created_at
                from ai_gateway.inspiration_messages where conversation_id = ?::uuid order by created_at, id
                """, id, sourceId);
        jdbc.update("""
                insert into ai_gateway.inspiration_cards(
                    id, conversation_id, user_id, kind, title, content, adopted, version, created_at, updated_at)
                select gen_random_uuid(), ?::uuid, user_id, kind, title, content, adopted, 1, created_at, updated_at
                from ai_gateway.inspiration_cards where conversation_id = ?::uuid
                """, id, sourceId);
        return conversation(userId, id);
    }

    public void deleteConversation(String userId, String id) {
        conversation(userId, id);
        jdbc.update("delete from ai_gateway.inspiration_conversations where id = ?::uuid and user_id = ?::uuid", id, userId);
        jdbc.update("""
                delete from ai_gateway.inspiration_memories memory
                where memory.user_id = ?::uuid
                  and not exists (select 1 from ai_gateway.inspiration_memory_sources source where source.memory_id = memory.id)
                """, userId);
    }

    public Page<Message> messages(String userId, String conversationId, String cursor, int limit) {
        conversation(userId, conversationId);
        int bounded = Math.max(1, Math.min(limit, 200));
        long after = offsetCursor(cursor);
        List<Message> items = jdbc.query("""
                select id::text, run_id::text, role, content, status, prompt_tokens, completion_tokens,
                       created_at, row_number() over(order by created_at, id) as sequence
                from ai_gateway.inspiration_messages where conversation_id = ?::uuid
                order by created_at, id offset ? limit ?
                """, (rs, row) -> new Message(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getString(5), rs.getLong(6), rs.getLong(7), instant(rs, 8)), conversationId, after, bounded + 1);
        String next = items.size() > bounded ? Long.toString(after + bounded) : null;
        return new Page<>(items.stream().limit(bounded).toList(), next);
    }

    public MessageStart sendMessage(String userId, String conversationId, String idempotencyKey, String model,
            String content, int maxTokens) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new BusinessException("INSPIRATION_IDEMPOTENCY_REQUIRED", "Idempotency-Key is required", HttpStatus.BAD_REQUEST);
        }
        Conversation conversation = conversation(userId, conversationId);
        Message replay = messageByKey(userId, idempotencyKey);
        if (replay != null) return new MessageStart(replay.id(), replay.runId(), replay.status());
        String messageId = UUID.randomUUID().toString();
        String runId = UUID.randomUUID().toString();
        jdbc.update("""
                insert into ai_gateway.inspiration_messages(
                    id, conversation_id, user_id, run_id, role, content, status, client_idempotency_key)
                values (?::uuid, ?::uuid, ?::uuid, ?::uuid, 'user', ?, 'completed', ?)
                """, messageId, conversationId, userId, runId, content, idempotencyKey);
        event(conversationId, runId, "started", Map.of("messageId", messageId, "policyVersion", POLICY_VERSION));
        jdbc.update("update ai_gateway.inspiration_conversations set updated_at = now() where id = ?::uuid", conversationId);
        runs.execute(() -> completeRun(userId, conversation, runId, idempotencyKey, model, maxTokens));
        return new MessageStart(messageId, runId, "running");
    }

    private void completeRun(String userId, Conversation conversation, String runId, String idempotencyKey, String model,
            int maxTokens) {
        String responseId = UUID.randomUUID().toString();
        try {
            List<ChatService.Message> context = buildContext(userId, conversation);
            String requestKey = "inspiration:" + conversation.id() + ":" + idempotencyKey;
            Consumer<String> delta = value -> event(conversation.id(), runId, "delta", Map.of("messageId", responseId, "delta", value));
            ChatService.Chat reply = chats.streamTo(userId, requestKey, model, context, maxTokens, delta);
            jdbc.update("""
                    insert into ai_gateway.inspiration_messages(
                        id, conversation_id, user_id, run_id, role, content, status, prompt_tokens, completion_tokens)
                    values (?::uuid, ?::uuid, ?::uuid, ?::uuid, 'assistant', ?, 'completed', ?, ?)
                    """, responseId, conversation.id(), userId, runId, reply.content(), reply.promptTokens(), reply.completionTokens());
            jdbc.update("""
                    update ai_gateway.inspiration_conversations
                    set complete_turns = complete_turns + 1, updated_at = now() where id = ?::uuid
                    """, conversation.id());
            event(conversation.id(), runId, "completed", Map.of("messageId", responseId,
                    "promptTokens", reply.promptTokens(), "completionTokens", reply.completionTokens()));
            Integer turns = jdbc.queryForObject("select complete_turns from ai_gateway.inspiration_conversations where id = ?::uuid",
                    Integer.class, conversation.id());
            if (turns != null && turns % 6 == 0) queueMemoryJob(userId, conversation.id(), "six_turns", false);
        } catch (RuntimeException exception) {
            event(conversation.id(), runId, "failed", Map.of("code", safeCode(exception)));
        }
    }

    private List<ChatService.Message> buildContext(String userId, Conversation conversation) {
        List<ChatService.Message> result = new ArrayList<>();
        result.add(new ChatService.Message("system", "你是 DramaIP 灵感空间的创意对话伙伴。" +
                MODE_POLICIES.get(conversation.creativeMode()) +
                " 不催促用户创建项目，不声称读取项目或文件，不索取敏感信息。策略版本：" + POLICY_VERSION));
        String summary = jdbc.query("select summary from ai_gateway.inspiration_summaries where conversation_id = ?::uuid",
                rs -> rs.next() ? rs.getString(1) : null, conversation.id());
        if (summary != null && !summary.isBlank()) result.add(new ChatService.Message("system", "此前对话摘要：" + summary));
        Boolean memoryEnabled = jdbc.query("select enabled from ai_gateway.inspiration_memory_settings where user_id = ?::uuid",
                rs -> rs.next() ? rs.getBoolean(1) : false, userId);
        if (Boolean.TRUE.equals(memoryEnabled)) {
            List<String> memories = jdbc.query("""
                    select content from ai_gateway.inspiration_memories
                    where user_id = ?::uuid and status = 'active' order by updated_at desc limit 30
                    """, (rs, row) -> rs.getString(1), userId);
            if (!memories.isEmpty()) result.add(new ChatService.Message("system", "用户授权的长期创作偏好：" + String.join("；", memories)));
        }
        List<String> cards = jdbc.query("""
                select title || '：' || content from ai_gateway.inspiration_cards
                where conversation_id = ?::uuid and adopted order by updated_at desc limit 20
                """, (rs, row) -> rs.getString(1), conversation.id());
        if (!cards.isEmpty()) result.add(new ChatService.Message("system", "用户选中的灵感卡片：" + String.join("；", cards)));
        result.addAll(jdbc.query("""
                select role, content from (
                    select role, content, created_at, id from ai_gateway.inspiration_messages
                    where conversation_id = ?::uuid order by created_at desc, id desc limit 40
                ) recent order by created_at, id
                """, (rs, row) -> new ChatService.Message(rs.getString(1), rs.getString(2)), conversation.id()));
        return result;
    }

    public SseEmitter events(String userId, String conversationId, long afterSequence) {
        conversation(userId, conversationId);
        SseEmitter emitter = new SseEmitter(30_000L);
        runs.execute(() -> {
            try {
                List<RunEvent> events = jdbc.query("""
                        select sequence, run_id::text, event_type, payload::text, created_at
                        from ai_gateway.inspiration_run_events
                        where conversation_id = ?::uuid and sequence > ? order by sequence limit 500
                        """, (rs, row) -> new RunEvent(rs.getLong(1), rs.getString(2), rs.getString(3),
                        readMap(rs.getString(4)), instant(rs, 5)), conversationId, afterSequence);
                for (RunEvent event : events) {
                    emitter.send(SseEmitter.event().id(Long.toString(event.sequence())).name(event.type()).data(event));
                }
                emitter.complete();
            } catch (IOException exception) {
                emitter.completeWithError(exception);
            }
        });
        return emitter;
    }

    public ChatService.CancelResult cancelRun(String userId, String conversationId, String runId) {
        conversation(userId, conversationId);
        String idempotencyKey = jdbc.query("""
                select client_idempotency_key from ai_gateway.inspiration_messages
                where conversation_id = ?::uuid and user_id = ?::uuid and run_id = ?::uuid and role = 'user'
                """, rs -> rs.next() ? rs.getString(1) : null, conversationId, userId, runId);
        if (idempotencyKey == null) throw notFound();
        ChatService.CancelResult result = chats.cancel(userId, "inspiration:" + conversationId + ":" + idempotencyKey);
        event(conversationId, runId, "canceled", Map.of("status", result.status()));
        return result;
    }

    public Card createCard(String userId, String conversationId, String sourceMessageId, String kind, String title, String content) {
        conversation(userId, conversationId);
        requireCardKind(kind);
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into ai_gateway.inspiration_cards(
                    id, conversation_id, user_id, source_message_id, kind, title, content)
                values (?::uuid, ?::uuid, ?::uuid, nullif(?, '')::uuid, ?, ?, ?)
                """, id, conversationId, userId, sourceMessageId == null ? "" : sourceMessageId, kind, normalizedTitle(title), content);
        return card(userId, id);
    }

    public List<Card> cards(String userId, String conversationId) {
        conversation(userId, conversationId);
        return jdbc.query("""
                select id::text, conversation_id::text, source_message_id::text, kind, title, content,
                       adopted, version, created_at, updated_at from ai_gateway.inspiration_cards
                where conversation_id = ?::uuid and user_id = ?::uuid order by updated_at desc, id
                """, (rs, row) -> card(rs), conversationId, userId);
    }

    public Card updateCard(String userId, String id, String title, String content, String kind, Boolean adopted, int version) {
        Card current = card(userId, id);
        String nextKind = kind == null ? current.kind() : kind;
        requireCardKind(nextKind);
        int changed = jdbc.update("""
                update ai_gateway.inspiration_cards set title = ?, content = ?, kind = ?, adopted = ?,
                    version = version + 1, updated_at = now()
                where id = ?::uuid and user_id = ?::uuid and version = ?
                """, title == null ? current.title() : normalizedTitle(title), content == null ? current.content() : content,
                nextKind, adopted == null ? current.adopted() : adopted, id, userId, version);
        if (changed == 0) throw new BusinessException("INSPIRATION_VERSION_CONFLICT", "card version changed", HttpStatus.CONFLICT);
        return card(userId, id);
    }

    public void deleteCard(String userId, String id) {
        card(userId, id);
        jdbc.update("delete from ai_gateway.inspiration_cards where id = ?::uuid and user_id = ?::uuid", id, userId);
    }

    public MemorySettings memorySettings(String userId) {
        return jdbc.query("""
                select enabled, consented_at, updated_at from ai_gateway.inspiration_memory_settings where user_id = ?::uuid
                """, rs -> rs.next() ? new MemorySettings(rs.getBoolean(1), instant(rs, 2), instant(rs, 3))
                : new MemorySettings(false, null, Instant.now()), userId);
    }

    public MemorySettings updateMemorySettings(String userId, boolean enabled) {
        jdbc.update("""
                insert into ai_gateway.inspiration_memory_settings(user_id, enabled, consented_at)
                values (?::uuid, ?, now()) on conflict(user_id) do update
                set enabled = excluded.enabled, consented_at = coalesce(ai_gateway.inspiration_memory_settings.consented_at, now()), updated_at = now()
                """, userId, enabled);
        return memorySettings(userId);
    }

    public List<Memory> memories(String userId) {
        return jdbc.query("""
                select memory.id::text, memory.kind, memory.content, memory.confidence::double precision,
                       memory.status, memory.version, memory.created_at, memory.updated_at,
                       coalesce(array_agg(source.conversation_id::text) filter(where source.conversation_id is not null), '{}')
                from ai_gateway.inspiration_memories memory
                left join ai_gateway.inspiration_memory_sources source on source.memory_id = memory.id
                where memory.user_id = ?::uuid group by memory.id order by memory.updated_at desc
                """, (rs, row) -> new Memory(rs.getString(1), rs.getString(2), rs.getString(3), rs.getDouble(4), rs.getString(5),
                rs.getInt(6), instant(rs, 7), instant(rs, 8), List.of((String[]) rs.getArray(9).getArray())), userId);
    }

    public List<MemoryJob> memoryJobs(String userId, String conversationId) {
        conversation(userId, conversationId);
        return jdbc.query("""
                select id::text, conversation_id::text, through_turn_count, status, reason, attempts,
                       error_code, model, prompt_tokens, completion_tokens, created_at, updated_at, finished_at
                from ai_gateway.inspiration_memory_jobs
                where conversation_id = ?::uuid and user_id = ?::uuid
                order by created_at desc, id desc limit 50
                """, (rs, row) -> new MemoryJob(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getString(4),
                rs.getString(5), rs.getInt(6), rs.getString(7), rs.getString(8), rs.getLong(9), rs.getLong(10),
                instant(rs, 11), instant(rs, 12), instant(rs, 13)), conversationId, userId);
    }

    public Memory updateMemory(String userId, String id, String content, String kind, String status, int version) {
        Memory current = memories(userId).stream().filter(value -> value.id().equals(id)).findFirst().orElseThrow(this::notFound);
        String nextKind = kind == null ? current.kind() : kind;
        if (!MEMORY_KINDS.contains(nextKind)) throw invalid("memory kind is invalid");
        String nextStatus = status == null ? current.status() : status;
        if (!List.of("active", "disabled").contains(nextStatus)) throw invalid("memory status is invalid");
        int changed = jdbc.update("""
                update ai_gateway.inspiration_memories set content = ?, kind = ?, status = ?, version = version + 1, updated_at = now()
                where id = ?::uuid and user_id = ?::uuid and version = ?
                """, content == null ? current.content() : content, nextKind, nextStatus, id, userId, version);
        if (changed == 0) throw new BusinessException("INSPIRATION_VERSION_CONFLICT", "memory version changed", HttpStatus.CONFLICT);
        return memories(userId).stream().filter(value -> value.id().equals(id)).findFirst().orElseThrow(this::notFound);
    }

    public void deleteMemory(String userId, String id) {
        int changed = jdbc.update("delete from ai_gateway.inspiration_memories where id = ?::uuid and user_id = ?::uuid", id, userId);
        if (changed == 0) throw notFound();
    }

    public void clearMemories(String userId) {
        jdbc.update("delete from ai_gateway.inspiration_memories where user_id = ?::uuid", userId);
    }

    public void rebuildMemories(String userId, String conversationId) {
        conversation(userId, conversationId);
        queueMemoryJob(userId, conversationId, "manual", true);
    }

    public ProjectPreview createPreview(String userId, String conversationId, String title, String projectMode,
            Map<String, Object> brief, List<String> cardIds, List<String> corpusItemIds) {
        conversation(userId, conversationId);
        for (String cardId : cardIds) {
            Card selected = card(userId, cardId);
            if (!selected.conversationId().equals(conversationId)) throw invalid("card does not belong to conversation");
        }
        for (String corpusItemId : corpusItemIds) packageCorpusItem(userId, corpusItemId);
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into ai_gateway.inspiration_project_previews(
                    id, conversation_id, user_id, title, project_mode, brief, card_ids, corpus_item_ids)
                values (?::uuid, ?::uuid, ?::uuid, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb)
                """, id, conversationId, userId, normalizedTitle(title), projectMode, writeJson(brief),
                writeJson(cardIds), writeJson(corpusItemIds));
        return preview(userId, id);
    }

    public ProjectPreview preview(String userId, String id) {
        ProjectPreview value = jdbc.query("""
                select id::text, conversation_id::text, title, project_mode, brief::text, card_ids::text,
                       corpus_item_ids::text, status, created_at, updated_at, expires_at
                from ai_gateway.inspiration_project_previews where id = ?::uuid and user_id = ?::uuid and expires_at > now()
                """, rs -> rs.next() ? new ProjectPreview(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                readMap(rs.getString(5)), readStringList(rs.getString(6)), readStringList(rs.getString(7)),
                rs.getString(8), instant(rs, 9), instant(rs, 10), instant(rs, 11))
                : null, id, userId);
        if (value == null) throw notFound();
        return value;
    }

    public ConfirmedProject confirmPreview(String userId, String id, String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new BusinessException("INSPIRATION_IDEMPOTENCY_REQUIRED", "Idempotency-Key is required", HttpStatus.BAD_REQUEST);
        }
        ProjectPreview value = preview(userId, id);
        String existingKey = jdbc.query("""
                select idempotency_key from ai_gateway.inspiration_project_previews
                where id = ?::uuid and user_id = ?::uuid
                """, rs -> rs.next() ? rs.getString(1) : null, id, userId);
        if (existingKey != null && !existingKey.equals(idempotencyKey)) {
            throw new BusinessException("INSPIRATION_IDEMPOTENCY_CONFLICT",
                    "preview was confirmed with a different idempotency key", HttpStatus.CONFLICT);
        }
        List<Card> selected = value.cardIds().stream().map(cardId -> card(userId, cardId)).toList();
        List<Map<String, Object>> corpusItems = value.corpusItemIds().stream()
                .map(corpusItemId -> packageCorpusItem(userId, corpusItemId)).toList();
        Map<String, Object> project = new LinkedHashMap<>();
        project.put("title", value.title());
        project.put("mode", value.projectMode());
        project.put("modeConfig", projectModeConfig(value.projectMode(), value.title(), value.brief()));
        project.put("synopsis", String.valueOf(value.brief().getOrDefault("premise", "")));
        project.put("productionBrief", writeJson(value.brief()));
        List<Map<String, Object>> resources = selected.stream().map(card -> Map.<String, Object>of(
                "id", card.id(), "owner", "automation", "kind", "inspirations", "title", card.title(),
                "payload", Map.of("title", card.title(), "content", card.content(), "kind", card.kind()))).toList();
        List<Map<String, Object>> provenance = corpusItems.stream().map(item -> Map.<String, Object>of(
                "id", UUID.randomUUID().toString(), "fromType", "project_brief", "fromId", value.id(),
                "relation", "inspired_by", "toType", "corpus_item", "toId", item.get("id"),
                "version", 0, "createdAt", value.createdAt().toString())).toList();
        Map<String, Object> creativeIntelligence = Map.of(
                "corpusItems", corpusItems, "causalNodes", List.of(), "causalEdges", List.of(),
                "audienceStates", List.of(), "provenance", provenance);
        Map<String, Object> projectPackage = Map.of(
                "format", "dramaip-project-package", "schemaVersion", 4, "project", project,
                "chapters", List.of(), "resources", resources, "creativeIntelligence", creativeIntelligence,
                "warnings", List.of("仅包含用户选择的抽象语料、灵感卡和脱敏谱系；不包含网页正文、完整对话、长期记忆或创意指纹。"),
                "exportedAt", value.createdAt().toString());
        jdbc.update("""
                update ai_gateway.inspiration_project_previews set status = 'confirmed', idempotency_key = ?, updated_at = now()
                where id = ?::uuid and user_id = ?::uuid and (idempotency_key is null or idempotency_key = ?)
                """, idempotencyKey, id, userId, idempotencyKey);
        return new ConfirmedProject(preview(userId, id), projectPackage,
                Map.of("clientId", "inspiration-preview:" + id, "kind", "project", "captureMode", "text",
                        "content", writeJson(projectPackage), "title", value.title()));
    }

    private Map<String, Object> packageCorpusItem(String userId, String id) {
        Map<String, Object> value = jdbc.query("""
                select id::text, kind, title, trigger_text, mechanism, emotional_effect,
                       contexts::text, risk_tags::text, tags::text, freshness, rights_status, locale
                from ai_gateway.corpus_items
                where id = ?::uuid and tombstoned_at is null and rights_status != 'removed'
                  and ((visibility = 'public' and rights_status = 'allowed')
                    or (visibility = 'private' and owner_user_id = ?::uuid))
                """, rs -> rs.next() ? linked(
                "id", rs.getString(1), "kind", rs.getString(2), "title", rs.getString(3),
                "trigger", rs.getString(4), "mechanism", rs.getString(5), "emotionalEffect", rs.getString(6),
                "contexts", readStringList(rs.getString(7)), "riskTags", readStringList(rs.getString(8)),
                "tags", readStringList(rs.getString(9)), "freshness", rs.getString(10),
                "rightsStatus", rs.getString(11), "locale", rs.getString(12)) : null, id, userId);
        if (value == null) throw invalid("corpus item is unavailable or not owned by the user");
        return value;
    }

    private void queueMemoryJob(String userId, String conversationId, String reason, boolean force) {
        Integer turns = jdbc.queryForObject(
                "select complete_turns from ai_gateway.inspiration_conversations where id = ?::uuid and user_id = ?::uuid",
                Integer.class, conversationId, userId);
        if (!force && (turns == null || turns == 0 || turns % 6 != 0)) return;
        if ("six_turns".equals(reason)) {
            jdbc.update("""
                    insert into ai_gateway.inspiration_memory_jobs(
                        id, conversation_id, user_id, through_turn_count, status, reason)
                    values (gen_random_uuid(), ?::uuid, ?::uuid, ?, 'pending', ?)
                    on conflict(conversation_id, through_turn_count) where reason = 'six_turns' do nothing
                    """, conversationId, userId, turns, reason);
        } else {
            jdbc.update("""
                    insert into ai_gateway.inspiration_memory_jobs(
                        id, conversation_id, user_id, through_turn_count, status, reason)
                    values (gen_random_uuid(), ?::uuid, ?::uuid, ?, 'pending', ?)
                    """, conversationId, userId, turns == null ? 0 : turns, reason);
        }
    }

    @Scheduled(fixedDelay = 10_000L)
    void processMemoryJob() {
        QueuedMemoryJob job = jdbc.query("""
                select id::text, conversation_id::text, user_id::text, attempts
                from ai_gateway.inspiration_memory_jobs where status = 'pending'
                order by updated_at limit 1
                """, rs -> rs.next() ? new QueuedMemoryJob(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4)) : null);
        if (job == null) return;
        int claimed = jdbc.update("""
                update ai_gateway.inspiration_memory_jobs set status = 'running', attempts = attempts + 1, updated_at = now()
                where id = ?::uuid and status = 'pending'
                """, job.id());
        if (claimed == 0) return;
        try {
            Conversation conversation = conversation(job.userId(), job.conversationId());
            String model = chats.models().stream().findFirst().orElseThrow(() -> invalid("no model available"));
            List<ChatService.Message> prompt = buildContext(job.userId(), conversation);
            prompt.add(new ChatService.Message("system", "请只输出 JSON：{\"summary\":\"...\",\"memories\":[{\"kind\":\"preference|theme|constraint|avoid|goal\",\"content\":\"...\",\"confidence\":0.0}]}。只提取创作偏好，排除凭据、联系方式、健康、财务及第三方敏感信息。"));
            ChatService.Chat result = chats.chat(job.userId(), "inspiration-memory:" + job.id() + ":" + (job.attempts() + 1), model, prompt, 2_048);
            saveMemoryResult(job, model, result);
            jdbc.update("""
                    update ai_gateway.inspiration_memory_jobs
                    set status = 'completed', error_code = null, model = ?, prompt_tokens = ?, completion_tokens = ?,
                        updated_at = now(), finished_at = now() where id = ?::uuid
                    """, model, result.promptTokens(), result.completionTokens(), job.id());
        } catch (RuntimeException exception) {
            jdbc.update("update ai_gateway.inspiration_memory_jobs set status = 'pending', error_code = ?, updated_at = now() where id = ?::uuid",
                    safeCode(exception), job.id());
        }
    }

    private void saveMemoryResult(QueuedMemoryJob job, String model, ChatService.Chat result) {
        try {
            JsonNode root = json.readTree(result.content());
            String summary = root.path("summary").asText("");
            if (!summary.isBlank()) {
                jdbc.update("""
                        insert into ai_gateway.inspiration_summaries(
                            conversation_id, user_id, summary, model, prompt_tokens, completion_tokens)
                        values (?::uuid, ?::uuid, ?, ?, ?, ?) on conflict(conversation_id) do update
                        set summary = excluded.summary, model = excluded.model, prompt_tokens = excluded.prompt_tokens,
                            completion_tokens = excluded.completion_tokens, updated_at = now()
                        """, job.conversationId(), job.userId(), summary, model, result.promptTokens(), result.completionTokens());
            }
            if (!memorySettings(job.userId()).enabled()) return;
            for (JsonNode item : root.path("memories")) {
                String kind = item.path("kind").asText();
                String content = item.path("content").asText().trim();
                double confidence = Math.max(0, Math.min(1, item.path("confidence").asDouble(0.5)));
                if (!MEMORY_KINDS.contains(kind) || content.isBlank() || SENSITIVE.matcher(content).find()) continue;
                String memoryId = jdbc.query("""
                        select id::text from ai_gateway.inspiration_memories
                        where user_id = ?::uuid and kind = ? and content = ? limit 1
                        """, rs -> rs.next() ? rs.getString(1) : null, job.userId(), kind, content);
                if (memoryId == null) {
                    memoryId = UUID.randomUUID().toString();
                    jdbc.update("""
                            insert into ai_gateway.inspiration_memories(id, user_id, kind, content, confidence)
                            values (?::uuid, ?::uuid, ?, ?, ?)
                            """, memoryId, job.userId(), kind, content, confidence);
                } else {
                    jdbc.update("""
                            update ai_gateway.inspiration_memories
                            set confidence = greatest(confidence, ?), updated_at = now()
                            where id = ?::uuid and user_id = ?::uuid
                            """, confidence, memoryId, job.userId());
                }
                jdbc.update("""
                        insert into ai_gateway.inspiration_memory_sources(memory_id, conversation_id)
                        values (?::uuid, ?::uuid) on conflict do nothing
                        """, memoryId, job.conversationId());
            }
        } catch (JsonProcessingException exception) {
            throw new BusinessException("INSPIRATION_MEMORY_RESPONSE_INVALID", "memory response is invalid", HttpStatus.BAD_GATEWAY);
        }
    }

    private Card card(String userId, String id) {
        Card value = jdbc.query("""
                select id::text, conversation_id::text, source_message_id::text, kind, title, content,
                       adopted, version, created_at, updated_at from ai_gateway.inspiration_cards
                where id = ?::uuid and user_id = ?::uuid
                """, rs -> rs.next() ? card(rs) : null, id, userId);
        if (value == null) throw notFound();
        return value;
    }

    private static Card card(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Card(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
                rs.getBoolean(7), rs.getInt(8), instant(rs, 9), instant(rs, 10));
    }

    private Message messageByKey(String userId, String key) {
        return jdbc.query("""
                select id::text, run_id::text, role, content, status, prompt_tokens, completion_tokens, created_at
                from ai_gateway.inspiration_messages where user_id = ?::uuid and client_idempotency_key = ?
                """, rs -> rs.next() ? new Message(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getString(5), rs.getLong(6), rs.getLong(7), instant(rs, 8)) : null, userId, key);
    }

    private void event(String conversationId, String runId, String type, Map<String, Object> payload) {
        jdbc.update("""
                insert into ai_gateway.inspiration_run_events(conversation_id, run_id, event_type, payload)
                values (?::uuid, ?::uuid, ?, ?::jsonb)
                """, conversationId, runId, type, writeJson(payload));
    }

    private Map<String, Object> readMap(String value) {
        try {
            return json.readValue(value, new com.fasterxml.jackson.core.type.TypeReference<>() { });
        } catch (JsonProcessingException exception) {
            return Map.of();
        }
    }

    private List<String> readStringList(String value) {
        try {
            return json.readValue(value, new com.fasterxml.jackson.core.type.TypeReference<>() { });
        } catch (JsonProcessingException exception) {
            return List.of();
        }
    }

    private String writeJson(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("could not encode internal JSON", exception);
        }
    }

    private static Instant instant(java.sql.ResultSet rs, int index) throws java.sql.SQLException {
        var timestamp = rs.getTimestamp(index);
        return timestamp == null ? null : timestamp.toInstant();
    }

    private static Map<String, Object> linked(Object... values) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int index = 0; index < values.length; index += 2) {
            result.put(String.valueOf(values[index]), values[index + 1]);
        }
        return result;
    }

    private static String normalizedTitle(String value) {
        String title = value == null ? "" : value.trim();
        return title.isBlank() ? "未命名灵感" : title.substring(0, Math.min(title.length(), 200));
    }

    private static String timestampCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) return null;
        try {
            return Instant.parse(cursor).toString();
        } catch (RuntimeException exception) {
            throw invalid("conversation cursor is invalid");
        }
    }

    private static long offsetCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) return 0;
        try {
            long value = Long.parseLong(cursor);
            if (value < 0) throw new NumberFormatException();
            return value;
        } catch (NumberFormatException exception) {
            throw invalid("message cursor is invalid");
        }
    }

    private static Map<String, Object> projectModeConfig(String mode, String title, Map<String, Object> brief) {
        return switch (mode) {
            case "series_longform" -> Map.of("mode", mode);
            case "single_season" -> Map.of("mode", mode, "entryPath", "novel", "targetEpisodeCount", 80);
            case "personal_theater" -> Map.of("mode", mode, "storyMethod", "freeform");
            case "creator_channel" -> Map.of("mode", mode, "topic", title,
                    "audience", String.valueOf(brief.getOrDefault("audience", "")));
            default -> throw invalid("project mode is invalid");
        };
    }

    private static void requireMode(String value) {
        if (!MODES.contains(value)) throw invalid("creative mode is invalid");
    }

    private static void requireCardKind(String value) {
        if (!CARD_KINDS.contains(value)) throw invalid("card kind is invalid");
    }

    private static BusinessException invalid(String message) {
        return new BusinessException("INSPIRATION_INVALID", message, HttpStatus.BAD_REQUEST);
    }

    private BusinessException notFound() {
        return new BusinessException("INSPIRATION_NOT_FOUND", "inspiration resource not found", HttpStatus.NOT_FOUND);
    }

    private static String safeCode(RuntimeException exception) {
        return exception instanceof BusinessException business ? business.code() : "AI_PROVIDER_FAILED";
    }

    @PreDestroy
    void shutdown() {
        runs.shutdownNow();
    }

    public record Page<T>(List<T> items, String nextCursor) { }
    public record ImportedMessage(String role, String content) { }
    public record Conversation(String id, String title, String creativeMode, String promptPolicyVersion,
            String parentConversationId, Instant archivedAt, int completeTurns, Instant createdAt, Instant updatedAt) { }
    public record Message(String id, String runId, String role, String content, String status,
            long promptTokens, long completionTokens, Instant createdAt) { }
    public record MessageStart(String messageId, String runId, String status) { }
    public record RunEvent(long sequence, String runId, String type, Map<String, Object> payload, Instant createdAt) { }
    public record Card(String id, String conversationId, String sourceMessageId, String kind, String title,
            String content, boolean adopted, int version, Instant createdAt, Instant updatedAt) { }
    public record MemorySettings(boolean enabled, Instant consentedAt, Instant updatedAt) { }
    public record Memory(String id, String kind, String content, double confidence, String status, int version,
            Instant createdAt, Instant updatedAt, List<String> sourceConversationIds) { }
    public record MemoryJob(String id, String conversationId, int throughTurnCount, String status, String reason,
            int attempts, String errorCode, String model, long promptTokens, long completionTokens,
            Instant createdAt, Instant updatedAt, Instant finishedAt) { }
    public record ProjectPreview(String id, String conversationId, String title, String projectMode,
            Map<String, Object> brief, List<String> cardIds, List<String> corpusItemIds, String status,
            Instant createdAt, Instant updatedAt, Instant expiresAt) { }
    public record ConfirmedProject(ProjectPreview preview, Map<String, Object> projectPackage, Map<String, Object> cloudDraft) { }
    private record QueuedMemoryJob(String id, String conversationId, String userId, int attempts) { }
}
