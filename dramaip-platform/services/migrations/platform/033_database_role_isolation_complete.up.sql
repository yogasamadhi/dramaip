-- Migrations 031 and 032 extended the role matrix after the original
-- isolation migration, but each reset the older grants while granting only
-- its newly introduced role. Reconcile the complete matrix after every
-- domain schema exists so a fresh install and an upgraded database converge
-- on the same least-privilege permissions.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

REVOKE ALL ON SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin, reporting FROM PUBLIC;
REVOKE ALL ON SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin, reporting FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration, dramaip_admin, dramaip_reporting;
REVOKE ALL ON ALL TABLES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin, reporting FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin, reporting FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration, dramaip_admin, dramaip_reporting;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin, reporting FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin, dramaip_reporting;

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

GRANT USAGE ON SCHEMA inspiration TO dramaip_inspiration;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inspiration TO dramaip_inspiration;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA inspiration TO dramaip_inspiration;
ALTER DEFAULT PRIVILEGES IN SCHEMA inspiration GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_inspiration;
ALTER DEFAULT PRIVILEGES IN SCHEMA inspiration GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_inspiration;

GRANT USAGE ON SCHEMA admin TO dramaip_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA admin TO dramaip_admin;
-- Audit records remain append-only for the application identity.
REVOKE UPDATE, DELETE ON admin.audit_logs FROM dramaip_admin;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA admin TO dramaip_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_admin;

GRANT USAGE ON SCHEMA reporting TO dramaip_reporting;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA reporting TO dramaip_reporting;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA reporting TO dramaip_reporting;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_reporting;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_reporting;
