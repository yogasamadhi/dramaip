CREATE TABLE ai_gateway.inspiration_conversations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  title VARCHAR(200) NOT NULL DEFAULT '未命名灵感',
  creative_mode VARCHAR(32) NOT NULL,
  prompt_policy_version VARCHAR(32) NOT NULL DEFAULT 'inspiration.v1',
  parent_conversation_id UUID REFERENCES ai_gateway.inspiration_conversations(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  complete_turns INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inspiration_conversations_mode_check CHECK (
    creative_mode IN ('free','guided','character_interview','world_simulation','conflict_lab')
  )
);
CREATE INDEX idx_inspiration_conversations_user_updated
  ON ai_gateway.inspiration_conversations(user_id, archived_at, updated_at DESC, id DESC);

CREATE TABLE ai_gateway.inspiration_messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES ai_gateway.inspiration_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  run_id UUID,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'completed',
  client_idempotency_key VARCHAR(200),
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inspiration_messages_role_check CHECK (role IN ('user','assistant')),
  CONSTRAINT inspiration_messages_status_check CHECK (status IN ('pending','streaming','completed','failed','canceled')),
  UNIQUE(user_id, client_idempotency_key)
);
CREATE INDEX idx_inspiration_messages_conversation_created
  ON ai_gateway.inspiration_messages(conversation_id, created_at, id);

CREATE TABLE ai_gateway.inspiration_run_events (
  sequence BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES ai_gateway.inspiration_conversations(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inspiration_events_conversation_sequence
  ON ai_gateway.inspiration_run_events(conversation_id, sequence);

CREATE TABLE ai_gateway.inspiration_cards (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES ai_gateway.inspiration_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  source_message_id UUID REFERENCES ai_gateway.inspiration_messages(id) ON DELETE SET NULL,
  kind VARCHAR(24) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  adopted BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inspiration_cards_kind_check CHECK (kind IN ('premise','character','world','conflict','scene','style','question'))
);
CREATE INDEX idx_inspiration_cards_conversation ON ai_gateway.inspiration_cards(conversation_id, updated_at DESC);

CREATE TABLE ai_gateway.inspiration_memory_settings (
  user_id UUID PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  consented_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ai_gateway.inspiration_memories (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  kind VARCHAR(24) NOT NULL,
  content TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inspiration_memories_kind_check CHECK (kind IN ('preference','theme','constraint','avoid','goal')),
  CONSTRAINT inspiration_memories_status_check CHECK (status IN ('active','disabled')),
  CONSTRAINT inspiration_memories_confidence_check CHECK (confidence BETWEEN 0 AND 1)
);
CREATE TABLE ai_gateway.inspiration_memory_sources (
  memory_id UUID NOT NULL REFERENCES ai_gateway.inspiration_memories(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES ai_gateway.inspiration_conversations(id) ON DELETE CASCADE,
  PRIMARY KEY(memory_id, conversation_id)
);
CREATE TABLE ai_gateway.inspiration_summaries (
  conversation_id UUID PRIMARY KEY REFERENCES ai_gateway.inspiration_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  summary TEXT NOT NULL,
  through_message_id UUID REFERENCES ai_gateway.inspiration_messages(id) ON DELETE SET NULL,
  model VARCHAR(120) NOT NULL,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ai_gateway.inspiration_memory_jobs (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES ai_gateway.inspiration_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  through_turn_count INTEGER NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  reason VARCHAR(24) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code VARCHAR(80),
  model VARCHAR(120),
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT inspiration_jobs_status_check CHECK (status IN ('pending','running','completed'))
);
CREATE INDEX idx_inspiration_jobs_pending ON ai_gateway.inspiration_memory_jobs(status, updated_at) WHERE status = 'pending';
CREATE UNIQUE INDEX idx_inspiration_jobs_six_turn_once
  ON ai_gateway.inspiration_memory_jobs(conversation_id, through_turn_count)
  WHERE reason = 'six_turns';

CREATE TABLE ai_gateway.inspiration_project_previews (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES ai_gateway.inspiration_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title VARCHAR(200) NOT NULL,
  project_mode VARCHAR(40) NOT NULL,
  brief JSONB NOT NULL,
  card_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  idempotency_key VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  CONSTRAINT inspiration_previews_status_check CHECK (status IN ('pending','confirmed')),
  UNIQUE(user_id, idempotency_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  ai_gateway.inspiration_conversations,
  ai_gateway.inspiration_messages,
  ai_gateway.inspiration_run_events,
  ai_gateway.inspiration_cards,
  ai_gateway.inspiration_memory_settings,
  ai_gateway.inspiration_memories,
  ai_gateway.inspiration_memory_sources,
  ai_gateway.inspiration_summaries,
  ai_gateway.inspiration_memory_jobs,
  ai_gateway.inspiration_project_previews
TO dramaip_ai_svc;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE ai_gateway.inspiration_run_events_sequence_seq TO dramaip_ai_svc;
