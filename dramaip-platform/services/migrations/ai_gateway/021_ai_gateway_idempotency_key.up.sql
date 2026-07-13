ALTER TABLE ai_gateway.request_audits
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

UPDATE ai_gateway.request_audits
SET idempotency_key = request_id
WHERE idempotency_key IS NULL OR btrim(idempotency_key) = '';

-- Keep a rolling deployment safe: an older gateway binary that only writes
-- request_id still receives a durable idempotency key before the unique index
-- is checked.
CREATE OR REPLACE FUNCTION ai_gateway.populate_request_audit_idempotency_key()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.idempotency_key IS NULL OR btrim(NEW.idempotency_key) = '' THEN
    NEW.idempotency_key := NEW.request_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS request_audits_idempotency_key_trigger ON ai_gateway.request_audits;
CREATE TRIGGER request_audits_idempotency_key_trigger
  BEFORE INSERT OR UPDATE OF request_id, idempotency_key ON ai_gateway.request_audits
  FOR EACH ROW EXECUTE FUNCTION ai_gateway.populate_request_audit_idempotency_key();

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_gateway_request_audits_user_idempotency_key
  ON ai_gateway.request_audits (user_id, idempotency_key);

-- request_id is now tracing metadata. The idempotency identity is the explicit
-- key above, so clients may use a different request correlation value.
ALTER TABLE ai_gateway.request_audits
  DROP CONSTRAINT IF EXISTS request_audits_user_id_request_id_key;
