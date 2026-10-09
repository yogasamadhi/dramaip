import {
  optionalService,
  type PluginContext,
} from "@dramaip/plugin-api/internal";
import {
  CREATION_PROJECT_LINEAGE_SERVICE,
  CreationProjectLineagePageSchema,
  ProjectPackageLineageSchema,
  type CreationProjectLineageReceipt,
} from "@dramaip/contracts/creation-project-lineage";

export function collectProjectPackageLineage(
  context: PluginContext,
  project: { id: string; version: number },
  includeOwnerLineage = true,
) {
  const production = includeOwnerLineage
    ? collectProductionProjectPackageLineage(context, project.id)
    : undefined;
  const knowledge = includeOwnerLineage
    ? collectKnowledgeProjectPackageLineage(context, project.id)
    : undefined;
  const workspace = includeOwnerLineage
    ? collectWorkspaceProjectPackageLineage(context, project.id)
    : undefined;
  const quality = includeOwnerLineage
    ? collectQualityProjectPackageLineage(context, project.id)
    : undefined;
  const service = optionalService(context, CREATION_PROJECT_LINEAGE_SERVICE);
  if (!service)
    return ProjectPackageLineageSchema.parse({
      format: "project-package-lineage-v1",
      sourceProject: { id: project.id, version: project.version },
      coverage: "recorded-workflows-only-not-all-owner-history",
      workflows: { state: "unavailable" },
      production,
      knowledge,
      workspace,
      quality,
    });
  try {
    const items: CreationProjectLineageReceipt[] = [],
      ids = new Set<string>(),
      cursors = new Set<string>();
    let cursor: string | undefined;
    for (let index = 0; index < 10_000; index++) {
      const page = CreationProjectLineagePageSchema.parse(
        service.list(project.id, { cursor, limit: 25 }),
      );
      for (const receipt of page.items) {
        if (receipt.projectId !== project.id || ids.has(receipt.id))
          throw new Error("invalid owner receipt");
        ids.add(receipt.id);
        items.push(receipt);
      }
      if (!page.nextCursor)
        return ProjectPackageLineageSchema.parse({
          format: "project-package-lineage-v1",
          sourceProject: { id: project.id, version: project.version },
          coverage: "recorded-workflows-only-not-all-owner-history",
          workflows: { state: "available", items },
          production,
          knowledge,
          workspace,
          quality,
        });
      if (!page.items.length || cursors.has(page.nextCursor))
        throw new Error("invalid owner cursor");
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw new Error("owner pagination guard exceeded");
  } catch {
    // The existing export route already declares 409 RFC 7807. Do not return
    // partial arrays or raw owner/Zod/private diagnostics through that boundary.
    throw new Error(
      "项目包创作谱系暂不可完整核对，未导出部分记录或改动原候选；请恢复来源后重试。",
    );
  }
}

import { createHash } from "node:crypto";
import {
  ImportedProjectLineageClaimSchema,
  ImportedProjectLineageArchiveSchema,
  ImportedProjectLineageArchivesSchema,
  type ImportedProjectLineageArchive,
} from "@dramaip/contracts/creation-project-lineage";
import type {
  UnitOfWorkTransaction,
  PluginMigration,
} from "@dramaip/plugin-api/internal";

const archiveHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(ImportedProjectLineageClaimSchema.parse(value)))
    .digest("hex");
