CREATE TABLE IF NOT EXISTS reporting.product_events (
  installation_id UUID NOT NULL,
  event_id UUID PRIMARY KEY,
  app_version TEXT NOT NULL CHECK (char_length(app_version) BETWEEN 1 AND 40),
  operating_system TEXT NOT NULL CHECK (operating_system IN ('darwin', 'win32', 'linux')),
  event_name TEXT NOT NULL CHECK (event_name IN (
    'demo_opened', 'first_shot_ready', 'retake_started', 'retake_succeeded',
    'retake_adopted', 'review_exported', 'review_published', 'editor_exported',
    'checkout_conversion'
  )),
  duration_bucket TEXT,
  result_code TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- There are deliberately no user/project/title/prompt/path/media columns.
GRANT SELECT, INSERT, DELETE ON reporting.product_events TO dramaip_reporting;
