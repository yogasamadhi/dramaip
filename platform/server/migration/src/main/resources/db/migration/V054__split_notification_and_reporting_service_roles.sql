-- The consolidated support service is split into independently deployable
-- notification and reporting services. Keep the old role for rollback, but
-- grant each replacement role access only to the schema it owns.
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['dramaip_notification_svc','dramaip_reporting_svc']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', role_name);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA notification TO dramaip_notification_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notification TO dramaip_notification_svc;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA notification TO dramaip_notification_svc;

GRANT USAGE ON SCHEMA reporting TO dramaip_reporting_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO dramaip_reporting_svc;
