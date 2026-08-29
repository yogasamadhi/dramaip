package com.dramaip.platform.ai.service;

import com.dramaip.platform.ai.CorpusProperties;
import com.dramaip.platform.ai.service.CorpusCrawler.CrawlException;
import com.dramaip.platform.ai.service.CorpusCrawler.FetchResult;
import com.dramaip.platform.ai.service.CorpusCrawler.RetryableCrawlException;
import com.dramaip.platform.common.web.BusinessException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class CreativeIntelligenceService {
    private static final List<String> ITEM_KINDS = List.of(
            "meme", "comic_device", "dialogue_pattern", "character_hook", "relationship_hook",
            "conflict", "reversal", "scene", "world_rule", "style", "social_observation");
    private static final List<String> FRESHNESS = List.of("emerging", "stable", "cooling", "expired", "evergreen");
    private static final List<String> DIMENSIONS = List.of(
            "humor", "genre", "tone", "pace", "conflict", "reversal", "emotional_intensity",
            "visuality", "novelty", "production_complexity");
    private static final Set<String> SENSITIVE_QUERY_KEYS = Set.of(
            "token", "access_token", "key", "api_key", "password", "secret", "signature", "auth");
    private static final Pattern WORDS = Pattern.compile("[^\\p{L}\\p{N}]+");
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final ChatService chats;
    private final CorpusCrawler crawler;
    private final CorpusProperties properties;
    private final SecureRandom random = new SecureRandom();

    public CreativeIntelligenceService(JdbcTemplate jdbc, ObjectMapper json, ChatService chats,
                                       CorpusCrawler crawler, CorpusProperties properties) {
        this.jdbc = jdbc;
        this.json = json;
        this.chats = chats;
        this.crawler = crawler;
        this.properties = properties;
    }

    public Page<CorpusItem> search(String userId, String query, String visibility, String cursor, int limit) {
        int bounded = Math.max(1, Math.min(limit, 100));
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        String mode = List.of("public", "private", "all").contains(visibility) ? visibility : "public";
        if (!properties.isPublicSearchEnabled()) {
            if (mode.equals("public")) return new Page<>(List.of(), null);
            if (mode.equals("all")) mode = "private";
        }
        String after = uuidOrNull(cursor);
        List<CorpusItem> items = jdbc.query("""
                select item.id::text, item.source_id::text, item.visibility, item.kind, item.title,
                       item.trigger_text, item.mechanism, item.emotional_effect, item.contexts,
                       item.risk_tags, item.tags, item.freshness, item.rights_status, item.locale,
                       item.tombstoned_at, item.version, item.created_at, item.updated_at
                from ai_gateway.corpus_items item
                left join ai_gateway.corpus_sources source on source.id = item.source_id
                where item.tombstoned_at is null
                  and (?::uuid is null or item.id > ?::uuid)
                  and (
                    (? in ('public','all') and item.visibility = 'public'
                      and item.rights_status = 'allowed'
                      and source.status = 'allowed' and source.rights_status = 'allowed')
                    or (? in ('private','all') and item.visibility = 'private' and item.owner_user_id = ?::uuid)
                  )
                  and (? = '' or lower(item.title) like '%' || ? || '%'
                    or lower(item.mechanism) like '%' || ? || '%'
                    or jsonb_exists_any(item.search_tokens, ?::text[]))
                order by item.id limit ?
                """, (rs, row) -> corpusItem(rs), after, after, mode, mode, userId, q, q, q,
                tokens(q).toArray(String[]::new), bounded + 1);
        String next = items.size() > bounded ? items.get(bounded - 1).id() : null;
        return new Page<>(items.stream().limit(bounded).toList(), next);
    }

    public CorpusItem createPrivateItem(String userId, ItemCreate input) {
        requireItem(input.kind(), input.title(), input.mechanism(), input.freshness());
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into ai_gateway.corpus_items(
                  id, visibility, owner_user_id, kind, title, trigger_text, mechanism,
                  emotional_effect, contexts, risk_tags, tags, search_tokens,
                  freshness, rights_status, locale)
                values (?::uuid, 'private', ?::uuid, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb,
                  ?::jsonb, ?::jsonb, ?, 'unknown', ?)
                """, id, userId, input.kind(), input.title().trim(), safe(input.trigger()), input.mechanism().trim(),
                safe(input.emotionalEffect()), write(input.contexts()), write(input.riskTags()), write(input.tags()),
                write(tokens(input.title() + " " + input.mechanism() + " " + String.join(" ", input.tags()))),
                input.freshness(), locale(input.locale()));
        return item(userId, id);
    }

    public List<CollectionItem> collections(String userId) {
        return jdbc.query("""
                select id::text, corpus_item_id::text, title, mechanism, notes, tags,
                       adopted, use_count, version, created_at, updated_at
                from ai_gateway.corpus_collections where user_id = ?::uuid
                order by updated_at desc, id desc
                """, (rs, row) -> collection(rs), userId);
    }

    public CollectionItem collect(String userId, CollectionCreate request) {
        if (request.title() == null || request.title().isBlank() || request.mechanism() == null
                || request.mechanism().isBlank()) throw invalid("collection title and mechanism are required");
        if (request.corpusItemId() != null) visibleItem(userId, request.corpusItemId());
        String id = UUID.randomUUID().toString();
        try {
            jdbc.update("""
                    insert into ai_gateway.corpus_collections(
                      id, user_id, corpus_item_id, title, mechanism, notes, tags)
                    values (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?::jsonb)
                    """, id, userId, request.corpusItemId(), request.title().trim(), request.mechanism().trim(),
                    safe(request.notes()), write(request.tags()));
        } catch (org.springframework.dao.DuplicateKeyException duplicate) {
            return jdbc.query("""
                    select id::text, corpus_item_id::text, title, mechanism, notes, tags,
                           adopted, use_count, version, created_at, updated_at
                    from ai_gateway.corpus_collections where user_id = ?::uuid and corpus_item_id = ?::uuid
                    """, rs -> rs.next() ? collection(rs) : null, userId, request.corpusItemId());
        }
        return collection(userId, id);
    }

    public Source submitSource(String userId, String rawUrl) {
        URI canonical = crawler.canonicalize(rawUrl);
        rejectSecretQuery(canonical);
        String sourceId = UUID.randomUUID().toString();
        String jobId = UUID.randomUUID().toString();
        jdbc.update("""
                insert into ai_gateway.corpus_domain_policies(domain, crawl_delay_ms)
                values (?, ?) on conflict(domain) do nothing
                """, canonical.getHost(), properties.getMinimumDomainDelayMs());
        jdbc.update("""
                insert into ai_gateway.corpus_sources(id, submitted_by, canonical_url, domain)
                values (?::uuid, ?::uuid, ?, ?)
                on conflict(canonical_url) do nothing
                """, sourceId, userId, canonical.toString(), canonical.getHost());
        Source source = sourceByUrl(canonical.toString());
        jdbc.update("""
                insert into ai_gateway.corpus_ingestion_jobs(id, source_id, depth)
                values (?::uuid, ?::uuid, 0) on conflict(source_id) do nothing
                """, jobId, source.id());
        return source;
    }

    public Fingerprint fingerprint(String userId) {
        ensureFingerprint(userId);
        FingerprintSettings settings = jdbc.query("""
                select enabled, consented_at, avoidances, goals, version, updated_at
                from ai_gateway.creative_fingerprint_settings where user_id = ?::uuid
                """, rs -> rs.next() ? new FingerprintSettings(rs.getBoolean(1), instant(rs, 2), strings(rs.getString(3)),
                strings(rs.getString(4)), rs.getInt(5), rs.getTimestamp(6).toInstant()) : null, userId);
        List<Dimension> dimensions = jdbc.query("""
                select dimension_key, score, confidence, frozen, evidence_ids, updated_at
                from ai_gateway.creative_fingerprint_dimensions where user_id = ?::uuid order by dimension_key
                """, (rs, row) -> new Dimension(rs.getString(1), rs.getDouble(2), rs.getDouble(3), rs.getBoolean(4),
                strings(rs.getString(5)), rs.getTimestamp(6).toInstant()), userId);
        return new Fingerprint(settings.enabled(), settings.consentedAt(), dimensions, settings.avoidances(),
                settings.goals(), settings.version(), settings.updatedAt());
    }

    public Fingerprint setFingerprintEnabled(String userId, boolean enabled) {
        ensureFingerprint(userId);
        jdbc.update("""
                update ai_gateway.creative_fingerprint_settings
                set enabled = ?, consented_at = case when ? then coalesce(consented_at, now()) else consented_at end,
                    version = version + 1, updated_at = now() where user_id = ?::uuid
                """, enabled, enabled, userId);
        return fingerprint(userId);
    }

    public Fingerprint updateFingerprint(String userId, int version, List<DimensionPatch> dimensions,
                                         List<String> avoidances, List<String> goals) {
        Fingerprint current = fingerprint(userId);
        if (current.version() != version) throw conflict("CREATIVE_FINGERPRINT_CONFLICT", "creative fingerprint was updated");
        for (DimensionPatch dimension : dimensions == null ? List.<DimensionPatch>of() : dimensions) {
            if (!DIMENSIONS.contains(dimension.key())) throw invalid("unknown fingerprint dimension");
            if (dimension.score() != null && (dimension.score() < 0 || dimension.score() > 1)) throw invalid("dimension score is invalid");
            jdbc.update("""
                    update ai_gateway.creative_fingerprint_dimensions
                    set score = coalesce(?, score), frozen = coalesce(?, frozen), updated_at = now()
                    where user_id = ?::uuid and dimension_key = ?
                    """, dimension.score(), dimension.frozen(), userId, dimension.key());
        }
        jdbc.update("""
                update ai_gateway.creative_fingerprint_settings
                set avoidances = coalesce(?::jsonb, avoidances), goals = coalesce(?::jsonb, goals),
                    version = version + 1, updated_at = now() where user_id = ?::uuid
                """, avoidances == null ? null : write(avoidances), goals == null ? null : write(goals), userId);
        return fingerprint(userId);
    }

    public void clearFingerprint(String userId) {
        ensureFingerprint(userId);
        jdbc.update("""
                update ai_gateway.creative_fingerprint_settings set enabled = false, consented_at = null,
                  avoidances = '[]', goals = '[]', version = version + 1, updated_at = now()
                where user_id = ?::uuid
                """, userId);
        jdbc.update("""
                update ai_gateway.creative_fingerprint_dimensions set score = 0.5, confidence = 0,
                  frozen = false, evidence_ids = '[]', updated_at = now() where user_id = ?::uuid
                """, userId);
    }

    public Page<Experiment> experiments(String userId, String cursor, int limit) {
        int bounded = Math.max(1, Math.min(limit, 100));
        String after = uuidOrNull(cursor);
        List<Experiment> items = jdbc.query("""
                select id::text, origin_type, origin_id, prompt, strategy_version, model, status,
                       prompt_tokens, completion_tokens, version, created_at, updated_at
                from ai_gateway.creative_experiments
                where user_id = ?::uuid and (?::uuid is null or id > ?::uuid)
                order by id limit ?
                """, (rs, row) -> experiment(userId, rs), userId, after, after, bounded + 1);
        String next = items.size() > bounded ? items.get(bounded - 1).id() : null;
        return new Page<>(items.stream().limit(bounded).toList(), next);
    }

    public Experiment createExperiment(String userId, String key, ExperimentCreate request) {
        if (!properties.isExperimentsEnabled()) {
            throw new BusinessException("CREATIVE_EXPERIMENTS_DISABLED", "creative experiments are not enabled",
                    HttpStatus.SERVICE_UNAVAILABLE);
        }
        Experiment existing = jdbc.query("""
                select id::text, origin_type, origin_id, prompt, strategy_version, model, status,
                       prompt_tokens, completion_tokens, version, created_at, updated_at
                from ai_gateway.creative_experiments where user_id = ?::uuid and idempotency_key = ?
                """, rs -> rs.next() ? experiment(userId, rs) : null, userId, key);
        if (existing != null) return existing;
        if (request.prompt() == null || request.prompt().isBlank() || request.prompt().length() > 20_000) throw invalid("experiment prompt is invalid");
        if (!List.of("inspiration", "corpus").contains(request.originType())) throw invalid("experiment origin is invalid");
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                insert into ai_gateway.creative_experiments(
                  id, user_id, origin_type, origin_id, prompt, model, status, idempotency_key)
                values (?::uuid, ?::uuid, ?, ?, ?, ?, 'running', ?)
                """, id, userId, request.originType(), request.originId(), request.prompt().trim(), request.model(), key);
        long promptTokens = 0;
        long completionTokens = 0;
        try {
            for (Lane lane : Lane.values()) {
                String instruction = lane.instruction() + "\n创意原点：" + request.prompt().trim()
                        + "\n只输出可供创作者比较的方案正文，不引用完整外部原文。";
                ChatService.Chat answer = chats.chat(userId, key + ":" + lane.id(), request.model(),
                        List.of(new ChatService.Message("user", instruction)), request.maxTokens());
                promptTokens += answer.promptTokens();
                completionTokens += answer.completionTokens();
                jdbc.update("""
                        insert into ai_gateway.creative_experiment_variants(
                          id, experiment_id, lane, title, content, scores)
                        values (gen_random_uuid(), ?::uuid, ?, ?, ?, ?::jsonb)
                        """, id, lane.id(), lane.title(), answer.content(), write(scores(request.prompt(), lane.id())));
            }
            jdbc.update("""
                    update ai_gateway.creative_experiments set status = 'ready', prompt_tokens = ?,
                      completion_tokens = ?, updated_at = now() where id = ?::uuid
                    """, promptTokens, completionTokens, id);
        } catch (RuntimeException failure) {
            jdbc.update("update ai_gateway.creative_experiments set status = 'failed', updated_at = now() where id = ?::uuid", id);
            throw failure;
        }
        return experiment(userId, id);
    }

    public Experiment reviewExperiment(String userId, String id, int version, String selectedVariantId, boolean rejected) {
        Experiment current = experiment(userId, id);
        if (current.version() != version) throw conflict("CREATIVE_EXPERIMENT_CONFLICT", "experiment was already reviewed");
        Variant selected = selectedVariantId == null ? null : current.variants().stream()
                .filter(value -> value.id().equals(selectedVariantId)).findFirst().orElse(null);
        if (!rejected && selected == null) throw invalid("selected variant is required");
        jdbc.update("update ai_gateway.creative_experiment_variants set selected = (id = ?::uuid) where experiment_id = ?::uuid",
                selectedVariantId, id);
        jdbc.update("""
                update ai_gateway.creative_experiments set status = ?, version = version + 1, updated_at = now()
                where id = ?::uuid and user_id = ?::uuid and version = ?
                """, rejected ? "rejected" : "completed", id, userId, version);
        if (selected != null) applyFingerprintEvidence(userId, id, selected);
        return experiment(userId, id);
    }

    public List<Source> adminSources(int limit) {
        return jdbc.query("""
                select id::text, submitted_by::text, canonical_url, domain, title, excerpt, content_hash,
                       status, rights_status, locale, http_status, retrieved_at, last_error_code,
                       version, created_at, updated_at
                from ai_gateway.corpus_sources order by updated_at desc, id desc limit ?
                """, (rs, row) -> source(rs), Math.max(1, Math.min(limit, 200)));
    }

    public List<IngestionJob> adminJobs(int limit) {
        return jdbc.query("""
                select id::text, source_id::text, depth, status, attempts, next_attempt_at,
                       lease_until, error_code, created_at, updated_at, finished_at
                from ai_gateway.corpus_ingestion_jobs order by updated_at desc, id desc limit ?
                """, (rs, row) -> job(rs), Math.max(1, Math.min(limit, 200)));
    }

    public Source adminSubmit(String rawUrl) {
        URI canonical = crawler.canonicalize(rawUrl);
        rejectSecretQuery(canonical);
        String sourceId = UUID.randomUUID().toString();
        jdbc.update("""
                insert into ai_gateway.corpus_domain_policies(domain, crawl_delay_ms)
                values (?, ?) on conflict(domain) do nothing
                """, canonical.getHost(), properties.getMinimumDomainDelayMs());
        jdbc.update("""
                insert into ai_gateway.corpus_sources(id, canonical_url, domain)
                values (?::uuid, ?, ?) on conflict(canonical_url) do nothing
                """, sourceId, canonical.toString(), canonical.getHost());
        Source source = sourceByUrl(canonical.toString());
        jdbc.update("""
                insert into ai_gateway.corpus_ingestion_jobs(id, source_id, depth)
                values (gen_random_uuid(), ?::uuid, 0) on conflict(source_id) do nothing
                """, source.id());
        return source;
    }

    public Source governSource(String id, int version, String action, String reason) {
        Source current = source(id);
        if (current.version() != version) throw conflict("CORPUS_SOURCE_CONFLICT", "source was updated");
        if (action.equals("allow") && (current.retrievedAt() == null || current.contentHash() == null)) {
            throw invalid("a source must be fetched and hashed before it can be published");
        }
        String status;
        String rights;
        switch (action) {
            case "allow" -> { status = "allowed"; rights = "allowed"; }
            case "block" -> { status = "blocked"; rights = "restricted"; }
            case "takedown" -> { status = "takedown"; rights = "removed"; }
            default -> throw invalid("unknown corpus governance action");
        }
        if (!action.equals("takedown"))
            jdbc.update("""
                    insert into ai_gateway.corpus_domain_policies(domain, status, robots_allowed, reason)
                    values (?, ?, ?, ?)
                    on conflict(domain) do update set status = excluded.status,
                      robots_allowed = excluded.robots_allowed, reason = excluded.reason,
                      version = ai_gateway.corpus_domain_policies.version + 1, updated_at = now()
                    """, current.domain(), action.equals("block") ? "blocked" : "allowed",
                    action.equals("allow"), reason == null ? null : truncate(reason, 500));
        if (action.equals("block")) {
            jdbc.update("""
                    update ai_gateway.corpus_sources set status = 'blocked', rights_status = 'restricted',
                      excerpt = null, version = version + 1, updated_at = now(), last_error_code = ?
                    where domain = ?
                    """, reason == null ? "DOMAIN_BLOCKED" : "GOVERNANCE:" + truncate(reason, 80), current.domain());
            jdbc.update("""
                    update ai_gateway.corpus_items set rights_status = 'removed',
                      tombstoned_at = coalesce(tombstoned_at, now()), version = version + 1,
                      updated_at = now() where source_id in (
                        select id from ai_gateway.corpus_sources where domain = ?)
                    """, current.domain());
            jdbc.update("""
                    delete from ai_gateway.corpus_source_bodies where source_id in (
                      select id from ai_gateway.corpus_sources where domain = ?)
                    """, current.domain());
            return source(id);
        }
        jdbc.update("""
                update ai_gateway.corpus_sources set status = ?, rights_status = ?, version = version + 1,
                  updated_at = now(), last_error_code = ? where id = ?::uuid and version = ?
                """, status, rights, reason == null ? null : "GOVERNANCE:" + truncate(reason, 80), id, version);
        jdbc.update("""
                update ai_gateway.corpus_items set rights_status = ?,
                  tombstoned_at = case when ? = 'takedown' then now() else tombstoned_at end,
                  version = version + 1, updated_at = now() where source_id = ?::uuid
                """, rights, status, id);
        if (action.equals("takedown")) {
            jdbc.update("delete from ai_gateway.corpus_source_bodies where source_id = ?::uuid", id);
            jdbc.update("update ai_gateway.corpus_sources set excerpt = null where id = ?::uuid", id);
        }
        return source(id);
    }

    public Map<String, Object> snapshot() {
        String privateKey = properties.getSnapshotPrivateKeyPem();
        if (privateKey == null || privateKey.isBlank()) {
            throw new BusinessException("CORPUS_SNAPSHOT_UNAVAILABLE", "corpus snapshot signing key is unavailable", HttpStatus.SERVICE_UNAVAILABLE);
        }
        List<Map<String, Object>> sources = jdbc.query("""
                select id::text, canonical_url, domain, title, excerpt, content_hash, status,
                       rights_status, locale, retrieved_at, created_at, updated_at
                from ai_gateway.corpus_sources where status = 'allowed' and rights_status = 'allowed'
                order by id
                """, (rs, row) -> linked(
                "id", rs.getString(1), "url", rs.getString(2), "domain", rs.getString(3), "title", rs.getString(4),
                "excerpt", rs.getString(5), "contentHash", rs.getString(6), "status", rs.getString(7),
                "rightsStatus", rs.getString(8), "locale", rs.getString(9), "retrievedAt", instant(rs, 10).toString(),
                "createdAt", rs.getTimestamp(11).toInstant().toString(), "updatedAt", rs.getTimestamp(12).toInstant().toString()));
        List<Map<String, Object>> items = jdbc.query("""
                select id::text, source_id::text, visibility, kind, title, trigger_text, mechanism,
                       emotional_effect, contexts, risk_tags, tags, freshness, rights_status, locale,
                       tombstoned_at, created_at, updated_at
                from ai_gateway.corpus_items where visibility = 'public' and rights_status = 'allowed'
                order by id
                """, (rs, row) -> {
            Map<String, Object> value = linked(
                    "id", rs.getString(1), "sourceId", rs.getString(2), "visibility", rs.getString(3),
                    "kind", rs.getString(4), "title", rs.getString(5), "trigger", rs.getString(6),
                    "mechanism", rs.getString(7), "emotionalEffect", rs.getString(8),
                    "contexts", strings(rs.getString(9)), "riskTags", strings(rs.getString(10)),
                    "tags", strings(rs.getString(11)), "freshness", rs.getString(12),
                    "rightsStatus", rs.getString(13), "locale", rs.getString(14),
                    "createdAt", rs.getTimestamp(16).toInstant().toString(), "updatedAt", rs.getTimestamp(17).toInstant().toString());
            Instant tombstone = instant(rs, 15);
            if (tombstone != null) value.put("tombstonedAt", tombstone.toString());
            return value;
        });
        List<String> tombstones = jdbc.query("""
                select id::text from ai_gateway.corpus_items
                where visibility = 'public' and tombstoned_at is not null order by id
                """, (rs, row) -> rs.getString(1));
        String version = Instant.now().truncatedTo(ChronoUnit.SECONDS).toString();
        Map<String, Object> unsigned = linked("format", "dramaip-creative-corpus-snapshot", "schemaVersion", 1,
                "version", version, "sources", sources, "items", items, "tombstones", tombstones);
        Map<String, Object> signed = new LinkedHashMap<>(unsigned);
        signed.put("signature", sign(writeBytes(unsigned), privateKey));
        return signed;
    }

    @Scheduled(fixedDelayString = "${dramaip.corpus.worker-delay-ms:10000}")
    public void processNextJob() {
        if (!properties.isCrawlerEnabled()) return;
        IngestionJob claimed = jdbc.query("""
                with candidate as materialized (
                  select job.id, source.domain,
                    coalesce(policy.crawl_delay_ms, ?) as crawl_delay_ms
                  from ai_gateway.corpus_ingestion_jobs job
                  join ai_gateway.corpus_sources source on source.id = job.source_id
                  join ai_gateway.corpus_domain_policies policy on policy.domain = source.domain
                  where job.status in ('pending','failed') and job.next_attempt_at <= now() and job.attempts < 5
                    and policy.next_crawl_at <= now()
                  order by job.next_attempt_at, job.created_at
                  for update of job, policy skip locked limit 1
                ), claimed_domain as (
                  update ai_gateway.corpus_domain_policies policy
                  set next_crawl_at = now() + candidate.crawl_delay_ms * interval '1 millisecond',
                    updated_at = now()
                  from candidate where policy.domain = candidate.domain
                  returning candidate.id
                )
                update ai_gateway.corpus_ingestion_jobs job
                set status = 'running', attempts = attempts + 1, lease_until = now() + interval '2 minutes', updated_at = now()
                from claimed_domain where job.id = claimed_domain.id
                returning job.id::text, job.source_id::text, job.depth, job.status, job.attempts,
                          job.next_attempt_at, job.lease_until, job.error_code, job.created_at, job.updated_at, job.finished_at
                """, rs -> rs.next() ? job(rs) : null, properties.getMinimumDomainDelayMs());
        if (claimed == null) return;
        Source source = source(claimed.sourceId());
        try {
            String domainStatus = jdbc.query("""
                    select status from ai_gateway.corpus_domain_policies where domain = ?
                    """, rs -> rs.next() ? rs.getString(1) : null, source.domain());
            if (List.of("blocked", "takedown").contains(domainStatus)) {
                throw new CrawlException("DOMAIN_BLOCKED", "domain policy blocks collection");
            }
            ConditionalHeaders conditional = jdbc.query("""
                    select etag, last_modified from ai_gateway.corpus_sources where id = ?::uuid
                    """, rs -> rs.next() ? new ConditionalHeaders(rs.getString(1), rs.getString(2))
                    : new ConditionalHeaders(null, null), source.id());
            FetchResult fetched = crawler.fetch(source.canonicalUrl(), conditional.etag(), conditional.lastModified());
            if (fetched.status() == 304) {
                jdbc.update("""
                        update ai_gateway.corpus_sources
                        set status = case when status = 'allowed' then 'allowed' else 'fetched' end,
                          http_status = 304,
                          retrieved_at = now(), last_error_code = null, version = version + 1,
                          updated_at = now() where id = ?::uuid
                        """, source.id());
                jdbc.update("""
                        update ai_gateway.corpus_ingestion_jobs set status = 'completed', lease_until = null,
                          error_code = null, finished_at = now(), updated_at = now() where id = ?::uuid
                        """, claimed.id());
                return;
            }
            EncryptedBody encrypted = encrypt(fetched.body());
            String excerpt = truncateCodePoints(fetched.text(), 500);
            String hash = sha256(fetched.body());
            jdbc.update("""
                    update ai_gateway.corpus_sources set canonical_url = ?, domain = ?, title = ?, excerpt = ?,
                      content_hash = ?, etag = ?, last_modified = ?, http_status = ?, retrieved_at = now(),
                      status = case when status = 'allowed' then 'allowed' else 'fetched' end,
                      rights_status = case when rights_status = 'allowed' then 'allowed' else 'review_required' end,
                      last_error_code = null,
                      version = version + 1, updated_at = now() where id = ?::uuid
                    """, fetched.canonicalUrl().toString(), fetched.canonicalUrl().getHost(), truncate(fetched.title(), 500),
                    excerpt, hash, fetched.etag(), fetched.lastModified(), fetched.status(), source.id());
            jdbc.update("""
                    insert into ai_gateway.corpus_domain_policies(
                      domain, status, robots_checked_at, robots_allowed, crawl_delay_ms)
                    values (?, 'quarantined', now(), true, ?)
                    on conflict(domain) do update set robots_checked_at = now(), robots_allowed = true,
                      crawl_delay_ms = greatest(ai_gateway.corpus_domain_policies.crawl_delay_ms, excluded.crawl_delay_ms),
                      next_crawl_at = greatest(ai_gateway.corpus_domain_policies.next_crawl_at,
                        now() + excluded.crawl_delay_ms * interval '1 millisecond'),
                      updated_at = now()
                    """, fetched.canonicalUrl().getHost(),
                    (int) Math.min(Integer.MAX_VALUE, fetched.crawlDelayMs()));
            jdbc.update("""
                    insert into ai_gateway.corpus_source_bodies(
                      source_id, ciphertext, nonce, key_version, content_type, expires_at)
                    values (?::uuid, ?, ?, ?, ?, now() + interval '7 days')
                    on conflict(source_id) do update set ciphertext = excluded.ciphertext, nonce = excluded.nonce,
                      key_version = excluded.key_version, content_type = excluded.content_type,
                      expires_at = excluded.expires_at, created_at = now()
                    """, source.id(), encrypted.ciphertext(), encrypted.nonce(), properties.getEncryptionKeyVersion(),
                    fetched.contentType());
            upsertExtractedItem(source, fetched, excerpt);
            enqueueLinks(claimed, source, fetched.links());
            jdbc.update("""
                    update ai_gateway.corpus_ingestion_jobs set status = 'completed', lease_until = null,
                      error_code = null, finished_at = now(), updated_at = now() where id = ?::uuid
                    """, claimed.id());
        } catch (RetryableCrawlException retryable) {
            jdbc.update("""
                    update ai_gateway.corpus_ingestion_jobs set status = 'failed', lease_until = null,
                      error_code = ?, next_attempt_at = ?, updated_at = now() where id = ?::uuid
                    """, retryable.code(), java.sql.Timestamp.from(retryable.retryAt()), claimed.id());
            jdbc.update("""
                    update ai_gateway.corpus_sources set status = 'failed', last_error_code = ?,
                      updated_at = now() where id = ?::uuid
                    """, retryable.code(), source.id());
        } catch (CrawlException blocked) {
            jdbc.update("""
                    update ai_gateway.corpus_ingestion_jobs set status = 'blocked', lease_until = null,
                      error_code = ?, finished_at = now(), updated_at = now() where id = ?::uuid
                    """, blocked.code(), claimed.id());
            jdbc.update("""
                    update ai_gateway.corpus_sources set status = 'blocked', last_error_code = ?,
                      updated_at = now() where id = ?::uuid
                    """, blocked.code(), source.id());
        } catch (RuntimeException failed) {
            jdbc.update("""
                    update ai_gateway.corpus_ingestion_jobs set status = 'failed', lease_until = null,
                      error_code = 'INTERNAL_ERROR', next_attempt_at = now() + interval '5 minutes', updated_at = now()
                    where id = ?::uuid
                    """, claimed.id());
            jdbc.update("""
                    update ai_gateway.corpus_sources set status = 'failed', last_error_code = 'INTERNAL_ERROR',
                      updated_at = now() where id = ?::uuid
                    """, source.id());
        }
    }

    @Scheduled(fixedDelayString = "${dramaip.corpus.purge-delay-ms:3600000}")
    public void purgeExpiredBodies() {
        jdbc.update("delete from ai_gateway.corpus_source_bodies where expires_at <= now()");
        jdbc.update("""
                update ai_gateway.corpus_ingestion_jobs set status = 'failed', lease_until = null,
                  error_code = 'LEASE_EXPIRED', next_attempt_at = now(), updated_at = now()
                where status = 'running' and lease_until < now()
                """);
    }

    private EncryptedBody encrypt(byte[] plaintext) {
        try {
            byte[] key = Base64.getDecoder().decode(properties.getEncryptionKeyBase64());
            if (key.length != 32) throw new IllegalArgumentException("key length");
            byte[] nonce = new byte[12];
            random.nextBytes(nonce);
            SecretKey secret = new SecretKeySpec(key, "AES");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secret, new GCMParameterSpec(128, nonce));
            return new EncryptedBody(cipher.doFinal(plaintext), nonce);
        } catch (Exception error) {
            throw new CrawlException("ENCRYPTION_KEY_UNAVAILABLE", "temporary source encryption is unavailable");
        }
    }

    private void upsertExtractedItem(Source source, FetchResult fetched, String excerpt) {
        String itemId = UUID.nameUUIDFromBytes(("corpus:" + source.id()).getBytes(StandardCharsets.UTF_8)).toString();
        String mechanism = extractedMechanism(fetched.title(), excerpt);
        jdbc.update("""
                insert into ai_gateway.corpus_items(
                  id, source_id, visibility, kind, title, mechanism, contexts, risk_tags, tags,
                  search_tokens, freshness, rights_status, locale)
                values (?::uuid, ?::uuid, 'public', 'social_observation', ?, ?, '[]', '[]', ?::jsonb,
                  ?::jsonb, 'stable', 'review_required', ?)
                on conflict(id) do update set title = excluded.title, mechanism = excluded.mechanism,
                  tags = excluded.tags, search_tokens = excluded.search_tokens,
                  rights_status = case when corpus_items.rights_status = 'allowed' then 'allowed' else 'review_required' end,
                  version = ai_gateway.corpus_items.version + 1, updated_at = now()
                """, itemId, source.id(), truncate(fetched.title(), 240), mechanism,
                write(List.of(source.domain())), write(tokens(fetched.title() + " " + mechanism)), source.locale());
        if (source.submittedBy() != null) {
            String privateId = UUID.nameUUIDFromBytes(("private-corpus:" + source.submittedBy() + ":" + source.id())
                    .getBytes(StandardCharsets.UTF_8)).toString();
            jdbc.update("""
                    insert into ai_gateway.corpus_items(
                      id, source_id, visibility, owner_user_id, kind, title, mechanism, contexts,
                      risk_tags, tags, search_tokens, freshness, rights_status, locale)
                    values (?::uuid, ?::uuid, 'private', ?::uuid, 'social_observation', ?, ?, '[]', '[]',
                      ?::jsonb, ?::jsonb, 'stable', 'review_required', ?)
                    on conflict(id) do update set title = excluded.title, mechanism = excluded.mechanism,
                      tags = excluded.tags, search_tokens = excluded.search_tokens,
                      version = ai_gateway.corpus_items.version + 1, updated_at = now()
                    """, privateId, source.id(), source.submittedBy(), truncate(fetched.title(), 240), mechanism,
                    write(List.of(source.domain())), write(tokens(fetched.title() + " " + mechanism)), source.locale());
        }
    }

    private void enqueueLinks(IngestionJob parent, Source source, List<URI> links) {
        if (parent.depth() >= properties.getMaxDepth()) return;
        int accepted = 0;
        for (URI link : links) {
            if (accepted >= 20) break;
            if (!source.domain().equalsIgnoreCase(link.getHost())) continue;
            URI canonical;
            try {
                canonical = crawler.canonicalize(link.toString());
                rejectSecretQuery(canonical);
            } catch (RuntimeException ignored) {
                continue;
            }
            String sourceId = UUID.randomUUID().toString();
            jdbc.update("""
                    insert into ai_gateway.corpus_sources(id, canonical_url, domain)
                    values (?::uuid, ?, ?) on conflict(canonical_url) do nothing
                    """, sourceId, canonical.toString(), canonical.getHost());
            Source child = sourceByUrl(canonical.toString());
            jdbc.update("""
                    insert into ai_gateway.corpus_ingestion_jobs(id, source_id, parent_job_id, depth)
                    values (gen_random_uuid(), ?::uuid, ?::uuid, ?) on conflict(source_id) do nothing
                    """, child.id(), parent.id(), parent.depth() + 1);
            accepted++;
        }
    }

    private void applyFingerprintEvidence(String userId, String experimentId, Variant selected) {
        if (!properties.isPersonalizationEnabled()) return;
        Fingerprint profile = fingerprint(userId);
        if (!profile.enabled()) return;
        Map<String, Double> values = Map.of(
                "novelty", selected.scores().getOrDefault("novelty", 50.0) / 100,
                "conflict", selected.scores().getOrDefault("emotional_hook", 50.0) / 100,
                "reversal", selected.scores().getOrDefault("audience_surprise", 50.0) / 100,
                "production_complexity", 1 - selected.scores().getOrDefault("production_feasibility", 50.0) / 100);
        for (Map.Entry<String, Double> entry : values.entrySet()) {
            jdbc.update("""
                    update ai_gateway.creative_fingerprint_dimensions
                    set score = case when confidence = 0 then ? else score * 0.75 + ? * 0.25 end,
                        confidence = least(1, confidence + 0.1),
                        evidence_ids = case when jsonb_exists(evidence_ids, ?) then evidence_ids
                          else evidence_ids || to_jsonb(?::text) end,
                        updated_at = now()
                    where user_id = ?::uuid and dimension_key = ? and frozen = false
                    """, entry.getValue(), entry.getValue(), experimentId, experimentId, userId, entry.getKey());
        }
        jdbc.update("update ai_gateway.creative_fingerprint_settings set version = version + 1, updated_at = now() where user_id = ?::uuid", userId);
    }

    private Experiment experiment(String userId, String id) {
        Experiment value = jdbc.query("""
                select id::text, origin_type, origin_id, prompt, strategy_version, model, status,
                       prompt_tokens, completion_tokens, version, created_at, updated_at
                from ai_gateway.creative_experiments where id = ?::uuid and user_id = ?::uuid
                """, rs -> rs.next() ? experiment(userId, rs) : null, id, userId);
        if (value == null) throw notFound("creative experiment");
        return value;
    }

    private Experiment experiment(String userId, ResultSet rs) throws SQLException {
        String id = rs.getString(1);
        List<Variant> variants = jdbc.query("""
                select id::text, lane, title, content, scores, selected, created_at
                from ai_gateway.creative_experiment_variants where experiment_id = ?::uuid
                order by case lane when 'conservative' then 1 when 'balanced' then 2 when 'wild' then 3 else 4 end
                """, (row, index) -> new Variant(row.getString(1), row.getString(2), row.getString(3), row.getString(4),
                doubles(row.getString(5)), row.getBoolean(6), row.getTimestamp(7).toInstant()), id);
        return new Experiment(id, rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
                rs.getString(7), variants, rs.getLong(8), rs.getLong(9), rs.getInt(10),
                rs.getTimestamp(11).toInstant(), rs.getTimestamp(12).toInstant());
    }

    private void ensureFingerprint(String userId) {
        jdbc.update("""
                insert into ai_gateway.creative_fingerprint_settings(user_id) values (?::uuid)
                on conflict(user_id) do nothing
                """, userId);
        for (String key : DIMENSIONS) jdbc.update("""
                insert into ai_gateway.creative_fingerprint_dimensions(user_id, dimension_key)
                values (?::uuid, ?) on conflict(user_id, dimension_key) do nothing
                """, userId, key);
    }

    private CorpusItem item(String userId, String id) {
        CorpusItem value = jdbc.query("""
                select item.id::text, item.source_id::text, item.visibility, item.kind, item.title,
                       item.trigger_text, item.mechanism, item.emotional_effect, item.contexts,
                       item.risk_tags, item.tags, item.freshness, item.rights_status, item.locale,
                       item.tombstoned_at, item.version, item.created_at, item.updated_at
                from ai_gateway.corpus_items item where item.id = ?::uuid and item.owner_user_id = ?::uuid
                """, rs -> rs.next() ? corpusItem(rs) : null, id, userId);
        if (value == null) throw notFound("corpus item");
        return value;
    }

    private CorpusItem visibleItem(String userId, String id) {
        CorpusItem value = jdbc.query("""
                select item.id::text, item.source_id::text, item.visibility, item.kind, item.title,
                       item.trigger_text, item.mechanism, item.emotional_effect, item.contexts,
                       item.risk_tags, item.tags, item.freshness, item.rights_status, item.locale,
                       item.tombstoned_at, item.version, item.created_at, item.updated_at
                from ai_gateway.corpus_items item left join ai_gateway.corpus_sources source on source.id = item.source_id
                where item.id = ?::uuid and item.tombstoned_at is null and (
                  (item.visibility = 'private' and item.owner_user_id = ?::uuid) or
                  (item.visibility = 'public' and item.rights_status = 'allowed' and source.status = 'allowed' and source.rights_status = 'allowed'))
                """, rs -> rs.next() ? corpusItem(rs) : null, id, userId);
        if (value == null) throw notFound("corpus item");
        return value;
    }

    private CollectionItem collection(String userId, String id) {
        CollectionItem value = jdbc.query("""
                select id::text, corpus_item_id::text, title, mechanism, notes, tags,
                       adopted, use_count, version, created_at, updated_at
                from ai_gateway.corpus_collections where id = ?::uuid and user_id = ?::uuid
                """, rs -> rs.next() ? collection(rs) : null, id, userId);
        if (value == null) throw notFound("collection");
        return value;
    }

    private Source source(String id) {
        Source value = jdbc.query("""
                select id::text, submitted_by::text, canonical_url, domain, title, excerpt, content_hash,
                       status, rights_status, locale, http_status, retrieved_at, last_error_code,
                       version, created_at, updated_at
                from ai_gateway.corpus_sources where id = ?::uuid
                """, rs -> rs.next() ? source(rs) : null, id);
        if (value == null) throw notFound("corpus source");
        return value;
    }

    private Source sourceByUrl(String url) {
        return jdbc.query("""
                select id::text, submitted_by::text, canonical_url, domain, title, excerpt, content_hash,
                       status, rights_status, locale, http_status, retrieved_at, last_error_code,
                       version, created_at, updated_at
                from ai_gateway.corpus_sources where canonical_url = ?
                """, rs -> rs.next() ? source(rs) : null, url);
    }

    private static CorpusItem corpusItem(ResultSet rs) throws SQLException {
        return new CorpusItem(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getString(7), rs.getString(8), strings(rs.getString(9)), strings(rs.getString(10)),
                strings(rs.getString(11)), rs.getString(12), rs.getString(13), rs.getString(14), instant(rs, 15),
                rs.getInt(16), rs.getTimestamp(17).toInstant(), rs.getTimestamp(18).toInstant());
    }

    private static CollectionItem collection(ResultSet rs) throws SQLException {
        return new CollectionItem(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                strings(rs.getString(6)), rs.getBoolean(7), rs.getInt(8), rs.getInt(9),
                rs.getTimestamp(10).toInstant(), rs.getTimestamp(11).toInstant());
    }

    private static Source source(ResultSet rs) throws SQLException {
        Integer status = rs.getObject(11) == null ? null : rs.getInt(11);
        return new Source(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9), rs.getString(10), status,
                instant(rs, 12), rs.getString(13), rs.getInt(14), rs.getTimestamp(15).toInstant(),
                rs.getTimestamp(16).toInstant());
    }

    private static IngestionJob job(ResultSet rs) throws SQLException {
        return new IngestionJob(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getString(4), rs.getInt(5),
                rs.getTimestamp(6).toInstant(), instant(rs, 7), rs.getString(8), rs.getTimestamp(9).toInstant(),
                rs.getTimestamp(10).toInstant(), instant(rs, 11));
    }

    private static List<String> tokens(String input) {
        if (input == null || input.isBlank()) return List.of();
        LinkedHashSet<String> values = new LinkedHashSet<>();
        for (String value : WORDS.split(input.toLowerCase(Locale.ROOT))) {
            if (!value.isBlank()) values.add(value.length() > 80 ? value.substring(0, 80) : value);
            if (values.size() >= 64) break;
        }
        return List.copyOf(values);
    }

    private Map<String, Double> scores(String prompt, String lane) {
        Map<String, Double> scores = new LinkedHashMap<>();
        for (String key : List.of("novelty", "coherence", "emotional_hook", "audience_surprise",
                "production_feasibility", "similarity_risk")) {
            byte[] digest = sha256Bytes((prompt + "\0" + lane + "\0" + key).getBytes(StandardCharsets.UTF_8));
            scores.put(key, 45.0 + Byte.toUnsignedInt(digest[0]) % 51);
        }
        return scores;
    }

    private static String extractedMechanism(String title, String excerpt) {
        String context = excerpt == null || excerpt.isBlank() ? "该来源尚缺可复核摘录。" : excerpt;
        return "围绕“" + truncate(title, 80) + "”提炼的社会观察：" + truncateCodePoints(context, 900)
                + "。使用前应重新组织表达，并结合人物、冲突和语境进行原创改写。";
    }

    private static void requireItem(String kind, String title, String mechanism, String freshness) {
        if (!ITEM_KINDS.contains(kind) || title == null || title.isBlank() || title.length() > 240
                || mechanism == null || mechanism.isBlank() || mechanism.length() > 4_000
                || !FRESHNESS.contains(freshness)) throw invalid("corpus item is invalid");
    }

    private static void rejectSecretQuery(URI uri) {
        String query = uri.getRawQuery();
        if (query == null) return;
        for (String part : query.split("&")) {
            String key = part.split("=", 2)[0].toLowerCase(Locale.ROOT);
            if (SENSITIVE_QUERY_KEYS.contains(key)) throw invalid("URLs containing credential-like query parameters are rejected");
        }
    }

    private byte[] writeBytes(Object value) {
        try { return json.writeValueAsBytes(value); }
        catch (JsonProcessingException error) { throw new IllegalStateException("json serialization failed", error); }
    }

    private String write(Object value) {
        try { return json.writeValueAsString(value); }
        catch (JsonProcessingException error) { throw new IllegalStateException("json serialization failed", error); }
    }

    private static List<String> strings(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        try { return new ObjectMapper().readValue(raw, new TypeReference<List<String>>() { }); }
        catch (JsonProcessingException error) { return List.of(); }
    }

    private Map<String, Double> doubles(String raw) {
        try { return json.readValue(raw, new TypeReference<Map<String, Double>>() { }); }
        catch (JsonProcessingException error) { return Map.of(); }
    }

    private static String sign(byte[] payload, String pem) {
        try {
            String value = pem.replace("-----BEGIN PRIVATE KEY-----", "")
                    .replace("-----END PRIVATE KEY-----", "").replaceAll("\\s", "");
            PrivateKey key = KeyFactory.getInstance("Ed25519")
                    .generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(value)));
            Signature signature = Signature.getInstance("Ed25519");
            signature.initSign(key);
            signature.update(payload);
            return Base64.getEncoder().encodeToString(signature.sign());
        } catch (Exception error) {
            throw new BusinessException("CORPUS_SNAPSHOT_SIGNING_FAILED", "corpus snapshot could not be signed",
                    HttpStatus.SERVICE_UNAVAILABLE);
        }
    }

    private static String sha256(byte[] value) { return java.util.HexFormat.of().formatHex(sha256Bytes(value)); }
    private static byte[] sha256Bytes(byte[] value) {
        try { return MessageDigest.getInstance("SHA-256").digest(value); }
        catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }
    private static String safe(String value) { return value == null ? "" : value; }
    private static String locale(String value) { return value == null || value.isBlank() ? "zh-CN" : truncate(value, 35); }
    private static String truncate(String value, int max) { return value == null ? "" : value.substring(0, Math.min(value.length(), max)); }
    private static String truncateCodePoints(String value, int max) {
        if (value == null) return "";
        int count = value.codePointCount(0, value.length());
        return count <= max ? value : value.substring(0, value.offsetByCodePoints(0, max));
    }
    private static String uuidOrNull(String value) {
        if (value == null || value.isBlank()) return null;
        try { return UUID.fromString(value).toString(); }
        catch (IllegalArgumentException error) { throw invalid("cursor is invalid"); }
    }
    private static Instant instant(ResultSet rs, int index) throws SQLException {
        return rs.getTimestamp(index) == null ? null : rs.getTimestamp(index).toInstant();
    }
    private static BusinessException invalid(String message) {
        return new BusinessException("CREATIVE_INTELLIGENCE_INVALID", message, HttpStatus.BAD_REQUEST);
    }
    private static BusinessException conflict(String code, String message) {
        return new BusinessException(code, message, HttpStatus.CONFLICT);
    }
    private static BusinessException notFound(String target) {
        return new BusinessException("CREATIVE_INTELLIGENCE_NOT_FOUND", target + " was not found", HttpStatus.NOT_FOUND);
    }
    private static Map<String, Object> linked(Object... values) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int index = 0; index < values.length; index += 2) {
            if (values[index + 1] != null) result.put(String.valueOf(values[index]), values[index + 1]);
        }
        return result;
    }

    private enum Lane {
        CONSERVATIVE("conservative", "稳健延展", "保留核心设定，强化人物动机和因果闭环，减少额外规则。"),
        BALANCED("balanced", "平衡重构", "保留情绪承诺，同时替换一个关键关系或冲突机制。"),
        WILD("wild", "大胆异变", "反转核心假设，把最不可能成立的条件变成故事规则。 ");
        private final String id;
        private final String title;
        private final String instruction;
        Lane(String id, String title, String instruction) { this.id = id; this.title = title; this.instruction = instruction; }
        public String id() { return id; }
        public String title() { return title; }
        public String instruction() { return instruction; }
    }

    public record Page<T>(List<T> items, String nextCursor) { }
    public record ItemCreate(String kind, String title, String trigger, String mechanism, String emotionalEffect,
                             List<String> contexts, List<String> riskTags, List<String> tags, String freshness,
                             String locale) {
        public ItemCreate { contexts = copy(contexts); riskTags = copy(riskTags); tags = copy(tags); }
    }
    public record CorpusItem(String id, String sourceId, String visibility, String kind, String title, String trigger,
                             String mechanism, String emotionalEffect, List<String> contexts, List<String> riskTags,
                             List<String> tags, String freshness, String rightsStatus, String locale,
                             Instant tombstonedAt, int version, Instant createdAt, Instant updatedAt) { }
    public record CollectionCreate(String corpusItemId, String title, String mechanism, String notes, List<String> tags) {
        public CollectionCreate { tags = copy(tags); }
    }
    public record CollectionItem(String id, String corpusItemId, String title, String mechanism, String notes,
                                 List<String> tags, boolean adopted, int useCount, int version,
                                 Instant createdAt, Instant updatedAt) { }
    private record FingerprintSettings(boolean enabled, Instant consentedAt, List<String> avoidances,
                                       List<String> goals, int version, Instant updatedAt) { }
    public record Dimension(String key, double score, double confidence, boolean frozen,
                            List<String> evidenceIds, Instant updatedAt) { }
    public record DimensionPatch(String key, Double score, Boolean frozen) { }
    public record Fingerprint(boolean enabled, Instant consentedAt, List<Dimension> dimensions,
                              List<String> avoidances, List<String> goals, int version, Instant updatedAt) { }
    public record ExperimentCreate(String originType, String originId, String prompt, String model, int maxTokens) { }
    public record Experiment(String id, String originType, String originId, String prompt, String strategyVersion,
                             String model, String status, List<Variant> variants, long promptTokens,
                             long completionTokens, int version, Instant createdAt, Instant updatedAt) { }
    public record Variant(String id, String lane, String title, String content, Map<String, Double> scores,
                          boolean selected, Instant createdAt) { }
    public record Source(String id, String submittedBy, String canonicalUrl, String domain, String title,
                         String excerpt, String contentHash, String status, String rightsStatus, String locale,
                         Integer httpStatus, Instant retrievedAt, String lastErrorCode, int version,
                         Instant createdAt, Instant updatedAt) { }
    public record IngestionJob(String id, String sourceId, int depth, String status, int attempts,
                               Instant nextAttemptAt, Instant leaseUntil, String errorCode,
                               Instant createdAt, Instant updatedAt, Instant finishedAt) { }
    private record EncryptedBody(byte[] ciphertext, byte[] nonce) { }
    private record ConditionalHeaders(String etag, String lastModified) { }
    private static <T> List<T> copy(List<T> values) { return values == null ? List.of() : List.copyOf(values); }
}
