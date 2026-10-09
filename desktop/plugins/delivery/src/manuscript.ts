import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import { CreativeOutcomeFactSchema } from "@dramaip/contracts/insights";
import {
  ManuscriptPageSchema,
  ManuscriptPreviewInputSchema,
  ManuscriptPreviewSchema,
  ManuscriptReceiptSchema,
  ManuscriptRecordSchema,
  ManuscriptSaveInputSchema,
  type ManuscriptPreview,
  type ManuscriptRecord,
} from "@dramaip/contracts/delivery";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import type { WritingChapterService } from "@dramaip/contracts/writing";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export interface ManuscriptHost {
  saveBinaryFile?(input: {
    suggestedName: string;
    contentBase64: string;
    mimeType: "application/zip";
  }): Promise<{
    saved: boolean;
    artifactRef?: string;
    sha256?: string;
    byteSize?: number;
    savedAt?: string;
  }>;
  saveTextFile(input: { suggestedName: string; content: string }): Promise<{
    saved: boolean;
    artifactRef?: string;
    sha256?: string;
    byteSize?: number;
    savedAt?: string;
  }>;
}

export const manuscriptMigration: PluginMigration = {
  id: "delivery.0003.manuscripts",
  pluginId: "delivery",
  version: "3.0.0-alpha.3",
  dependsOn: ["delivery.0001.records"],
  sql: `
    CREATE TABLE delivery_manuscripts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      request_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      save_key TEXT,
      save_hash TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX delivery_manuscripts_project_cursor
      ON delivery_manuscripts(project_id, created_at, id);
  `,
};

interface Row {
  id: string;
  project_id: string;
  request_key: string;
  request_hash: string;
  snapshot_json: string;
  save_key: string | null;
  save_hash: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}
interface RequestContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const projectParams = z.object({ projectId: z.string().uuid() });
const idParams = z.object({ id: z.string().uuid() });
const pageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function problem(
  c: RequestContext,
  status: number,
  code: string,
  detail: string,
) {
  return c.json(
    {
      type: `https://dramaip.local/problems/${code.toLowerCase()}`,
      title: detail,
      detail,
      status,
      code,
      traceId: crypto.randomUUID(),
    },
    status,
  );
}

function append(tx: UnitOfWorkTransaction, value: ManuscriptPreview) {
  // Local domain facts contain refs/digests, never the manuscript or paths.
  tx.append({
    type: "delivery.manuscript-updated.v1",
    pluginId: "delivery",
    aggregateType: "manuscript",
    aggregateId: value.id,
    aggregateVersion: value.version,
    payload: {
      projectId: value.manifest.projectId,
      status: value.status,
      contentSha256: value.manifest.contentSha256,
      chapterVersions: value.manifest.chapters.map(({ id, version }) => ({
        id,
        version,
      })),
    },
  });
}

