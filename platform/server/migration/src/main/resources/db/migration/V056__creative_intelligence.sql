CREATE TABLE ai_gateway.corpus_domain_policies (
  domain VARCHAR(253) PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'quarantined',
  robots_checked_at TIMESTAMPTZ,
  robots_allowed BOOLEAN NOT NULL DEFAULT false,
  crawl_delay_ms INTEGER NOT NULL DEFAULT 1000,
  next_crawl_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
  reason VARCHAR(500),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corpus_domain_status_check CHECK (status IN ('quarantined','allowed','blocked','takedown')),
  CONSTRAINT corpus_domain_delay_check CHECK (crawl_delay_ms BETWEEN 100 AND 86400000)
);

CREATE TABLE ai_gateway.corpus_sources (
  id UUID PRIMARY KEY,
  submitted_by UUID,
  canonical_url TEXT NOT NULL UNIQUE,
  domain VARCHAR(253) NOT NULL,
  title VARCHAR(500) NOT NULL DEFAULT '待提炼来源',
  excerpt VARCHAR(500),
  content_hash VARCHAR(128),
  etag VARCHAR(500),
  last_modified VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'quarantined',
  rights_status VARCHAR(24) NOT NULL DEFAULT 'review_required',
  locale VARCHAR(35) NOT NULL DEFAULT 'zh-CN',
  http_status INTEGER,
  retrieved_at TIMESTAMPTZ,
  last_error_code VARCHAR(100),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corpus_source_status_check CHECK (status IN ('quarantined','fetched','allowed','blocked','takedown','failed')),
  CONSTRAINT corpus_source_rights_check CHECK (rights_status IN ('unknown','review_required','allowed','restricted','removed'))
);
CREATE INDEX idx_corpus_sources_domain_status ON ai_gateway.corpus_sources(domain, status, updated_at DESC, id);

CREATE TABLE ai_gateway.corpus_source_bodies (
  source_id UUID PRIMARY KEY REFERENCES ai_gateway.corpus_sources(id) ON DELETE CASCADE,
  ciphertext BYTEA NOT NULL,
  nonce BYTEA NOT NULL,
  key_version VARCHAR(40) NOT NULL,
  content_type VARCHAR(200) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_corpus_source_bodies_expiry ON ai_gateway.corpus_source_bodies(expires_at);

CREATE TABLE ai_gateway.corpus_ingestion_jobs (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES ai_gateway.corpus_sources(id) ON DELETE CASCADE,
  parent_job_id UUID REFERENCES ai_gateway.corpus_ingestion_jobs(id) ON DELETE SET NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  error_code VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT corpus_job_depth_check CHECK (depth BETWEEN 0 AND 2),
  CONSTRAINT corpus_job_status_check CHECK (status IN ('pending','running','completed','failed','blocked')),
  UNIQUE(source_id)
);
CREATE INDEX idx_corpus_jobs_pending ON ai_gateway.corpus_ingestion_jobs(status, next_attempt_at, created_at)
  WHERE status IN ('pending','failed');

CREATE TABLE ai_gateway.corpus_items (
  id UUID PRIMARY KEY,
  source_id UUID REFERENCES ai_gateway.corpus_sources(id) ON DELETE SET NULL,
  visibility VARCHAR(12) NOT NULL DEFAULT 'public',
  owner_user_id UUID,
  kind VARCHAR(40) NOT NULL,
  title VARCHAR(240) NOT NULL,
  trigger_text VARCHAR(1000) NOT NULL DEFAULT '',
  mechanism TEXT NOT NULL,
  emotional_effect VARCHAR(1000) NOT NULL DEFAULT '',
  contexts JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  search_tokens JSONB NOT NULL DEFAULT '[]'::jsonb,
  freshness VARCHAR(16) NOT NULL DEFAULT 'stable',
  rights_status VARCHAR(24) NOT NULL DEFAULT 'review_required',
  locale VARCHAR(35) NOT NULL DEFAULT 'zh-CN',
  extraction_policy_version VARCHAR(40) NOT NULL DEFAULT 'corpus-extract.v1',
  tombstoned_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corpus_item_visibility_check CHECK (visibility IN ('public','private')),
  CONSTRAINT corpus_item_kind_check CHECK (kind IN (
    'meme','comic_device','dialogue_pattern','character_hook','relationship_hook',
    'conflict','reversal','scene','world_rule','style','social_observation'
  )),
  CONSTRAINT corpus_item_freshness_check CHECK (freshness IN ('emerging','stable','cooling','expired','evergreen')),
  CONSTRAINT corpus_item_rights_check CHECK (rights_status IN ('unknown','review_required','allowed','restricted','removed')),
  CONSTRAINT corpus_item_owner_check CHECK (
    (visibility = 'public' AND owner_user_id IS NULL) OR
    (visibility = 'private' AND owner_user_id IS NOT NULL)
  )
);
CREATE INDEX idx_corpus_items_public ON ai_gateway.corpus_items(freshness, updated_at DESC, id)
  WHERE visibility = 'public' AND tombstoned_at IS NULL;
CREATE INDEX idx_corpus_items_owner ON ai_gateway.corpus_items(owner_user_id, updated_at DESC, id)
  WHERE visibility = 'private';
CREATE INDEX idx_corpus_items_tokens ON ai_gateway.corpus_items USING GIN(search_tokens);

CREATE TABLE ai_gateway.corpus_collections (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  corpus_item_id UUID REFERENCES ai_gateway.corpus_items(id) ON DELETE SET NULL,
  title VARCHAR(240) NOT NULL,
  mechanism TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  adopted BOOLEAN NOT NULL DEFAULT false,
  use_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, corpus_item_id)
);
CREATE INDEX idx_corpus_collections_user ON ai_gateway.corpus_collections(user_id, updated_at DESC, id);

