package com.dramaip.platform.ai.service;

import com.dramaip.platform.ai.AiProperties;
import com.dramaip.platform.ai.client.QuotaClient;
import com.dramaip.platform.common.web.BusinessException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.FutureTask;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * A provider call is deliberately outside a database transaction. PostgreSQL is
 * used only for the durable idempotency/audit claim; quota is then reserved and
 * settled (or released) by its own idempotent service operations.
 */
@Service
public class ChatService {
    private static final String PROVIDER = "openai-compatible";
    private final AiProperties properties;
    private final QuotaClient quota;
    private final RestClient restClient;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final HttpClient streamClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ExecutorService streams = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor();
    private final ConcurrentHashMap<String, FutureTask<Void>> activeStreams = new ConcurrentHashMap<>();

    public ChatService(AiProperties properties, QuotaClient quota, RestClient.Builder restClient, JdbcTemplate jdbc, ObjectMapper json) {
        this.properties = properties;
        this.quota = quota;
        this.restClient = restClient.build();
        this.jdbc = jdbc;
        this.json = json;
    }

    public List<String> models() {
        return Arrays.stream(properties.getModels().split(",")).map(String::trim).filter(value -> !value.isBlank()).toList();
    }

    public Preflight preflight(String model, int maxTokens) {
        if (!models().contains(model)) throw new BusinessException("AI_MODEL_UNAVAILABLE", "model is not enabled", HttpStatus.NOT_FOUND);
        return new Preflight(model, Math.max(1, Math.min(maxTokens, 32_768)), "ready");
    }

    public Chat chat(String userId, String idempotencyKey, String model, List<Message> messages, int maxTokens) {
        return execute(userId, idempotencyKey, model, messages, maxTokens, null);
    }

    /** Exposes only persisted summary fields; prompt text is never read back or stored. */
    public Chat status(String userId, String idempotencyKey) {
        Audit audit = audit(userId, idempotencyKey);
        if (audit == null) throw new BusinessException("AI_CHAT_NOT_FOUND", "chat request not found", HttpStatus.NOT_FOUND);
        return asChat(audit);
    }

    /** Cancelling a completed request is a no-op. An active SSE task is interrupted before its quota compensation runs. */
    public CancelResult cancel(String userId, String idempotencyKey) {
        String key = activeKey(userId, idempotencyKey);
        FutureTask<Void> active = activeStreams.get(key);
        if (active != null && active.cancel(true)) return new CancelResult("cancellationRequested");
        Audit audit = audit(userId, idempotencyKey);
        return new CancelResult(audit == null ? "notFound" : audit.status());
    }

    /** Existing cost alerts are read through the migrated service without exposing provider payloads. */
    public List<CostAlert> costAlerts(String userId, int limit) {
        return jdbc.query("""
                select id::text, audit_id::text, event_type, observed_cost_cny::text, threshold_cny::text, created_at
                from ai_gateway.provider_cost_alerts where user_id = ?::uuid
                order by created_at desc limit ?
                """, (rs, row) -> new CostAlert(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getObject(6, Instant.class)),
                userId, Math.max(1, Math.min(limit, 200)));
    }