export function verifyImportedProjectLineageArchives(
  value: unknown,
): ImportedProjectLineageArchive[] {
  const items = ImportedProjectLineageArchivesSchema.parse(value);
  for (const item of items) {
    const { fingerprint, ...claim } = item;
    if (fingerprint.sha256 !== archiveHash(claim))
      throw new Error("导入谱系归档指纹不符。");
  }
  return items;
}
export function prepareImportedProjectLineageArchives(packet: {
  schemaVersion: number;
  exportedAt: string;
  lineage?: unknown;
  importedLineageArchives?: unknown;
}): ImportedProjectLineageArchive[] {
  const prior = verifyImportedProjectLineageArchives(
    packet.importedLineageArchives ?? [],
  );
  if (packet.schemaVersion !== 5) {
    if (prior.length) throw new Error("旧项目包不能伪造新谱系。");
    return [];
  }
  const claim = ImportedProjectLineageClaimSchema.parse({
    format: "project-package-imported-lineage-v1",
    sourcePackageSchemaVersion: 5,
    sourceExportedAt: packet.exportedAt,
    trust: "imported-claim-not-local-workflow-or-authority",
    lineage: packet.lineage,
  });
  const item = ImportedProjectLineageArchiveSchema.parse({
    ...claim,
    fingerprint: {
      format: "derived-canonical-imported-claim-v1",
      sha256: archiveHash(claim),
    },
  });
  return verifyImportedProjectLineageArchives([
    ...prior.filter(
      (value) => value.fingerprint.sha256 !== item.fingerprint.sha256,
    ),
    item,
  ]);
}
export function writeImportedProjectLineageArchives(
  transaction: UnitOfWorkTransaction,
  projectId: string,
  archives: readonly ImportedProjectLineageArchive[],
): void {
  for (const item of verifyImportedProjectLineageArchives(archives))
    transaction.run(
      "INSERT INTO workspace_imported_lineage_archives(project_id,fingerprint,archive_json,created_at) VALUES(?,?,?,?)",
      projectId,
      item.fingerprint.sha256,
      JSON.stringify(item),
      new Date().toISOString(),
    );
}
export function collectImportedProjectLineageArchives(
  context: PluginContext,
  projectId: string,
): ImportedProjectLineageArchive[] {
  try {
    return context.uow.execute((transaction) => {
      const rows = transaction.all<{
        fingerprint: string;
        archive_json: string;
      }>(
        "SELECT fingerprint,archive_json FROM workspace_imported_lineage_archives WHERE project_id=? ORDER BY fingerprint",
        projectId,
      );
      const items = verifyImportedProjectLineageArchives(
        rows.map((row) => JSON.parse(row.archive_json)),
      );
      items.forEach((item, index) => {
        if (item.fingerprint.sha256 !== rows[index]!.fingerprint)
          throw new Error("原归档索引不符。");
      });
      return items;
    });
  } catch {
    throw new Error(
      "项目包导入谱系归档暂不可完整核对，未导出部分记录；请恢复来源后重试。",
    );
  }
}
export const importedProjectLineageMigration: PluginMigration = {
  id: "workspace.0011.imported-lineage-archives",
  pluginId: "workspace",
  version: "3.0.0-alpha.4",
  dependsOn: ["workspace.0010.ordinary-import-commits"],
  sql: `CREATE TABLE workspace_imported_lineage_archives (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    archive_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(project_id,fingerprint)
  );`,
};

import {
  PRODUCTION_PROJECT_LINEAGE_SERVICE,
  ProductionProjectLineagePageSchema,
  type ProductionProjectLineageItem,
} from "@dramaip/contracts/creation-project-lineage";
function collectProductionProjectPackageLineage(
  context: PluginContext,
  projectId: string,
) {
  try {
    const service = optionalService(
      context,
      PRODUCTION_PROJECT_LINEAGE_SERVICE,
    );
    if (!service) return { state: "unavailable" as const };
    const output: {
      records: ProductionProjectLineageItem[];
      results: ProductionProjectLineageItem[];
      attributions: ProductionProjectLineageItem[];
    } = { records: [], results: [], attributions: [] };
    for (const category of ["records", "results", "attributions"] as const) {
      let cursor: string | undefined;
      const ids = new Set<string>(),
        cursors = new Set<string>();
      let completed = false;
      for (let index = 0; index < 10000; index++) {
        const page = ProductionProjectLineagePageSchema.parse(
          service.list(projectId, category, { cursor, limit: 25 }),
        );
        if (page.category !== category) throw Error("Invalid owner category");
        for (const item of page.items) {
          const kind =
            category === "records"
              ? "record"
              : category === "results"
                ? "formal-result"
                : "shot-attribution";
          if (
            item.projectId !== projectId ||
            item.kind !== kind ||
            ids.has(item.id)
          )
            throw Error("Invalid owner identity");
          ids.add(item.id);
          output[category].push(item);
        }
        if (!page.nextCursor) {
          completed = true;
          break;
        }
        if (!page.items.length || cursors.has(page.nextCursor))
          throw Error("Invalid owner cursor");
        cursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }
      if (!completed) throw Error("Owner page guard exceeded");
    }
    return {
      state: "available" as const,
      coverage: "recorded-production-owner-rows-only" as const,
      ...output,
    };
  } catch {
    throw new Error(
      "项目包制作谱系暂不可完整核对，未导出部分记录或修改原内容；请恢复来源后重试。",
    );
  }
}

