ALTER TABLE ai_gateway.provider_cost_logs
  ADD COLUMN IF NOT EXISTS client_ip TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_provider_cost_logs_ip_priced
  ON ai_gateway.provider_cost_logs (client_ip, priced_at DESC)
  WHERE client_ip <> '';