    /**
     * Uses the upstream OpenAI-compatible event stream rather than buffering a
     * completion. The persisted audit and quota settlement happen only after
     * the provider emits its terminal usage event.
     */
    public SseEmitter stream(String userId, String idempotencyKey, String model, List<Message> messages, int maxTokens) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new BusinessException("AI_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", HttpStatus.BAD_REQUEST);
        }
        SseEmitter emitter = new SseEmitter(0L);
        String key = activeKey(userId, idempotencyKey);
        FutureTask<Void> task = new FutureTask<>(() -> {
            try {
                emit(emitter, "started", Map.of("requestId", idempotencyKey));
                Chat result = execute(userId, idempotencyKey, model, messages, maxTokens,
                        delta -> emit(emitter, "delta", Map.of("requestId", idempotencyKey, "delta", delta)));
                emit(emitter, "completed", Map.of("requestId", result.requestId(), "reply", result));
                emitter.complete();
            } catch (ChatCancelledException exception) {
                emitQuietly(emitter, "canceled", Map.of("requestId", idempotencyKey, "code", "AI_CHAT_CANCELLED"));
                emitter.complete();
            } catch (BusinessException exception) {
                emitQuietly(emitter, "failed", Map.of("requestId", idempotencyKey, "code", exception.code()));
                emitter.complete();
            } catch (RuntimeException exception) {
                emitQuietly(emitter, "failed", Map.of("requestId", idempotencyKey, "code", "AI_PROVIDER_FAILED"));
                emitter.complete();
            } finally {
                activeStreams.remove(key);
            }
            return null;
        });
        if (activeStreams.putIfAbsent(key, task) != null) {
            throw new BusinessException("AI_REQUEST_IN_PROGRESS", "request is already streaming", HttpStatus.CONFLICT);
        }
        emitter.onCompletion(() -> activeStreams.remove(key, task));
        emitter.onTimeout(() -> task.cancel(true));
        streams.execute(task);
        return emitter;
    }

    private Chat execute(String userId, String idempotencyKey, String model, List<Message> messages, int maxTokens, Consumer<String> delta) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new BusinessException("AI_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required", HttpStatus.BAD_REQUEST);
        }
        Preflight preflight = preflight(model, maxTokens);
        String hash = requestHash(model, messages, preflight.maxTokens());
        Audit existing = audit(userId, idempotencyKey);
        if (existing != null) return replay(existing, hash);
        Claim claim = claim(userId, idempotencyKey, hash, model);
        if (!claim.created()) return replay(claim.audit(), hash);
        Audit claimed = claim.audit();

        QuotaClient.Reservation reservation = null;
        try {
            requireProvider();
            reservation = quota.reserve(new QuotaClient.ReserveRequest(idempotencyKey, estimateTokens(messages, preflight.maxTokens()))).data();
            jdbc.update("update ai_gateway.request_audits set reservation_id = ?::uuid, updated_at = now() where id = ?::uuid", reservation.id(), claimed.id());
            ProviderReply reply = delta == null
                    ? providerCompletion(model, messages, preflight.maxTokens())
                    : providerStream(model, messages, preflight.maxTokens(), delta);
            QuotaClient.Usage usage = quota.settle(reservation.id(), new QuotaClient.SettleRequest(idempotencyKey, model, reply.promptTokens(), reply.completionTokens())).data();
            jdbc.update("""
                    update ai_gateway.request_audits
                    set prompt_tokens = ?, completion_tokens = ?, total_tokens = ?, status = 'succeeded',
                        response_payload = jsonb_build_object('content', ?), finished_at = now(), updated_at = now()
                    where id = ?::uuid
                    """, reply.promptTokens(), reply.completionTokens(), usage.totalTokens(), reply.content(), claimed.id());
            return new Chat(idempotencyKey, PROVIDER, model, reply.content(), reply.promptTokens(), reply.completionTokens(), usage.totalTokens(), reservation.id(), "succeeded");
        } catch (ChatCancelledException exception) {
            compensate(userId, reservation, claimed.id(), "canceled", "author canceled generation");
            throw exception;
        } catch (RuntimeException exception) {
            compensate(userId, reservation, claimed.id(), "failed", safeError(exception));
            throw exception;
        }
    }

    private Claim claim(String userId, String idempotencyKey, String requestHash, String model) {
        String id = UUID.randomUUID().toString();
        try {
            int inserted = jdbc.update("""
                    insert into ai_gateway.request_audits(id, user_id, request_id, idempotency_key, request_hash, provider, model, status)
                    values (?::uuid, ?::uuid, ?, ?, ?, ?, ?, 'in_progress') on conflict (user_id, idempotency_key) do nothing
                    """, id, userId, idempotencyKey, idempotencyKey, requestHash, PROVIDER, model);
            if (inserted == 1) return new Claim(new Audit(id, idempotencyKey, idempotencyKey, requestHash, PROVIDER, model, "", "", 0, 0, 0, "in_progress"), true);
        } catch (DataIntegrityViolationException ignored) {
            // The unique index is the durable race arbiter; read the winning claim below.
        }
        Audit winner = audit(userId, idempotencyKey);
        if (winner == null) throw new BusinessException("AI_AUDIT_CLAIM_FAILED", "could not claim chat request", HttpStatus.SERVICE_UNAVAILABLE);
        return new Claim(winner, false);
    }

    private Chat replay(Audit audit, String requestHash) {
        if (!audit.requestHash().equals(requestHash)) {
            throw new BusinessException("AI_IDEMPOTENCY_CONFLICT", "idempotency key was used with a different request", HttpStatus.CONFLICT);
        }
        if ("succeeded".equals(audit.status())) return asChat(audit);
        if ("in_progress".equals(audit.status())) throw new BusinessException("AI_REQUEST_IN_PROGRESS", "request is still in progress", HttpStatus.CONFLICT);
        throw new BusinessException("AI_REQUEST_NOT_REPLAYABLE", "request status is " + audit.status(), HttpStatus.CONFLICT);
    }

    private Audit audit(String userId, String idempotencyKey) {
        return jdbc.query("""
                select id::text, request_id, idempotency_key, request_hash, provider, model,
                       coalesce(reservation_id::text, ''), coalesce(response_payload->>'content', ''),
                       prompt_tokens, completion_tokens, total_tokens, status
                from ai_gateway.request_audits where user_id = ?::uuid and idempotency_key = ? limit 1
                """, rs -> rs.next() ? new Audit(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
                rs.getString(7), rs.getString(8), rs.getLong(9), rs.getLong(10), rs.getLong(11), rs.getString(12)) : null, userId, idempotencyKey);
    }

    private Chat asChat(Audit audit) {
        return new Chat(audit.requestId(), audit.provider(), audit.model(), audit.content(), audit.promptTokens(), audit.completionTokens(), audit.totalTokens(), audit.reservationId(), audit.status());
    }

    private ProviderReply providerCompletion(String model, List<Message> messages, int maxTokens) {
        JsonNode response = restClient.post().uri(endpoint())
                .contentType(MediaType.APPLICATION_JSON).header("Authorization", "Bearer " + properties.getApiKey())
                .body(new ProviderRequest(model, messages, maxTokens, false)).retrieve().body(JsonNode.class);
        if (response == null) throw new BusinessException("AI_PROVIDER_EMPTY_RESPONSE", "provider returned no response", HttpStatus.BAD_GATEWAY);
        String content = response.path("choices").path(0).path("message").path("content").asText();
        if (content.isBlank()) throw new BusinessException("AI_PROVIDER_EMPTY_RESPONSE", "provider returned no content", HttpStatus.BAD_GATEWAY);
        long prompt = response.path("usage").path("prompt_tokens").asLong(estimateTokens(messages, 0));
        long completion = response.path("usage").path("completion_tokens").asLong(Math.max(0, content.length() / 4));
        return new ProviderReply(content, prompt, completion);
    }

    private ProviderReply providerStream(String model, List<Message> messages, int maxTokens, Consumer<String> emit) {
        try {
            String body = json.writeValueAsString(new ProviderRequest(model, messages, maxTokens, true));
            HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint())).timeout(Duration.ofMinutes(5))
                    .header("Authorization", "Bearer " + properties.getApiKey()).header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream").POST(HttpRequest.BodyPublishers.ofString(body)).build();
            HttpResponse<Stream<String>> response = streamClient.send(request, HttpResponse.BodyHandlers.ofLines());
            if (response.statusCode() >= 300) throw new BusinessException("AI_PROVIDER_UNAVAILABLE", "provider stream returned " + response.statusCode(), HttpStatus.BAD_GATEWAY);
            StringBuilder content = new StringBuilder();
            long[] usage = new long[2];
            try (Stream<String> lines = response.body()) {
                lines.forEach(line -> consumeProviderLine(line, content, usage, emit));
            }
            if (Thread.currentThread().isInterrupted()) throw new ChatCancelledException();
            if (content.isEmpty()) throw new BusinessException("AI_PROVIDER_EMPTY_RESPONSE", "provider returned no stream content", HttpStatus.BAD_GATEWAY);
            return new ProviderReply(content.toString(), usage[0] == 0 ? estimateTokens(messages, 0) : usage[0], usage[1] == 0 ? Math.max(0, content.length() / 4) : usage[1]);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ChatCancelledException();
        } catch (IOException exception) {
            if (Thread.currentThread().isInterrupted()) throw new ChatCancelledException();
            throw new BusinessException("AI_PROVIDER_UNAVAILABLE", "provider stream failed", HttpStatus.BAD_GATEWAY);
        }
    }

    private void consumeProviderLine(String line, StringBuilder content, long[] usage, Consumer<String> emit) {
        if (Thread.currentThread().isInterrupted()) throw new ChatCancelledException();
        if (!line.startsWith("data:")) return;
        String data = line.substring(5).trim();
        if (data.isEmpty() || "[DONE]".equals(data)) return;
        try {
            JsonNode node = json.readTree(data);
            String delta = node.path("choices").path(0).path("delta").path("content").asText();
            if (!delta.isEmpty()) { content.append(delta); emit.accept(delta); }
            usage[0] = node.path("usage").path("prompt_tokens").asLong(usage[0]);
            usage[1] = node.path("usage").path("completion_tokens").asLong(usage[1]);
        } catch (IOException exception) {
            throw new BusinessException("AI_PROVIDER_STREAM_INVALID", "provider stream payload is invalid", HttpStatus.BAD_GATEWAY);
        }
    }

    private void compensate(String userId, QuotaClient.Reservation reservation, String auditId, String status, String error) {
        if (reservation != null) {
            try { quota.cancel(reservation.id()); } catch (RuntimeException ignored) { /* quota expiry reconciliation is idempotent */ }
        }
        jdbc.update("update ai_gateway.request_audits set status = ?, error = ?, finished_at = now(), updated_at = now() where id = ?::uuid", status, error, auditId);
    }

    private void requireProvider() {
        if (properties.getBaseUrl().isBlank() || properties.getApiKey().isBlank()) {
            throw new BusinessException("AI_PROVIDER_NOT_CONFIGURED", "no AI provider is configured", HttpStatus.SERVICE_UNAVAILABLE);
        }
    }

    private String endpoint() { return properties.getBaseUrl().replaceAll("/+$", "") + "/v1/chat/completions"; }
    private static String activeKey(String userId, String idempotencyKey) { return userId + '\u0000' + idempotencyKey; }
    private static long estimateTokens(List<Message> messages, int maxTokens) { return Math.max(1, maxTokens + messages.stream().mapToLong(message -> message.content().length() / 4L + 1).sum()); }
    private static String safeError(RuntimeException exception) { return exception instanceof BusinessException business ? business.code() : "provider call failed"; }
    private static String requestHash(String model, List<Message> messages, int maxTokens) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update((model + "\u0000" + maxTokens).getBytes(StandardCharsets.UTF_8));
            for (Message message : messages) digest.update(("\u0000" + message.role() + "\u0000" + message.content()).getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
    private static void emit(SseEmitter emitter, String type, Object data) {
        try { emitter.send(SseEmitter.event().name(type).data(data)); } catch (IOException exception) { throw new ChatCancelledException(); }
    }
    private static void emitQuietly(SseEmitter emitter, String type, Object data) { try { emit(emitter, type, data); } catch (RuntimeException ignored) { } }
    @PreDestroy void shutdownStreams() { streams.shutdownNow(); }

    public record Message(String role, String content) { }
    public record Preflight(String model, int maxTokens, String status) { }
    public record Chat(String requestId, String provider, String model, String content, long promptTokens, long completionTokens, long totalTokens, String reservationId, String status) { }
    public record CancelResult(String status) { }
    public record CostAlert(String id, String auditId, String eventType, String observedCostCny, String thresholdCny, Instant createdAt) { }
    private record Audit(String id, String requestId, String idempotencyKey, String requestHash, String provider, String model, String reservationId, String content, long promptTokens, long completionTokens, long totalTokens, String status) { }
    private record Claim(Audit audit, boolean created) { }
    private record ProviderRequest(String model, List<Message> messages, int max_tokens, boolean stream) { }
    private record ProviderReply(String content, long promptTokens, long completionTokens) { }
    private static final class ChatCancelledException extends RuntimeException { }
}
