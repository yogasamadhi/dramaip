-- Runtime services connect with the dedicated LOGIN roles created by the
-- migration process. The migration identity owns DDL; runtime roles have only
-- DML rights on their one domain schema.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

REVOKE ALL ON SCHEMA auth, user_profile, billing, quota, ai_gateway, notification FROM PUBLIC;
REVOKE ALL ON SCHEMA auth, user_profile, billing, quota, ai_gateway, notification FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification;
REVOKE ALL ON ALL TABLES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification;

GRANT USAGE ON SCHEMA auth TO dramaip_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO dramaip_auth;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA auth TO dramaip_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_auth;

GRANT USAGE ON SCHEMA user_profile TO dramaip_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA user_profile TO dramaip_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA user_profile TO dramaip_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA user_profile GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA user_profile GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_user;

GRANT USAGE ON SCHEMA billing TO dramaip_billing;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO dramaip_billing;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA billing TO dramaip_billing;
ALTER DEFAULT PRIVILEGES IN SCHEMA billing GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_billing;
ALTER DEFAULT PRIVILEGES IN SCHEMA billing GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_billing;

GRANT USAGE ON SCHEMA quota TO dramaip_quota;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA quota TO dramaip_quota;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA quota TO dramaip_quota;
ALTER DEFAULT PRIVILEGES IN SCHEMA quota GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_quota;
ALTER DEFAULT PRIVILEGES IN SCHEMA quota GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_quota;

GRANT USAGE ON SCHEMA ai_gateway TO dramaip_ai_gateway;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai_gateway TO dramaip_ai_gateway;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ai_gateway TO dramaip_ai_gateway;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai_gateway GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_ai_gateway;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai_gateway GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_ai_gateway;

GRANT USAGE ON SCHEMA notification TO dramaip_notification;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notification TO dramaip_notification;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA notification TO dramaip_notification;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_notification;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_notification;