import {
  KNOWLEDGE_PROJECT_LINEAGE_SERVICE,
  KnowledgeProjectLineagePageSchema,
  knowledgeProjectLineageIdentity,
  type KnowledgeProjectLineageItem,
  type KnowledgeProjectLineageCategory,
} from "@dramaip/contracts/creation-project-lineage";
function collectKnowledgeProjectPackageLineage(
  context: PluginContext,
  projectId: string,
) {
  try {
    const service = optionalService(context, KNOWLEDGE_PROJECT_LINEAGE_SERVICE);
    if (!service) return { state: "unavailable" as const };
    const output: Record<
      KnowledgeProjectLineageCategory,
      KnowledgeProjectLineageItem[]
    > = { declarations: [], assertions: [], summaries: [], transitions: [] };
    for (const category of [
      "declarations",
      "assertions",
      "summaries",
      "transitions",
    ] as const) {
      let cursor: string | undefined,
        completed = false;
      const ids = new Set<string>(),
        cursors = new Set<string>();
      const kind = {
        declarations: "declaration",
        assertions: "assertion",
        summaries: "summary",
        transitions: "source-transition",
      }[category];
      for (let index = 0; index < 10000; index++) {
        const page = KnowledgeProjectLineagePageSchema.parse(
          service.list(projectId, category, { cursor, limit: 25 }),
        );
        if (page.category !== category) throw Error("Invalid owner category");
        for (const item of page.items) {
          const identity = knowledgeProjectLineageIdentity(item);
          if (
            item.projectId !== projectId ||
            item.kind !== kind ||
            ids.has(identity)
          )
            throw Error("Invalid owner identity");
          ids.add(identity);
          output[category].push(item);
        }
        if (!page.nextCursor) {
          completed = true;
          break;
        }
        if (!page.items.length || cursors.has(page.nextCursor))
          throw Error("Invalid owner cursor");
        cursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }
      if (!completed) throw Error("Owner page guard exceeded");
    }
    return {
      state: "available" as const,
      coverage: "recorded-knowledge-owner-rows-only" as const,
      ...output,
    };
  } catch {
    throw new Error(
      "项目包知识谱系暂不可完整核对，未导出部分记录或修改原内容；请恢复来源后重试。",
    );
  }
}

import {
  WORKSPACE_PROJECT_LINEAGE_SERVICE,
  WorkspaceProjectLineagePageSchema,
  WorkspaceProjectPackageLineageSchema,
  type WorkspaceProjectLineageReceipt,
} from "@dramaip/contracts/creation-project-lineage";
export function collectWorkspaceProjectPackageLineage(
  context: PluginContext,
  projectId: string,
) {
  const service = optionalService(context, WORKSPACE_PROJECT_LINEAGE_SERVICE);
  if (!service)
    return WorkspaceProjectPackageLineageSchema.parse({ state: "unavailable" });
  try {
    const items: WorkspaceProjectLineageReceipt[] = [],
      ids = new Set<string>(),
      cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10_000; page++) {
      const value = WorkspaceProjectLineagePageSchema.parse(
        service.list(projectId, { cursor, limit: 25 }),
      );
      for (const item of value.items) {
        if (item.projectId !== projectId || ids.has(item.id))
          throw Error("Invalid owner receipt");
        ids.add(item.id);
        items.push(item);
      }
      if (!value.nextCursor)
        return WorkspaceProjectPackageLineageSchema.parse({
          state: "available",
          coverage: "recorded-workspace-author-intent-rows-only",
          authorIntents: items,
        });
      if (!value.items.length || cursors.has(value.nextCursor))
        throw Error("Invalid owner cursor");
      cursors.add(value.nextCursor);
      cursor = value.nextCursor;
    }
    throw Error("Owner pagination guard exceeded");
  } catch {
    throw Error(
      "项目包作者意图谱系暂不可完整核对，未导出部分记录或改动原意图；请恢复来源后重试。",
    );
  }
}

import {
  QUALITY_PROJECT_LINEAGE_SERVICE,
  QualityProjectLineageCategorySchema,
  QualityProjectLineagePageSchema,
  QualityProjectPackageLineageSchema,
  type QualityProjectLineageItem,
} from "@dramaip/contracts/creation-project-lineage";
export function collectQualityProjectPackageLineage(
  context: PluginContext,
  projectId: string,
) {
  const service = optionalService(context, QUALITY_PROJECT_LINEAGE_SERVICE);
  if (!service)
    return QualityProjectPackageLineageSchema.parse({ state: "unavailable" });
  try {
    const arrays: Record<
      "reports" | "localReviews",
      QualityProjectLineageItem[]
    > = { reports: [], localReviews: [] };
    for (const category of QualityProjectLineageCategorySchema.options) {
      const ids = new Set<string>(),
        cursors = new Set<string>();
      let cursor: string | undefined,
        complete = false;
      for (let index = 0; index < 10_000; index++) {
        const page = QualityProjectLineagePageSchema.parse(
          service.list(projectId, category, { cursor, limit: 25 }),
        );
        if (page.category !== category) throw Error("Wrong owner category");
        for (const item of page.items) {
          if (
            item.projectId !== projectId ||
            item.kind !==
              (category === "reports" ? "model-report" : "local-review") ||
            ids.has(item.id)
          )
            throw Error("Invalid owner item");
          ids.add(item.id);
          arrays[category].push(item);
        }
        if (!page.nextCursor) {
          complete = true;
          break;
        }
        if (!page.items.length || cursors.has(page.nextCursor))
          throw Error("Invalid owner cursor");
        cursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }
      if (!complete) throw Error("Owner pagination guard exceeded");
    }
    return QualityProjectPackageLineageSchema.parse({
      state: "available",
      coverage: "recorded-quality-model-and-local-owner-rows-only",
      ...arrays,
    });
  } catch {
    throw Error(
      "项目包质量谱系暂不可完整核对，未导出部分记录或改动原评议；请恢复来源后重试。",
    );
  }
}
