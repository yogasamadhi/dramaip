import { createHash } from "node:crypto";
import { creationReference } from "@dramaip/contracts/creation";
import {
  PRODUCTION_AUTHOR_INTENT_SOURCE_SERVICE,
  type ProductionAuthorIntentSource,
} from "@dramaip/contracts/workspace";
import {
  provideService,
  type PluginContext,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import {
  directScriptSourceContent,
  type DirectScriptSourceDocument,
} from "./direct-script-source.js";

interface ScriptRow {
  id: string;
  project_id: string;
  title: string;
  version: number;
  payload_json: string;
}
export function registerAuthorIntentSources(context: PluginContext) {
  const read = (
    tx: UnitOfWorkTransaction,
    row: ScriptRow,
  ): ProductionAuthorIntentSource | undefined => {
    const document = tx.get<DirectScriptSourceDocument>(
      "SELECT version, blocks_json, source_format, loss_report_json FROM screenplay_documents WHERE script_record_id = ? AND project_id = ?",
      row.id,
      row.project_id,
    );
    let payload: { 剧本内容?: unknown };
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      return undefined;
    }
    const content = directScriptSourceContent(payload["剧本内容"], document);
    if (!content) return undefined;
    const reference = creationReference("script", {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      version: row.version,
      documentVersion: document?.version ?? null,
      ...content,
    });
    return {
      title: row.title,
      source: {
        kind: "script",
        id: row.id,
        version: row.version,
        documentVersion: document?.version ?? null,
        contentHash: createHash("sha256")
          .update(JSON.stringify(reference.value))
          .digest("hex"),
      },
      reference,
    };
  };
  context.effect(
    () =>
      provideService(context, PRODUCTION_AUTHOR_INTENT_SOURCE_SERVICE, {
        get: (projectId, id) =>
          context.uow.execute((tx) => {
            const row = tx.get<ScriptRow>(
              "SELECT id, project_id, title, version, payload_json FROM production_records WHERE kind = 'scripts' AND project_id = ? AND id = ?",
              projectId,
              id,
            );
            return row ? read(tx, row) : undefined;
          }),
        list: (projectId) =>
          context.uow.execute((tx) =>
            tx
              .all<ScriptRow>(
                "SELECT id, project_id, title, version, payload_json FROM production_records WHERE kind = 'scripts' AND project_id = ? ORDER BY order_index, id",
                projectId,
              )
              .flatMap((row) => {
                const value = read(tx, row);
                return value ? [value] : [];
              }),
          ),
      }),
    `service:${PRODUCTION_AUTHOR_INTENT_SOURCE_SERVICE}`,
  );
}
