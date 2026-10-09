import type { PluginMigration } from "@dramaip/plugin-api/internal";

// Applied migrations remain immutable; legacy previews have unknown receipts.
export const screenplayImportReceiptMigration: PluginMigration = {
  id: "production.0008.screenplay-import-receipts",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0007.episode-development"],
  sql: `ALTER TABLE screenplay_import_previews ADD COLUMN target_json TEXT;
        ALTER TABLE screenplay_import_previews ADD COLUMN commit_receipt_json TEXT;`,
};
