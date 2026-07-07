CREATE SCHEMA IF NOT EXISTS notification;

CREATE TABLE IF NOT EXISTS notification.notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_event_id)
);

CREATE TABLE IF NOT EXISTS notification.event_inbox (
  id UUID PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  trace_id TEXT NOT NULL DEFAULT '',
  processed_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_notifications_user_created
  ON notification.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_notifications_user_unread
  ON notification.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
