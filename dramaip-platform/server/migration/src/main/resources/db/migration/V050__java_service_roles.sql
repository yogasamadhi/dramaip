-- Java services use consolidated roles. The migration identity remains the only DDL identity.
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['dramaip_identity_svc','dramaip_support_svc','dramaip_creation_svc','dramaip_quota_svc','dramaip_ai_svc','dramaip_billing_svc']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', role_name);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA auth, user_profile, admin TO dramaip_identity_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth, user_profile, admin TO dramaip_identity_svc;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA auth, user_profile, admin TO dramaip_identity_svc;
GRANT USAGE ON SCHEMA notification, reporting TO dramaip_support_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notification, reporting TO dramaip_support_svc;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA notification, reporting TO dramaip_support_svc;
GRANT USAGE ON SCHEMA inspiration, snapshot, review TO dramaip_creation_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inspiration, snapshot, review TO dramaip_creation_svc;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA inspiration, snapshot, review TO dramaip_creation_svc;
GRANT USAGE ON SCHEMA quota TO dramaip_quota_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA quota TO dramaip_quota_svc;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA quota TO dramaip_quota_svc;
GRANT USAGE ON SCHEMA ai_gateway TO dramaip_ai_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai_gateway TO dramaip_ai_svc;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ai_gateway TO dramaip_ai_svc;
GRANT USAGE ON SCHEMA billing TO dramaip_billing_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO dramaip_billing_svc;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA billing TO dramaip_billing_svc;