CREATE TABLE ai_gateway.creative_fingerprint_settings (
  user_id UUID PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  consented_at TIMESTAMPTZ,
  avoidances JSONB NOT NULL DEFAULT '[]'::jsonb,
  goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ai_gateway.creative_fingerprint_dimensions (
  user_id UUID NOT NULL,
  dimension_key VARCHAR(40) NOT NULL,
  score NUMERIC(5,4) NOT NULL DEFAULT 0.5,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  frozen BOOLEAN NOT NULL DEFAULT false,
  evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, dimension_key),
  CONSTRAINT fingerprint_dimension_key_check CHECK (dimension_key IN (
    'humor','genre','tone','pace','conflict','reversal','emotional_intensity',
    'visuality','novelty','production_complexity'
  )),
  CONSTRAINT fingerprint_dimension_score_check CHECK (score BETWEEN 0 AND 1 AND confidence BETWEEN 0 AND 1)
);

CREATE TABLE ai_gateway.creative_experiments (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  origin_type VARCHAR(20) NOT NULL,
  origin_id VARCHAR(200),
  prompt TEXT NOT NULL,
  strategy_version VARCHAR(40) NOT NULL DEFAULT 'creative-lab.v1',
  model VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ready',
  idempotency_key VARCHAR(200) NOT NULL,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT creative_experiment_origin_check CHECK (origin_type IN ('inspiration','corpus')),
  CONSTRAINT creative_experiment_status_check CHECK (status IN ('running','ready','completed','rejected','failed')),
  UNIQUE(user_id, idempotency_key)
);
CREATE TABLE ai_gateway.creative_experiment_variants (
  id UUID PRIMARY KEY,
  experiment_id UUID NOT NULL REFERENCES ai_gateway.creative_experiments(id) ON DELETE CASCADE,
  lane VARCHAR(20) NOT NULL,
  title VARCHAR(240) NOT NULL,
  content TEXT NOT NULL,
  scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT creative_variant_lane_check CHECK (lane IN ('conservative','balanced','wild')),
  UNIQUE(experiment_id, lane)
);
CREATE INDEX idx_creative_experiments_user ON ai_gateway.creative_experiments(user_id, updated_at DESC, id);

CREATE TABLE ai_gateway.creative_provenance_edges (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  from_type VARCHAR(80) NOT NULL,
  from_id VARCHAR(200) NOT NULL,
  relation VARCHAR(24) NOT NULL,
  to_type VARCHAR(80) NOT NULL,
  to_id VARCHAR(200) NOT NULL,
  quote_excerpt VARCHAR(500),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT creative_provenance_relation_check CHECK (relation IN (
    'collected_from','inspired_by','derived_from','generated_from','adopted_from','quoted_from'
  )),
  UNIQUE(user_id, from_type, from_id, relation, to_type, to_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  ai_gateway.corpus_domain_policies,
  ai_gateway.corpus_sources,
  ai_gateway.corpus_source_bodies,
  ai_gateway.corpus_ingestion_jobs,
  ai_gateway.corpus_items,
  ai_gateway.corpus_collections,
  ai_gateway.creative_fingerprint_settings,
  ai_gateway.creative_fingerprint_dimensions,
  ai_gateway.creative_experiments,
  ai_gateway.creative_experiment_variants,
  ai_gateway.creative_provenance_edges
TO dramaip_ai_svc;
