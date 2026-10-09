import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import { CreativeSourceConfirmationFactSchema } from "@dramaip/contracts/insights";
import {
  ScreenplayIntakeCreateSchema,
  ScreenplayIntakeCommitSchema,
  ScreenplayIntakePreviewSchema,
  type ScreenplayIntakePreview,
} from "@dramaip/contracts/production";
import {
  WORKSPACE_PROJECT_SERVICE,
  canonicalImportRequestJSON,
} from "@dramaip/contracts/workspace";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import {
  optionalService,
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { parseFountain, parseFdx } from "./screenplay-codec.js";
import { directScriptSourceContent } from "./direct-script-source.js";
import { parseStructuredScriptIntake } from "./structured-script-intake.js";

export const screenplayIntakeMigration: PluginMigration = {
  id: "production.0009.projectless-screenplay-intakes",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0008.screenplay-import-receipts"],
  sql: `CREATE TABLE production_screenplay_intakes (
    id TEXT PRIMARY KEY, create_hash TEXT NOT NULL,
    request_key TEXT UNIQUE, request_hash TEXT, value_json TEXT NOT NULL
  );`,
};
type Row = {
  create_hash: string;
  request_hash: string | null;
  value_json: string;
};
type HttpContext = {
  req: {
    param(name: string): string;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
  json(value: unknown, status?: number): Response;
};
class IntakeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function registerScreenplayIntakes(
  ctx: PluginContext,
  host?: DesktopHostClient,
) {
  const workspace = () => {
    const service = optionalService(ctx, WORKSPACE_PROJECT_SERVICE);
    if (!service)
      throw new IntakeError(409, "项目服务尚不可用；没有创建项目。");
    return service;
  };
  const read = (id: string) =>
    ctx.uow.execute((tx) =>
      tx.get<Row>(
        "SELECT * FROM production_screenplay_intakes WHERE id = ?",
        id,
      ),
    );
  const value = (row?: Row) => {
    if (!row)
      throw new IntakeError(404, "未找到同一原生文件预览；不会换稿或重建。");
    return ScreenplayIntakePreviewSchema.parse(JSON.parse(row.value_json));
  };
  const save = (
    tx: UnitOfWorkTransaction,
    preview: ScreenplayIntakePreview,
  ) => {
    tx.run(
      "UPDATE production_screenplay_intakes SET value_json = ? WHERE id = ?",
      JSON.stringify(preview),
      preview.id,
    );
    tx.append({
      type: "production.screenplay-intake-state-changed.v1",
      pluginId: "production",
      aggregateType: "screenplay-intake",
      aggregateId: preview.id,
      aggregateVersion: [
        "pending",
        "creating",
        "materialized",
        "committed",
        "discarded",
      ].indexOf(preview.status),
      payload: {
        previewId: preview.id,
        status: preview.status,
        ...(preview.receipt ? { receipt: preview.receipt } : {}),
      },
    });
  };
  // Read own authoritative records/AST without initializing missing documents.
  const materialCurrent = (preview: ScreenplayIntakePreview) => {
    const receipt = preview.receipt;
    if (!receipt) return false;
    return ctx.uow.execute((tx) => {
      const records = tx.all<{
        id: string;
        kind: string;
        project_id: string;
        parent_id: string | null;
        version: number;
      }>(
        "SELECT id, kind, project_id, parent_id, version FROM production_records WHERE project_id = ?",
        receipt.projectId,
      );
      const byId = new Map(records.map((record) => [record.id, record]));
      const same = (
        id: string,
        kind: string,
        version: number,
        parentId?: string,
      ) =>
        byId.get(id)?.kind === kind &&
        byId.get(id)?.version === version &&
        (parentId === undefined || byId.get(id)?.parent_id === parentId);
      if (!same(receipt.adaptationId, "adaptations", receipt.adaptationVersion))
        return false;
      return (receipt.episodes ?? [{ ...receipt, scenes: [] }]).every(
        (entry) => {
          const document = tx.get<{
            id: string;
            version: number;
            project_id: string;
          }>(
            "SELECT id, version, project_id FROM screenplay_documents WHERE script_record_id = ?",
            entry.scriptId,
          );
          return (
            same(
              entry.episodeId,
              "episodes",
              entry.episodeVersion,
              receipt.adaptationId,
            ) &&
            same(
              entry.scriptId,
              "scripts",
              entry.scriptVersion,
              entry.episodeId,
            ) &&
            document?.id === entry.documentId &&
            document.version === entry.documentVersion &&
            document.project_id === receipt.projectId &&
            entry.scenes.every((scene) =>
              same(scene.id, "scenes", scene.version, entry.scriptId),
            )
          );
        },
      );
    });
  };
  const projectCurrent = (preview: ScreenplayIntakePreview) => {
    const receipt = preview.receipt;
    if (!receipt) return false;
    const project = workspace().get(receipt.projectId);
    return (
      project?.modeConfig.mode === "single_season" &&
      project.modeConfig.entryPath === "script" &&
      ((project.version === receipt.projectVersion &&
        (preview.status === "materialized"
          ? !project.currentAdaptationId
          : project.currentAdaptationId === receipt.adaptationId)) ||
        // Selection already committed, but the final intake write was interrupted.
        (preview.status === "materialized" &&
          project.version === receipt.projectVersion + 1 &&
          project.currentAdaptationId === receipt.adaptationId))
    );
  };
  const projectPreview = (
    preview: ScreenplayIntakePreview,
  ): ScreenplayIntakePreview => ({
    ...preview,
    sourceState: preview.receipt
      ? materialCurrent(preview) && projectCurrent(preview)
        ? "current"
        : "stale"
      : "unknown",
  });
  const add = (
    method: "get" | "post" | "delete",
    path: `/api/v2/${string}`,
    operationId: string,
    handler: (c: HttpContext) => unknown | Promise<unknown>,
    body?: z.ZodType,
  ) => {
    const commit = operationId === "screenplayIntakes.commit";
    const mutate = method !== "get";
    const params = path.includes("{id}")
      ? z.object({ id: z.string().uuid() })
      : undefined;
    const route = defineRouteContribution({
      id: `production:${operationId}`,
      pluginId: "production",
      method,
      path,
      operationId,
      ...(method === "post"
        ? {
            policy: {
              idempotency: "required",
              idempotencyReplay: "handler",
              ...(commit ? { concurrency: "if-match-required" } : {}),
            } as const,
          }
        : {}),
      declaration: createRoute({
        method,
        path,
        operationId,
        tags: ["screenplay-intakes"],
        request: {
          ...(params ? { params } : {}),
          ...(mutate
            ? {
                headers: z.object({
                  ...(method === "post"
                    ? { "idempotency-key": z.string().min(8).max(200) }
                    : {}),
                  ...(params ? { "if-match": z.string().min(1) } : {}),
                }),
              }
            : {}),
          ...(body
            ? {
                body: {
                  required: true,
                  content: { "application/json": { schema: body } },
                },
              }
            : {}),
        },
        responses: {
          [method === "post" ? 201 : 200]: {
            description: "Exact intake state",
            content: {
              "application/json": { schema: ScreenplayIntakePreviewSchema },
            },
          },
          400: {
            description: "Invalid request",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
          404: {
            description: "Missing preview",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
          409: {
            description: "Conflict",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
        },
      }),
      handler: async (c: HttpContext) => {
        try {
          return await handler(c);
        } catch (error) {
          const status = error instanceof IntakeError ? error.status : 500;
          const message =
            error instanceof IntakeError
              ? error.message
              : "同一次创建／初始化尚未核验；保留原预览，只读恢复，不自动重试。";
          const response = c.json(
            {
              type: "https://dramaip.local/problems/screenplay_intake",
              title: message,
              detail: message,
              status,
              code: "SCREENPLAY_INTAKE",
              traceId: crypto.randomUUID(),
            },
            status,
          );
          response.headers.set("Content-Type", "application/problem+json");
          return response;
        }
      },
    });
    ctx.effect(() => ctx.http.register(route), `route:${route.id}`);
  };
  add(
    "post",
    "/api/v2/screenplay-intakes",
    "screenplayIntakes.preview",
    async (c) => {
      const input = ScreenplayIntakeCreateSchema.safeParse(await c.req.json());
      if (
        !input.success ||
        c.req.header("Idempotency-Key") !== input.data.previewId
      )
        throw new IntakeError(400, "预览身份与恢复键无效；没有创建项目。");
      const existing = read(input.data.previewId);
      if (existing) {
        if (existing.create_hash !== hash(input.data))
          throw new IntakeError(409, "预览恢复键不能换文件。");
        return c.json(projectPreview(value(existing)), 201);
      }
      if (!host)
        throw new IntakeError(409, "本地文件读取不可用；没有创建项目。");
      const file = await host.readGrantedDocument(
        input.data.grantId,
        32 * 1024 * 1024,
      );
      if (
        file.format !== "fountain" &&
        file.format !== "fdx" &&
        file.format !== "script-json"
      )
        throw new IntakeError(
          400,
          "创建前剧本文件只支持 Fountain／FDX／结构化 JSON；PDF／OCR 不可用。",
        );
      let parsed;
      try {
        parsed =
          file.format === "script-json"
            ? parseStructuredScriptIntake(file.name, file.content)
            : file.format === "fountain"
              ? parseFountain(file.content)
              : parseFdx(file.content);
      } catch {
        throw new IntakeError(400, "文件无法安全解析；未创建项目或写入原稿。");
      }
      const preview: ScreenplayIntakePreview = {
        id: input.data.previewId,
        sourceName: file.name.slice(0, 240),
        sourceFormat: file.format,
        ...parsed,
        etag: `"screenplay-intake:${input.data.previewId}:0"`,
        status: "pending",
        createdAt: new Date().toISOString(),
        sourceState: "unknown",
      };
      const saved = ctx.uow.execute((tx) => {
        // A concurrent file read cannot replace the winner's immutable AST/IDs.
        const winner = tx.get<Row>(
          "SELECT * FROM production_screenplay_intakes WHERE id = ?",
          preview.id,
        );
        if (winner) {
          if (winner.create_hash !== hash(input.data))
            throw new IntakeError(409, "预览恢复键不能换文件。");
          return value(winner);
        }
        tx.run(
          "INSERT INTO production_screenplay_intakes(id, create_hash, value_json) VALUES (?, ?, ?)",
          preview.id,
          hash(input.data),
          JSON.stringify(preview),
        );
        save(tx, preview);
        return preview;
      });
      return c.json(projectPreview(saved), 201);
    },
    ScreenplayIntakeCreateSchema,
  );
  add("get", "/api/v2/screenplay-intakes/{id}", "screenplayIntakes.get", (c) =>
    c.json(projectPreview(value(read(c.req.param("id"))))),
  );
  add(
    "delete",
    "/api/v2/screenplay-intakes/{id}",
    "screenplayIntakes.discard",
    (c) => {
      const discarded = ctx.uow.execute((tx) => {
        const preview = value(
          tx.get<Row>(
            "SELECT * FROM production_screenplay_intakes WHERE id = ?",
            c.req.param("id"),
          ),
        );
        if (
          preview.status !== "pending" ||
          preview.etag !== c.req.header("If-Match")
        )
          throw new IntakeError(
            409,
            "只能撤销同一未提交预览；已开始创建的项目和原稿保持不变。",
          );
        preview.status = "discarded";
        save(tx, preview);
        return preview;
      });
      return c.json(discarded);
    },
  );
  add(
    "post",
    "/api/v2/screenplay-intakes/{id}/commit",
    "screenplayIntakes.commit",
    async (c) => {
      const input = ScreenplayIntakeCommitSchema.safeParse(await c.req.json());
      const key = c.req.header("Idempotency-Key")?.trim();
      if (
        !input.success ||
        input.data.previewId !== c.req.param("id") ||
        !key ||
        key.length < 8 ||
        key.length > 200
      )
        throw new IntakeError(
          400,
          "项目目标、声明或同次创建身份无效；没有创建项目。",
        );
      const digest = hash(input.data);
      let preview = ctx.uow.execute((tx) => {
        const row = tx.get<Row>(
          "SELECT * FROM production_screenplay_intakes WHERE id = ?",
          input.data.previewId,
        );
        const saved = value(row);
        if (
          saved.etag !== c.req.header("If-Match") ||
          saved.status === "discarded"
        )
          throw new IntakeError(409, "预览已撤销或版本不符；不会创建项目。");
        if (saved.status !== "pending") {
          if (saved.requestKey !== key || row!.request_hash !== digest)
            throw new IntakeError(409, "已确认创建不能换目标、输入或恢复键。");
          return saved;
        }
        const originals = saved.episodes ?? [
          { blocks: saved.blocks, lossReport: saved.lossReport },
        ];
        const allBlocks = originals.flatMap((original) => original.blocks);
        if (
          new Set(allBlocks.map((block) => block.id)).size !==
            allBlocks.length ||
          !originals.every((original) =>
            directScriptSourceContent(undefined, {
              version: 0,
              blocks_json: JSON.stringify(original.blocks),
              source_format:
                saved.sourceFormat === "script-json"
                  ? "native"
                  : saved.sourceFormat,
              loss_report_json: JSON.stringify(original.lossReport),
            }),
          )
        )
          throw new IntakeError(
            409,
            "没有有效动作／对白；空稿或排版占位不能创建剧本项目。",
          );
        if (
          tx.get(
            "SELECT id FROM production_screenplay_intakes WHERE request_key = ?",
            key,
          )
        )
          throw new IntakeError(409, "创建恢复键已绑定另一预览。");
        saved.status = "creating";
        saved.requestKey = key;
        saved.request = input.data;
        tx.run(
          "UPDATE production_screenplay_intakes SET request_key = ?, request_hash = ? WHERE id = ?",
          key,
          digest,
          saved.id,
        );
        save(tx, saved);
        return saved;
      });
      if (preview.status === "committed")
        return c.json(projectPreview(preview), 201);
      const projects = workspace();
      if (!preview.receipt) {
        const created = projects.createIdempotent(
          input.data.project,
          `screenplay-intake:${preview.id}:${key}`,
        );
        const current = projects.get(created.id);
        if (!current || current.version !== 0 || current.currentAdaptationId)
          throw new IntakeError(
            409,
            "同次创建的项目已变化或删除；不覆盖、不创建替代项目。",
          );
        preview = ctx.uow.execute((tx) => {
          const saved = value(
            tx.get<Row>(
              "SELECT * FROM production_screenplay_intakes WHERE id = ?",
              preview.id,
            ),
          );
          if (saved.receipt) return saved;
          const now = new Date().toISOString();
          const adaptationId = crypto.randomUUID();
          const metadata = {
            初始化来源: "native-screenplay-intake-v1",
            导入预览: saved.id,
          };
          const insertRecord = (
            id: string,
            kind: string,
            parentId: string | null,
            title: string,
            orderIndex: number,
            payload: Record<string, unknown> = {},
          ) => {
            tx.run(
              `INSERT INTO production_records(id, kind, project_id, parent_id, title, payload_json, order_index, version, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
              id,
              kind,
              current.id,
              parentId,
              title,
              JSON.stringify({ ...payload, ...metadata }),
              orderIndex,
              now,
              now,
            );
            // Public event projections contain initialization metadata, never source bodies/scene attributes.
            tx.append({
              type: `production.${kind}-created.v1`,
              pluginId: "production",
              aggregateType: kind,
              aggregateId: id,
              aggregateVersion: 0,
              payload: {
                id,
                kind,
                domain: kind,
                projectId: current.id,
                ...(parentId ? { parentId } : {}),
                title,
                payload: metadata,
                orderIndex,
                version: 0,
                createdAt: now,
                updatedAt: now,
              },
            });
          };
          insertRecord(
            adaptationId,
            "adaptations",
            null,
            saved.episodes
              ? "已有结构化剧本·分集目录"
              : "已有原生剧本·分集目录",
            0,
          );
          const entries: NonNullable<
            NonNullable<ScreenplayIntakePreview["receipt"]>["episodes"]
          > = [];
          for (const [index, source] of (
            saved.episodes ?? [undefined]
          ).entries()) {
            const episodeId = crypto.randomUUID(),
              scriptId = crypto.randomUUID(),
              documentId = crypto.randomUUID();
            const title = source
              ? `${source.title}剧本`.slice(0, 240)
              : saved.sourceName.replace(/\.(fountain|fdx)$/iu, "").trim() ||
                "导入原稿";
            insertRecord(
              episodeId,
              "episodes",
              adaptationId,
              source?.title ?? "第 1 集",
              index,
              source
                ? { 集数: source.episodeNumber, 分集来源身份: source.id }
                : {},
            );
            insertRecord(
              scriptId,
              "scripts",
              episodeId,
              title,
              0,
              source
                ? {
                    剧本内容: source.content,
                    来源表达: source.contentSource,
                    导入来源: saved.sourceName,
                  }
                : {},
            );
            tx.run(
              `INSERT INTO screenplay_documents(id, script_record_id, project_id, title, source_format, blocks_json, loss_report_json, legacy_payload_json, version, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
              documentId,
              scriptId,
              current.id,
              title,
              saved.sourceFormat === "script-json"
                ? "native"
                : saved.sourceFormat,
              JSON.stringify(source?.blocks ?? saved.blocks),
              JSON.stringify(source?.lossReport ?? saved.lossReport),
              now,
              now,
            );
            const scenes = (source?.scenes ?? []).map((scene, sourceIndex) => {
              const id = crypto.randomUUID();
              insertRecord(
                id,
                "scenes",
                scriptId,
                scene.title || `场景 ${sourceIndex + 1}`,
                sourceIndex,
                {
                  ...scene,
                  场景顺序: sourceIndex + 1,
                  // Preserve even fields colliding with our metadata; do not treat source properties as capabilities.
                  原场景资料: scene,
                },
              );
              return { id, version: 0, sourceIndex };
            });
            entries.push({
              previewEpisodeId: source?.id ?? saved.id,
              episodeNumber: source?.episodeNumber ?? 1,
              episodeId,
              episodeVersion: 0,
              scriptId,
              scriptVersion: 0,
              documentId,
              documentVersion: 0,
              scenes,
            });
          }
          const first = entries[0]!;
          saved.status = "materialized";
          saved.receipt = {
            projectId: current.id,
            projectVersion: current.version,
            adaptationId,
            adaptationVersion: 0,
            episodeId: first.episodeId,
            episodeVersion: first.episodeVersion,
            scriptId: first.scriptId,
            scriptVersion: first.scriptVersion,
            documentId: first.documentId,
            documentVersion: first.documentVersion,
            committedAt: now,
            ...(saved.episodes ? { episodes: entries } : {}),
          };
          ScreenplayIntakePreviewSchema.parse(saved);
          save(tx, saved);
          return saved;
        });
      }
      if (!materialCurrent(preview) || !projectCurrent(preview))
        throw new IntakeError(
          409,
          "已初始化原稿／项目发生变化；保留历史，不覆盖或重建。",
        );
      const receipt = preview.receipt!;
      const current = projects.get(receipt.projectId)!;
      const selected =
        current.currentAdaptationId === receipt.adaptationId
          ? current
          : projects.setCurrentAdaptation(
              receipt.projectId,
              receipt.adaptationId,
            );
      if (!selected || selected.currentAdaptationId !== receipt.adaptationId)
        throw new IntakeError(
          409,
          "实际分集目录选择尚未完成；保留同次项目和原稿。",
        );
      preview = ctx.uow.execute((tx) => {
        const saved = value(
          tx.get<Row>(
            "SELECT * FROM production_screenplay_intakes WHERE id = ?",
            preview.id,
          ),
        );
        if (saved.status === "committed") return saved;
        saved.status = "committed";
        saved.receipt!.projectVersion = selected.version;
        save(tx, saved);
        const originalReceipt = saved.receipt!;
        const entries = originalReceipt.episodes ?? [
          {
            previewEpisodeId: saved.id,
            scriptId: originalReceipt.scriptId,
            scriptVersion: originalReceipt.scriptVersion,
            documentId: originalReceipt.documentId,
            documentVersion: originalReceipt.documentVersion,
            scenes: [],
          },
        ];
        const sourceDigest = (value: unknown) =>
          createHash("sha256")
            .update(canonicalImportRequestJSON(value))
            .digest("hex");
        tx.append({
          type: "production.creation-source-confirmed.v1",
          pluginId: "production",
          aggregateType: "screenplay-intake",
          aggregateId: saved.id,
          aggregateVersion: 3,
          payload: CreativeSourceConfirmationFactSchema.parse({
            eventVersion: 1,
            owner: "production",
            sourceId: saved.id,
            projectId: originalReceipt.projectId,
            projectVersion: originalReceipt.projectVersion,
            projectMode: selected.mode,
            workflowPath: "adaptation",
            entry: "native-screenplay-intake",
            sourceFormat: saved.sourceFormat,
            contentKind: "script",
            scopePolicy: "confirmed-parsed-entries-not-entire-file",
            entryCount: entries.length,
            sceneCount: entries.reduce(
              (sum, episode) => sum + episode.scenes.length,
              0,
            ),
            entries: entries.map((episode, sourceIndex) => ({
              kind: "script-document",
              sourceIndex,
              previewEntryId: episode.previewEpisodeId,
              id: episode.documentId,
              version: episode.documentVersion,
              scriptId: episode.scriptId,
              scriptVersion: episode.scriptVersion,
            })),
            bindingFingerprint: sourceDigest({
              request: saved.request,
              preview: {
                id: saved.id,
                sourceFormat: saved.sourceFormat,
                etag: saved.etag,
                blocks: saved.blocks,
                episodes: saved.episodes,
                lossReport: saved.lossReport,
              },
            }),
            receiptFingerprint: sourceDigest(originalReceipt),
            rightsState: "declared-not-verified",
            lossReportReviewed: true,
            evidenceKind: "explicit-source-declaration-and-owner-commit",
            modelEvidence: "unknown",
            qualityState: "unverified",
            currentValidity: "not-assessed",
          }),
        });
        return saved;
      });
      return c.json(projectPreview(preview), 201);
    },
    ScreenplayIntakeCommitSchema,
  );
}