export function manuscriptRoutes(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  writing: WritingChapterService,
  host?: ManuscriptHost,
): RouteContribution[] {
  const read = (id: string) =>
    context.uow.execute((tx) =>
      tx.get<Row>("SELECT * FROM delivery_manuscripts WHERE id = ?", id),
    );
  const decode = (row: Row): ManuscriptPreview => {
    const value = ManuscriptPreviewSchema.parse(JSON.parse(row.snapshot_json));
    const project = workspace.get(row.project_id);
    const issues: string[] = [];
    if (!project || project.version !== value.manifest.projectVersion)
      issues.push("项目版本已变化或项目已删除。");
    const current = writing
      .list(row.project_id)
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex);
    for (const source of value.manifest.chapters) {
      const chapter = current.find((item) => item.id === source.id);
      if (
        !chapter ||
        chapter.version !== source.version ||
        chapter.orderIndex !== source.orderIndex ||
        chapter.title !== source.title ||
        hash(chapter.content) !== source.contentSha256
      )
        issues.push(`章节「${source.title}」版本、目录或正文已变化。`);
    }
    if (
      value.manifest.scope === "whole-project" &&
      (current.length !== value.manifest.chapters.length ||
        current.some(
          (item, index) => item.id !== value.manifest.chapters[index]?.id,
        ))
    )
      issues.push("完整稿件的章节范围或顺序已变化。");
    return {
      ...value,
      version: row.version,
      updatedAt: row.updated_at,
      sourceState: issues.length ? "stale" : "current",
      sourceIssues: issues,
    };
  };
  const summarize = (value: ManuscriptPreview): ManuscriptRecord => {
    // The list/read-only cockpit never needs private manuscript text.
    return ManuscriptRecordSchema.parse(value);
  };
  const respond = (c: RequestContext, row: Row, status = 200) => {
    c.header("ETag", `"${row.version}"`);
    return c.json(decode(row), status);
  };
  const routes: RouteContribution[] = [];
  const add = (
    method: "get" | "post",
    path: `/api/v2/${string}`,
    operationId: string,
    params: z.ZodType,
    response: z.ZodType,
    handler: (c: RequestContext) => Response | Promise<Response>,
    body?: z.ZodType,
    query?: z.ZodType,
  ) => {
    routes.push(
      defineRouteContribution({
        id: `delivery:${operationId}`,
        pluginId: "delivery",
        method,
        path,
        operationId,
        declaration: createRoute({
          method,
          path,
          operationId,
          tags: ["delivery"],
          request: {
            params,
            ...(query ? { query } : {}),
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
            200: {
              description: "Manuscript result",
              content: { "application/json": { schema: response } },
            },
            ...Object.fromEntries(
              [400, 404, 409, 428, 503].map((status) => [
                status,
                {
                  description: "Request cannot be completed",
                  content: {
                    "application/problem+json": {
                      schema: ProblemDetailsSchema,
                    },
                  },
                },
              ]),
            ),
          },
        } as never),
        handler,
        policy: {
          idempotency: method === "post" ? "required" : "forbidden",
          concurrency:
            operationId === "manuscripts.save"
              ? "if-match-required"
              : "optional",
          // The explicit native save dialog may remain open for the author.
          timeoutMs: operationId === "manuscripts.save" ? 300_000 : 30_000,
        },
      }),
    );
  };
  add(
    "post",
    "/api/v2/projects/{projectId}/manuscripts",
    "manuscripts.preview",
    projectParams,
    ManuscriptPreviewSchema,
    async (c) => {
      const parsed = ManuscriptPreviewInputSchema.safeParse(await c.req.json());
      if (!parsed.success)
        return problem(c, 400, "VALIDATION_ERROR", "稿件范围或版本参数无效。");
      const projectId = c.req.param("projectId");
      const requestKey = `${projectId}:${c.req.header("Idempotency-Key")}`;
      const requestHash = hash(JSON.stringify(parsed.data));
      const previous = context.uow.execute((tx) =>
        tx.get<Row>(
          "SELECT * FROM delivery_manuscripts WHERE request_key = ?",
          requestKey,
        ),
      );
      if (previous)
        return previous.request_hash === requestHash
          ? respond(c, previous)
          : problem(
              c,
              409,
              "IDEMPOTENCY_CONFLICT",
              "同一预览请求标识不能用于不同稿件。",
            );
      const project = workspace.get(projectId);
      if (!project) return problem(c, 404, "NOT_FOUND", "未找到项目。");
      if (project.version !== parsed.data.projectVersion)
        return problem(
          c,
          409,
          "SOURCE_CONFLICT",
          "项目已变化，请刷新后重新确认范围。",
        );
      const all = writing
        .list(projectId)
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex);
      const ids = new Set(parsed.data.chapters.map((item) => item.id));
      const chapters = all.filter((item) => ids.has(item.id));
      if (
        ids.size !== parsed.data.chapters.length ||
        chapters.length !== ids.size
      )
        return problem(
          c,
          400,
          "INVALID_RANGE",
          "范围含重复、缺失或其他项目的章节。",
        );
      if (chapters.some((chapter) => !chapter.content.trim()))
        return problem(
          c,
          409,
          "EMPTY_MANUSCRIPT",
          "所选章节有空正文，请完善稿件或明确排除空章。",
        );
      if (
        chapters.some(
          (chapter) =>
            parsed.data.chapters.find((item) => item.id === chapter.id)
              ?.version !== chapter.version,
        ) ||
        (parsed.data.scope === "whole-project" &&
          all.length !== chapters.length)
      )
        return problem(
          c,
          409,
          "SOURCE_CONFLICT",
          "章节版本或完整稿件范围已变化，请重新确认。",
        );
      const now = new Date().toISOString();
      const format = parsed.data.format;
      const content =
        format === "markdown"
          ? `# ${project.title}\n\n${project.synopsis}\n\n${chapters.map((item) => `## ${item.title}\n\n${item.content}`).join("\n\n")}\n`
          : JSON.stringify(
              {
                format: "dramaip-manuscript",
                schemaVersion: 1,
                title: project.title,
                synopsis: project.synopsis,
                scope: parsed.data.scope,
                chapters: chapters.map(({ id, title, content, version }) => ({
                  id,
                  title,
                  content,
                  version,
                })),
              },
              null,
              2,
            );
      const value: ManuscriptPreview = {
        id: crypto.randomUUID(),
        version: 0,
        status: "awaiting-confirmation",
        sourceState: "current",
        sourceIssues: [],
        createdAt: now,
        updatedAt: now,
        manifest: {
          schemaVersion: 1,
          projectId,
          projectVersion: project.version,
          projectTitle: project.title,
          scope: parsed.data.scope,
          format,
          fileName: `${project.title.replace(/[\\/:*?"<>|]/gu, "-").slice(0, 80)}-submission.${format === "markdown" ? "md" : "json"}`,
          chapters: chapters.map((item) => ({
            id: item.id,
            version: item.version,
            title: item.title,
            orderIndex: item.orderIndex,
            contentSha256: hash(item.content),
          })),
          contentSha256: hash(content),
          byteSize: Buffer.byteLength(content, "utf8"),
          createdAt: now,
        },
        document: {
          content,
          mimeType:
            format === "markdown" ? "text/markdown" : "application/json",
        },
      };
      context.uow.execute((tx) => {
        tx.run(
          `INSERT INTO delivery_manuscripts(id, project_id, request_key, request_hash,
          snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          value.id,
          projectId,
          requestKey,
          requestHash,
          JSON.stringify(value),
          now,
          now,
        );
        append(tx, value);
      });
      return respond(c, read(value.id)!);
    },
    ManuscriptPreviewInputSchema,
  );
  add(
    "get",
    "/api/v2/projects/{projectId}/manuscripts",
    "manuscripts.list",
    projectParams,
    ManuscriptPageSchema,
    (c) => {
      const projectId = c.req.param("projectId");
      if (!workspace.get(projectId))
        return problem(c, 404, "NOT_FOUND", "未找到项目。");
      const parsed = pageQuery.safeParse({
        cursor: c.req.query("cursor"),
        limit: c.req.query("limit") ?? 25,
      });
      const parts = parsed.success
        ? (parsed.data.cursor?.split("|") ?? [])
        : [];
      if (
        !parsed.success ||
        (parsed.data.cursor !== undefined &&
          (parts.length !== 2 ||
            !z.string().datetime().safeParse(parts[0]).success ||
            !z.string().uuid().safeParse(parts[1]).success))
      )
        return problem(c, 400, "VALIDATION_ERROR", "稿件分页参数无效。");
      const rows = context.uow.execute((tx) =>
        tx.all<Row>(
          `SELECT * FROM delivery_manuscripts
        WHERE project_id = ? AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC LIMIT ?`,
          projectId,
          parts[0] ?? null,
          parts[0] ?? null,
          parts[0] ?? null,
          parts[1] ?? null,
          parsed.data.limit + 1,
        ),
      );
      const page = rows.slice(0, parsed.data.limit);
      const last = page.at(-1);
      return c.json({
        items: page.map((row) => summarize(decode(row))),
        ...(rows.length > page.length && last
          ? { nextCursor: `${last.created_at}|${last.id}` }
          : {}),
      });
    },
    undefined,
    pageQuery,
  );
  add(
    "get",
    "/api/v2/manuscripts/{id}",
    "manuscripts.get",
    idParams,
    ManuscriptPreviewSchema,
    (c) => {
      const row = read(c.req.param("id"));
      return row
        ? respond(c, row)
        : problem(c, 404, "NOT_FOUND", "未找到稿件预览。");
    },
  );
  add(
    "post",
    "/api/v2/manuscripts/{id}/save",
    "manuscripts.save",
    idParams,
    ManuscriptPreviewSchema,
    async (c) => {
      const parsed = ManuscriptSaveInputSchema.safeParse(await c.req.json());
      if (!parsed.success)
        return problem(
          c,
          400,
          "RIGHTS_CONFIRMATION_REQUIRED",
          "请确认所选章节的导出权利和稿件摘要。",
        );
      const row = read(c.req.param("id"));
      if (!row) return problem(c, 404, "NOT_FOUND", "未找到稿件预览。");
      const key = c.req.header("Idempotency-Key")!;
      const saveHash = hash(JSON.stringify(parsed.data));
      // Durable replay works after Runtime restart and does not reopen a dialog.
      if (row.save_key === key)
        return row.save_hash === saveHash
          ? respond(c, row)
          : problem(
              c,
              409,
              "IDEMPOTENCY_CONFLICT",
              "同一保存请求不能修改范围或权利确认。",
            );
      const value = decode(row);
      if (
        row.version !== parsed.data.version ||
        c.req.header("If-Match") !== `"${row.version}"`
      )
        return problem(
          c,
          409,
          "VERSION_CONFLICT",
          "稿件状态已变化，请重新打开预览。",
        );
      if (value.status !== "awaiting-confirmation")
        return problem(
          c,
          409,
          "SAVE_ALREADY_ATTEMPTED",
          "该稿件已尝试保存；取消、失败或未确定的保存需重新预览，不能静默重做。",
        );
      if (value.sourceState !== "current")
        return problem(
          c,
          409,
          "SOURCE_CONFLICT",
          "来源已变化，旧稿件不能作为当前版本交付。",
        );
      if (
        parsed.data.contentSha256 !== value.manifest.contentSha256 ||
        hash(value.document.content) !== value.manifest.contentSha256
      )
        return problem(
          c,
          409,
          "CONTENT_CONFLICT",
          "稿件摘要不匹配，不能保存。",
        );
      if (!host)
        return problem(
          c,
          503,
          "HOST_UNAVAILABLE",
          "当前环境没有本地保存能力，预览仍保留。",
        );
      const saving: ManuscriptPreview = {
        ...value,
        status: "saving",
        rights: parsed.data.rights,
        version: row.version + 1,
        updatedAt: new Date().toISOString(),
      };
      context.uow.execute((tx) => {
        tx.run(
          "UPDATE delivery_manuscripts SET snapshot_json = ?, save_key = ?, save_hash = ?, version = ?, updated_at = ? WHERE id = ?",
          JSON.stringify(saving),
          key,
          saveHash,
          saving.version,
          saving.updatedAt,
          saving.id,
        );
        append(tx, saving);
      });
      let final: ManuscriptPreview;
      try {
        const result = await host.saveTextFile({
          suggestedName: value.manifest.fileName,
          content: value.document.content,
        });
        if (!result.saved) final = { ...saving, status: "canceled" };
        else {
          const receipt = ManuscriptReceiptSchema.safeParse(result);
          if (
            !receipt.success ||
            receipt.data.sha256 !== value.manifest.contentSha256 ||
            receipt.data.byteSize !== value.manifest.byteSize
          )
            throw new Error("Host 没有返回匹配的完整性回执，保存结果未核验。");
          final = { ...saving, status: "saved", receipt: receipt.data };
        }
      } catch {
        final = {
          ...saving,
          status: "failed",
          error:
            "保存失败或回执不匹配；文件可能已写入，但未记录成功交付。请核对后重新预览。",
        };
      }
      final = {
        ...final,
        version: saving.version + 1,
        updatedAt: new Date().toISOString(),
      };
      context.uow.execute((tx) => {
        tx.run(
          "UPDATE delivery_manuscripts SET snapshot_json = ?, version = ?, updated_at = ? WHERE id = ?",
          JSON.stringify(final),
          final.version,
          final.updatedAt,
          final.id,
        );
        append(tx, final);
        if (final.status === "saved")
          tx.append({
            type: "delivery.manuscript-exported.v1",
            pluginId: "delivery",
            aggregateType: "manuscript",
            aggregateId: final.id,
            aggregateVersion: final.version,
            payload: CreativeOutcomeFactSchema.parse({
              eventVersion: 1,
              kind: "novel.manuscript-exported",
              workflowPath: "novel",
              projectId: final.manifest.projectId,
              objectId: final.id,
              formalVersions: final.manifest.chapters.map(
                ({ id, version }) => ({ kind: "chapter", id, version }),
              ),
              sourceVersions: final.manifest.chapters.map(
                ({ id, version }) => ({ id, version }),
              ),
              evidenceKind: "rule",
              modelEvidence: "unknown",
              qualityState: "unverified",
              resultStatus: "saved",
              receipt: final.receipt,
            }),
          });
      });
      // A source edit while the native dialog was open makes this a historical
      // receipt only; never claim it delivered the new current manuscript.
      return respond(c, read(final.id)!);
    },
    ManuscriptSaveInputSchema,
  );
  return routes;
}
