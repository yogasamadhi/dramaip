CREATE TABLE IF NOT EXISTS ai_gateway.provider_cost_logs (
  id UUID PRIMARY KEY,
  audit_id UUID NOT NULL UNIQUE REFERENCES ai_gateway.request_audits(id),
  user_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  reservation_id UUID,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens BIGINT NOT NULL,
  completion_tokens BIGINT NOT NULL,
  total_tokens BIGINT NOT NULL,
  usage_known BOOLEAN NOT NULL,
  input_unit_price NUMERIC(24, 12) NOT NULL,
  output_unit_price NUMERIC(24, 12) NOT NULL,
  price_unit_tokens BIGINT NOT NULL DEFAULT 1000000,
  currency TEXT NOT NULL,
  exchange_rate_to_cny NUMERIC(24, 12) NOT NULL,
  cost_amount NUMERIC(24, 12) NOT NULL,
  cost_cny_amount NUMERIC(24, 12) NOT NULL,
  pricing_source TEXT NOT NULL,
  cost_status TEXT NOT NULL,
  priced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_cost_logs_user_priced
  ON ai_gateway.provider_cost_logs (user_id, priced_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_cost_logs_request
  ON ai_gateway.provider_cost_logs (user_id, request_id);

CREATE TABLE IF NOT EXISTS ai_gateway.cost_limit_reservations (
  audit_id UUID PRIMARY KEY REFERENCES ai_gateway.request_audits(id),
  user_id UUID NOT NULL,
  client_ip TEXT NOT NULL DEFAULT '',
  estimated_cost_cny NUMERIC(24, 12) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cost_limit_reservations_user_active
  ON ai_gateway.cost_limit_reservations (user_id, created_at DESC) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cost_limit_reservations_ip_active
  ON ai_gateway.cost_limit_reservations (client_ip, created_at DESC) WHERE released_at IS NULL AND client_ip <> '';

CREATE TABLE IF NOT EXISTS ai_gateway.provider_cost_alerts (
  id UUID PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES ai_gateway.request_audits(id),
  user_id UUID NOT NULL,
  client_ip TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  observed_cost_cny NUMERIC(24, 12) NOT NULL,
  threshold_cny NUMERIC(24, 12) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_id, event_type)
);
