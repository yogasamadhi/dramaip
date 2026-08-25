import type { PluginMigration } from "@dramaip/plugin-api/internal";

export const extensionPlatformMigrations = [
  {
    id: "system.0001.extension-platform",
    pluginId: "system",
    version: "3.0.0-alpha.3",
    dependsOn: ["foundation.0001.runtime-ledger"],
    sql: `
      CREATE TABLE IF NOT EXISTS extension_publishers (
        publisher_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        public_key_pem TEXT NOT NULL,
        trust_state TEXT NOT NULL CHECK(trust_state IN ('trusted', 'revoked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS extension_registry_sources (
        registry_id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        key_id TEXT NOT NULL,
        root_public_key_pem TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        cached_payload_json TEXT,
        cached_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS installed_extensions (
        plugin_id TEXT PRIMARY KEY,
        current_revision_id TEXT,
        state TEXT NOT NULL CHECK(state IN ('disabled', 'active', 'degraded', 'quarantined')),
        permission_revision INTEGER NOT NULL DEFAULT 1,
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS extension_revisions (
        revision_id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        version TEXT NOT NULL,
        package_ref TEXT NOT NULL,
        package_sha256 TEXT NOT NULL,
        publisher_id TEXT NOT NULL,
        publisher_public_key_pem TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('staged', 'healthy', 'failed', 'superseded')),
        failure TEXT,
        created_at TEXT NOT NULL,
        activated_at TEXT,
        FOREIGN KEY(plugin_id) REFERENCES installed_extensions(plugin_id)
      );
      CREATE INDEX IF NOT EXISTS extension_revisions_plugin_created
        ON extension_revisions(plugin_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS extension_grants (
        plugin_id TEXT NOT NULL,
        permission_revision INTEGER NOT NULL,
        permission TEXT NOT NULL,
        scope_json TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        revoked_at TEXT,
        PRIMARY KEY(plugin_id, permission_revision, permission)
      );

      CREATE TABLE IF NOT EXISTS extension_install_previews (
        preview_id TEXT PRIMARY KEY,
        operation TEXT NOT NULL CHECK(operation IN ('install', 'update')),
        plugin_id TEXT NOT NULL,
        registry_id TEXT NOT NULL,
        package_url TEXT NOT NULL,
        package_sha256 TEXT NOT NULL,
        publisher_id TEXT NOT NULL,
        publisher_public_key_pem TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        requested_permissions_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        committed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS extension_audit (
        audit_id TEXT PRIMARY KEY,
        plugin_id TEXT,
        revision_id TEXT,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        trace_id TEXT,
        detail_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS extension_audit_plugin_time
        ON extension_audit(plugin_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS extension_documents (
        plugin_id TEXT NOT NULL,
        collection_name TEXT NOT NULL,
        document_id TEXT NOT NULL,
        document_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(plugin_id, collection_name, document_id)
      );

      CREATE TABLE IF NOT EXISTS extension_document_index_values (
        plugin_id TEXT NOT NULL,
        collection_name TEXT NOT NULL,
        document_id TEXT NOT NULL,
        index_name TEXT NOT NULL,
        text_value TEXT,
        number_value REAL,
        boolean_value INTEGER,
        PRIMARY KEY(plugin_id, collection_name, document_id, index_name),
        FOREIGN KEY(plugin_id, collection_name, document_id)
          REFERENCES extension_documents(plugin_id, collection_name, document_id)
          ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS extension_document_index_text
        ON extension_document_index_values(plugin_id, collection_name, index_name, text_value);
      CREATE INDEX IF NOT EXISTS extension_document_index_number
        ON extension_document_index_values(plugin_id, collection_name, index_name, number_value);

      CREATE TABLE IF NOT EXISTS extension_event_checkpoints (
        plugin_id TEXT NOT NULL,
        subscription_id TEXT NOT NULL,
        cursor INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(plugin_id, subscription_id)
      );
    `,
  },
] as const satisfies readonly PluginMigration[];
