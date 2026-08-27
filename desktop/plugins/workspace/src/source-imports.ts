import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  MEDIA_RECORD_SERVICE,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import {
  PRODUCTION_RECORD_SERVICE,
  type ProductionRecordService,
} from "@dramaip/contracts/production";
import {
  ImportExtractionAdoptInputSchema,
  ImportExtractionCandidatePatchSchema,
  ImportExtractionChangeSetSchema,
  SourceImportCommitInputSchema,
  SourceImportCommitResultSchema,
  SourceImportPreviewInputSchema,
  SourceImportPreviewSchema,
  SourceImportPreviewResponseSchema,
  StructuredScriptDocumentSchema,
  type ImportExtractionCandidate,
  type ImportExtractionChangeSet,
  type SourceImportPreview,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import {
  WRITING_CHAPTER_SERVICE,
  WRITING_RESOURCE_SERVICE,
  type WritingChapterService,
  type WritingResourceService,
} from "@dramaip/contracts/writing";
import type {
  DesktopHostClient,
  HostGrantedDocument,
} from "@dramaip/desktop-host";
import {
  defineRouteContribution,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

interface PreviewRow {
  id: string;
  project_id: string | null;
  file_name: string;
  preview_json: string;
  expires_at: string;
  created_at: string;
}

interface ExtractionRow {
  id: string;
  project_id: string;
  source_fingerprint: string;
  source_title: string;
  status: ImportExtractionChangeSet["status"];
  summary: string;
  candidates_json: string;
  adoptions_json: string;
  applied_at: string | null;
  undone_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface RouteContext {
  req: {
    param(name: string): string;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
}

type Handler = (context: RouteContext) => Response | Promise<Response>;

function problem(
  context: RouteContext,
  status: number,
  code: string,
  title: string,
): Response {
  return context.json(
    {
      type: `https://dramaip.local/problems/${code.toLowerCase()}`,
      title,
      detail: title,
      status,
      code,
      traceId: crypto.randomUUID(),
    },
    status,
  );
}

function declaration(input: {
  method: "delete" | "get" | "patch" | "post";
  path: string;
  operationId: string;
  params?: ZodType;
  body?: ZodType;
  response?: ZodType;
  status?: 200 | 201 | 204;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["source-imports"],
    request: {
      ...(input.params ? { params: input.params } : {}),
      ...(input.body
        ? {
            body: {
              required: true,
              content: { "application/json": { schema: input.body } },
            },
          }
        : {}),
    },
    responses: {
      [status]: input.response
        ? {
            description: "Success",
            content: { "application/json": { schema: input.response } },
          }
        : { description: "Success" },
      400: {
        description: "Invalid request",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
      404: {
        description: "Not found",
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
  } as never);
}

function route(
  metadata: Omit<RouteContribution, "declaration" | "handler" | "policy">,
  openapi: unknown,
  handler: Handler,
): RouteContribution {
  return defineRouteContribution({
    ...metadata,
    declaration: openapi,
    handler,
  });
}

function fingerprint(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right
    .toString(16)
    .padStart(8, "0")}`;
}

export function parseImportedDocument(
  file: HostGrantedDocument,
): SourceImportPreview {
  return file.format === "script-json"
    ? parseStructuredScript(file.name, file.content)
    : parseTextSource(file.name, file.content, file.format);
}

function parseTextSource(
  fileName: string,
  content: string,
  sourceType: "txt" | "markdown" | "docx" | "epub" = "txt",
): SourceImportPreview {
  const normalized = content.replace(/\r\n?/gu, "\n").trim();
  if (!normalized || normalized.includes("\0") || normalized.length > 5_000_000)
    throw new Error("文件内容为空或格式无效。");
  const lines = normalized.split("\n");
  const documentTitle =
    lines
      .find((line) => /^#\s+\S/u.test(line))
      ?.replace(/^#\s+/u, "")
      .trim() ?? fileName.replace(/\.[^.]+$/u, "");
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter((item) => /^##\s+\S/u.test(item.line));
  const sections = headings.length
    ? headings.map((heading, index) => ({
        title: heading.line.replace(/^##\s+/u, "").trim(),
        content: lines
          .slice(heading.index + 1, headings[index + 1]?.index ?? lines.length)
          .join("\n")
          .trim(),
      }))
    : [{ title: documentTitle, content: normalized }];
  const chapters = sections
    .filter((section) => section.content)
    .map((section, index) => ({
      key: `chapter-${index + 1}`,
      title: section.title,
      content: section.content,
      orderIndex: index,
      wordCount: section.content.replace(/\s/gu, "").length,
    }));
  if (!chapters.length) throw new Error("文件中没有可导入的正文。");
  return {
    fileName,
    sourceType,
    contentKind: "novel",
    title: documentTitle,
    charCount: normalized.length,
    chapters,
    episodes: [],
    warnings: [],
  };
}

function parseStructuredScript(
  fileName: string,
  content: string,
): SourceImportPreview {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("剧本 JSON 不是有效的 JSON 文件。");
  }
  const parsed = StructuredScriptDocumentSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "剧本 JSON 结构无效。");
  const title = parsed.data.title?.trim() || fileName.replace(/\.[^.]+$/u, "");
  const episodes = parsed.data.episodes.map((episode) => {
    const scenes = episode.scenes.map((scene, index) => ({
      ...scene,
      title:
        typeof scene.title === "string" && scene.title.trim()
          ? scene.title.trim()
          : `场景 ${index + 1}`,
      content: typeof scene.content === "string" ? scene.content : "",
    }));
    const episodeTitle =
      episode.title?.trim() || `第 ${episode.episodeNumber} 集`;
    const episodeContent =
      episode.content?.trim() ||
      scenes
        .map((scene) =>
          `${String(scene.title)}\n${String(scene.content)}`.trim(),
        )
        .filter(Boolean)
        .join("\n\n");
    return {
      key: `episode-${episode.episodeNumber}`,
      episodeNumber: episode.episodeNumber,
      title: episodeTitle,
      content: episodeContent,
      scenes,
    };
  });
  return {
    fileName,
    sourceType: "script-json",
    contentKind: "script",
    title,
    charCount: episodes.reduce(
      (total, episode) => total + episode.content.length,
      0,
    ),
    chapters: [],
    episodes,
    warnings: [],
  };
}

function candidate(
  type: ImportExtractionCandidate["type"],
  title: string,
  summary: string,
  chapter: SourceImportPreview["chapters"][number],
  confidence: number,
): ImportExtractionCandidate {
  const excerpt = chapter.content.slice(0, 180).replace(/\s+/gu, " ").trim();
  return {
    id: crypto.randomUUID(),
    type,
    title,
    summary,
    confidence,
    sourceRefs: [
      {
        sourceKey: chapter.key,
        chapterTitle: chapter.title,
        start: 0,
        end: excerpt.length,
        excerpt,
        sourceVersion: 0,
      },
    ],
    status: "draft",
  };
}

function extractionCandidates(
  preview: SourceImportPreview,
): ImportExtractionCandidate[] {
  const first = preview.chapters[0]!;
  const joined = preview.chapters.map((item) => item.content).join("\n");
  const person =
    joined.match(/([\p{Script=Han}]{2,3})(?:在|说|握|发现|决定)/u)?.[1] ??
    "主要人物待确认";
  const prop = ["信封", "电话", "照片", "钥匙"].find((item) =>
    joined.includes(item),
  );
  return [
    candidate(
      "character",
      person,
      `${person}出现在原稿中；采用后创建可编辑的人物资料草案。`,
      first,
      0.72,
    ),
    ...preview.chapters.map((chapter) =>
      candidate(
        "scene",
        `${chapter.title}·场景草案`,
        `根据《${chapter.title}》整理的场景候选。`,
        chapter,
        0.66,
      ),
    ),
    candidate(
      "prop",
      prop ?? `${first.title}·关键物件待确认`,
      prop ? `${prop}在原稿中被提及。` : "保留原文范围供人工确认道具。",
      first,
      prop ? 0.7 : 0.2,
    ),
    ...preview.chapters.map((chapter) =>
      candidate(
        "chapter-summary",
        chapter.title,
        chapter.content.slice(0, 180).trim(),
        chapter,
        0.8,
      ),
    ),
    candidate(
      "adaptation",
      `《${preview.title}》短剧改编建议`,
      `基于 ${preview.chapters.length} 个原稿章节建立节奏，再由人工确认集数与悬念。`,
      first,
      0.62,
    ),
  ];
}

function toChangeSet(row: ExtractionRow): ImportExtractionChangeSet {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceFingerprint: row.source_fingerprint,
    sourceTitle: row.source_title,
    status: row.status,
    summary: row.summary,
    candidates: JSON.parse(row.candidates_json) as ImportExtractionCandidate[],
    ...(row.applied_at ? { appliedAt: row.applied_at } : {}),
    ...(row.undone_at ? { undoneAt: row.undone_at } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function appendWorkspaceEvent(
  transaction: UnitOfWorkTransaction,
  type: string,
  aggregateId: string,
  payload: unknown,
): void {
  transaction.append({
    type: `workspace.${type}.v1`,
    pluginId: "workspace",
    aggregateType: "source-import",
    aggregateId,
    aggregateVersion: 0,
    payload: JSON.parse(JSON.stringify(payload)),
  });
}

export const sourceImportMigrations = [
  {
    id: "workspace.0003.source-imports",
    pluginId: "workspace",
    version: "3.0.0-alpha.3",
    dependsOn: ["workspace.0001.projects-and-series"],
    sql: `
      CREATE TABLE IF NOT EXISTS workspace_source_imports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        preview_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_import_extractions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_fingerprint TEXT NOT NULL,
        source_title TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        candidates_json TEXT NOT NULL,
        adoptions_json TEXT NOT NULL DEFAULT '[]',
        applied_at TEXT,
        undone_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workspace_import_extractions_project
        ON workspace_import_extractions(project_id, updated_at DESC, id);
    `,
  },
  {
    id: "workspace.0006.projectless-source-imports",
    pluginId: "workspace",
    version: "3.0.0-alpha.3",
    dependsOn: ["workspace.0005.project-modes"],
    sql: `
      CREATE TABLE workspace_source_imports_next (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        preview_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO workspace_source_imports_next(
        id, project_id, file_name, preview_json, expires_at, created_at
      )
      SELECT id, project_id, file_name, preview_json, expires_at, created_at
      FROM workspace_source_imports;
      DROP TABLE workspace_source_imports;
      ALTER TABLE workspace_source_imports_next RENAME TO workspace_source_imports;
      CREATE INDEX workspace_source_imports_expiry
        ON workspace_source_imports(expires_at);
    `,
  },
] as const;

export function sourceImportRoutes(
  context: PluginContext,
  host: DesktopHostClient | undefined,
  workspace: WorkspaceProjectService,
): readonly RouteContribution[] {
  const idParams = z.object({ id: z.string().uuid() });
  const candidateParams = z.object({
    id: z.string().uuid(),
    candidateId: z.string().uuid(),
  });
  return [
    route(
      {
        id: "workspace:source-import-preview",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/source-imports/preview",
        operationId: "source-imports.preview",
      },
      declaration({
        method: "post",
        path: "/api/v2/source-imports/preview",
        operationId: "source-imports.preview",
        body: SourceImportPreviewInputSchema,
        response: SourceImportPreviewResponseSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = SourceImportPreviewInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success || !host)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "请求参数无效，请检查后重试。",
          );
        try {
          if (parsed.data.projectId && !workspace.get(parsed.data.projectId))
            return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
          const file = await host.readGrantedDocument(
            parsed.data.capabilityToken,
          );
          const preview = parseImportedDocument(file);
          const writing = parsed.data.projectId
            ? context.services.optional<WritingChapterService>(
                WRITING_CHAPTER_SERVICE,
              )
            : undefined;
          if (parsed.data.projectId && !writing)
            return problem(requestContext, 409, "CONFLICT", "写作套件不可用。");
          const duplicates = parsed.data.projectId
            ? writing!
                .list(parsed.data.projectId)
                .filter((item) =>
                  preview.chapters.some(
                    (source) => source.title === item.title,
                  ),
                )
                .map((item) => item.title)
            : [];
          const id = crypto.randomUUID();
          const now = new Date();
          const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
          context.uow.execute((transaction) => {
            transaction.run(
              "INSERT INTO workspace_source_imports VALUES (?, ?, ?, ?, ?, ?)",
              id,
              parsed.data.projectId ?? null,
              file.name,
              JSON.stringify(preview),
              expiresAt,
              now.toISOString(),
            );
            appendWorkspaceEvent(transaction, "source-import-previewed", id, {
              ...(parsed.data.projectId
                ? { projectId: parsed.data.projectId }
                : {}),
              fileName: file.name,
            });
          });
          return requestContext.json(
            {
              importId: id,
              preview,
              duplicates: { chapters: duplicates, episodes: [] },
              expiresAt,
            },
            201,
          );
        } catch {
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "请求参数无效，请检查后重试。",
          );
        }
      },
    ),
    route(
      {
        id: "workspace:source-import-commit",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/source-imports/{id}/commit",
        operationId: "source-imports.commit",
      },
      declaration({
        method: "post",
        path: "/api/v2/source-imports/{id}/commit",
        operationId: "source-imports.commit",
        params: idParams,
        body: SourceImportCommitInputSchema,
        response: SourceImportCommitResultSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = SourceImportCommitInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const id = requestContext.req.param("id");
        const stored = context.uow.execute((transaction) =>
          transaction.get<PreviewRow>(
            "SELECT * FROM workspace_source_imports WHERE id = ?",
            id,
          ),
        );
        if (!stored)
          return problem(requestContext, 404, "NOT_FOUND", "未找到导入预览。");
        const originalPreview = SourceImportPreviewSchema.safeParse(
          JSON.parse(stored.preview_json),
        );
        if (
          !input.success ||
          !originalPreview.success ||
          (stored.project_id !== null &&
            input.data.projectId !== stored.project_id) ||
          input.data.preview.contentKind !== originalPreview.data.contentKind ||
          input.data.preview.sourceType !== originalPreview.data.sourceType ||
          !input.data.rightsConfirmed ||
          (input.data.strategy !== "append" &&
            !input.data.destructiveConfirmed) ||
          stored.expires_at < new Date().toISOString() ||
          !workspace.get(input.data.projectId)
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "导入确认内容无效。",
          );
        if (input.data.strategy !== "append")
          return problem(
            requestContext,
            409,
            "UNSUPPORTED_OPERATION",
            "当前版本仅允许追加导入。",
          );
        if (input.data.preview.contentKind === "script") {
          const production = context.services.optional<ProductionRecordService>(
            PRODUCTION_RECORD_SERVICE,
          );
          if (!production)
            return problem(requestContext, 409, "CONFLICT", "制作套件不可用。");
          const createdRecords: Array<{ id: string; version: number }> = [];
          try {
            const adaptation = production.create("adaptations", {
              projectId: input.data.projectId,
              title: `${input.data.preview.title}·导入改编方案`,
              payload: {
                改编方向: "结构化剧本导入",
                目标集数: input.data.preview.episodes.length,
                来源文件: input.data.preview.fileName,
              },
            });
            createdRecords.push(adaptation);
            let createdScenes = 0;
            for (const episodeSource of input.data.preview.episodes) {
              const episode = production.create("episodes", {
                projectId: input.data.projectId,
                parentId: adaptation.id,
                title: episodeSource.title,
                payload: {
                  集数: episodeSource.episodeNumber,
                  分集简介: episodeSource.content.slice(0, 240),
                  导入来源: input.data.preview.fileName,
                },
              });
              createdRecords.push(episode);
              const script = production.create("scripts", {
                projectId: input.data.projectId,
                parentId: episode.id,
                title: `${episodeSource.title}剧本`,
                payload: {
                  关联分集: episodeSource.title,
                  剧本内容: episodeSource.content,
                  导入来源: input.data.preview.fileName,
                },
              });
              createdRecords.push(script);
              for (const [
                index,
                sceneSource,
              ] of episodeSource.scenes.entries()) {
                const scene = production.create("scenes", {
                  projectId: input.data.projectId,
                  parentId: script.id,
                  title:
                    typeof sceneSource.title === "string" &&
                    sceneSource.title.trim()
                      ? sceneSource.title.trim()
                      : `场景 ${index + 1}`,
                  payload: { ...sceneSource, 场景顺序: index + 1 },
                });
                createdRecords.push(scene);
                createdScenes += 1;
              }
            }
            workspace.setCurrentAdaptation(input.data.projectId, adaptation.id);
            context.uow.execute((transaction) => {
              transaction.run(
                "DELETE FROM workspace_source_imports WHERE id = ?",
                id,
              );
              appendWorkspaceEvent(transaction, "source-import-committed", id, {
                projectId: input.data.projectId,
                contentKind: "script",
              });
            });
            return requestContext.json(
              {
                createdChapters: 0,
                updatedChapters: 0,
                createdEpisodes: input.data.preview.episodes.length,
                createdScripts: input.data.preview.episodes.length,
                updatedScripts: 0,
                createdScenes,
                adaptationProjectId: adaptation.id,
                checkpointCount: 0,
              },
              201,
            );
          } catch {
            for (const record of createdRecords.reverse())
              production.remove(record.id, record.version);
            return problem(
              requestContext,
              409,
              "CONFLICT",
              "剧本导入失败，未保留部分制作资料。",
            );
          }
        }
        const writing = context.services.optional<WritingChapterService>(
          WRITING_CHAPTER_SERVICE,
        );
        if (!writing)
          return problem(requestContext, 409, "CONFLICT", "写作套件不可用。");
        const created: ReturnType<WritingChapterService["create"]>[] = [];
        try {
          for (const chapter of input.data.preview.chapters)
            created.push(
              writing.create({
                projectId: input.data.projectId,
                title: chapter.title,
                content: chapter.content,
              }),
            );
        } catch {
          for (const chapter of created.reverse()) writing.remove(chapter.id);
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "原著导入失败，未保留部分章节。",
          );
        }
        const candidates = extractionCandidates(input.data.preview).map(
          (item) => {
            const source = created.find(
              (chapter) => chapter.title === item.sourceRefs[0]?.chapterTitle,
            );
            return {
              ...item,
              sourceRefs: item.sourceRefs.map((ref) => ({
                ...ref,
                sourceVersion: source?.version ?? 0,
              })),
            };
          },
        );
        const changeSetId = crypto.randomUUID();
        const now = new Date().toISOString();
        const sourceFingerprint = fingerprint(
          JSON.stringify(input.data.preview),
        );
        const summary = `已从《${input.data.preview.title}》整理 ${candidates.length} 条待审查候选：人物、场景、道具、章节摘要与改编建议均可逐项采用。`;
        const changeSet = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO workspace_import_extractions(
              id, project_id, source_fingerprint, source_title, status, summary,
              candidates_json, adoptions_json, applied_at, undone_at,
              error_message, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'draft', ?, ?, '[]', NULL, NULL, NULL, ?, ?)`,
            changeSetId,
            input.data.projectId,
            sourceFingerprint,
            input.data.preview.title,
            summary,
            JSON.stringify(candidates),
            now,
            now,
          );
          transaction.run(
            "DELETE FROM workspace_source_imports WHERE id = ?",
            id,
          );
          const row = transaction.get<ExtractionRow>(
            "SELECT * FROM workspace_import_extractions WHERE id = ?",
            changeSetId,
          )!;
          const value = toChangeSet(row);
          appendWorkspaceEvent(
            transaction,
            "source-import-committed",
            id,
            value,
          );
          return value;
        });
        return requestContext.json(
          {
            createdChapters: created.length,
            updatedChapters: 0,
            createdEpisodes: 0,
            createdScripts: 0,
            updatedScripts: 0,
            createdScenes: 0,
            checkpointCount: 0,
            extractionChangeSet: changeSet,
          },
          201,
        );
      },
    ),
    route(
      {
        id: "workspace:source-import-discard",
        pluginId: "workspace",
        method: "delete",
        path: "/api/v2/source-imports/{id}",
        operationId: "source-imports.discard",
      },
      declaration({
        method: "delete",
        path: "/api/v2/source-imports/{id}",
        operationId: "source-imports.discard",
        params: idParams,
        status: 204,
      }),
      (requestContext) => {
        const id = requestContext.req.param("id");
        const found = context.uow.execute((transaction) => {
          const row = transaction.get<PreviewRow>(
            "SELECT * FROM workspace_source_imports WHERE id = ?",
            id,
          );
          if (!row) return false;
          transaction.run(
            "DELETE FROM workspace_source_imports WHERE id = ?",
            id,
          );
          appendWorkspaceEvent(transaction, "source-import-discarded", id, {
            id,
          });
          return true;
        });
        return found
          ? requestContext.body(null, 204)
          : problem(requestContext, 404, "NOT_FOUND", "未找到导入预览。");
      },
    ),
    route(
      {
        id: "workspace:import-extractions-list",
        pluginId: "workspace",
        method: "get",
        path: "/api/v2/projects/{id}/import-extractions/change-sets",
        operationId: "import-extractions.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/projects/{id}/import-extractions/change-sets",
        operationId: "import-extractions.list",
        params: idParams,
        response: z.array(ImportExtractionChangeSetSchema),
      }),
      (requestContext) =>
        requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<ExtractionRow>(
                "SELECT * FROM workspace_import_extractions WHERE project_id = ? ORDER BY updated_at DESC",
                requestContext.req.param("id"),
              )
              .map(toChangeSet),
          ),
        ),
    ),
    route(
      {
        id: "workspace:import-extraction-update-candidate",
        pluginId: "workspace",
        method: "patch",
        path: "/api/v2/import-extractions/change-sets/{id}/candidates/{candidateId}",
        operationId: "import-extractions.updateCandidate",
      },
      declaration({
        method: "patch",
        path: "/api/v2/import-extractions/change-sets/{id}/candidates/{candidateId}",
        operationId: "import-extractions.updateCandidate",
        params: candidateParams,
        body: ImportExtractionCandidatePatchSchema,
        response: ImportExtractionChangeSetSchema,
      }),
      async (requestContext) => {
        const patch = ImportExtractionCandidatePatchSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!patch.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "候选修改无效。",
          );
        const id = requestContext.req.param("id");
        const candidateId = requestContext.req.param("candidateId");
        const value = context.uow.execute((transaction) => {
          const row = transaction.get<ExtractionRow>(
            "SELECT * FROM workspace_import_extractions WHERE id = ?",
            id,
          );
          if (!row) return undefined;
          const candidates = JSON.parse(
            row.candidates_json,
          ) as ImportExtractionCandidate[];
          const index = candidates.findIndex((item) => item.id === candidateId);
          if (index < 0 || candidates[index]!.status === "adopted")
            return undefined;
          candidates[index] = { ...candidates[index]!, ...patch.data };
          transaction.run(
            "UPDATE workspace_import_extractions SET candidates_json = ?, updated_at = ? WHERE id = ?",
            JSON.stringify(candidates),
            new Date().toISOString(),
            id,
          );
          return toChangeSet(
            transaction.get<ExtractionRow>(
              "SELECT * FROM workspace_import_extractions WHERE id = ?",
              id,
            )!,
          );
        });
        return value
          ? requestContext.json(value)
          : problem(requestContext, 404, "NOT_FOUND", "未找到可编辑候选。");
      },
    ),
    route(
      {
        id: "workspace:import-extraction-adopt",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/import-extractions/change-sets/{id}/adopt",
        operationId: "import-extractions.adopt",
      },
      declaration({
        method: "post",
        path: "/api/v2/import-extractions/change-sets/{id}/adopt",
        operationId: "import-extractions.adopt",
        params: idParams,
        body: ImportExtractionAdoptInputSchema,
        response: ImportExtractionChangeSetSchema,
      }),
      async (requestContext) => {
        const input = ImportExtractionAdoptInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const id = requestContext.req.param("id");
        const row = context.uow.execute((transaction) =>
          transaction.get<ExtractionRow>(
            "SELECT * FROM workspace_import_extractions WHERE id = ?",
            id,
          ),
        );
        if (!input.success || !row)
          return problem(requestContext, 404, "NOT_FOUND", "未找到导入候选。");
        const writingResources =
          context.services.optional<WritingResourceService>(
            WRITING_RESOURCE_SERVICE,
          );
        const writing = context.services.optional<WritingChapterService>(
          WRITING_CHAPTER_SERVICE,
        );
        const production = context.services.optional<ProductionRecordService>(
          PRODUCTION_RECORD_SERVICE,
        );
        const media =
          context.services.optional<MediaRecordService>(MEDIA_RECORD_SERVICE);
        if (!writingResources || !writing || !production || !media)
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "候选采用服务不可用。",
          );
        const candidates = JSON.parse(
          row.candidates_json,
        ) as ImportExtractionCandidate[];
        const selected = candidates.filter(
          (candidate) =>
            candidate.status === "draft" &&
            (!input.data.candidateIds ||
              input.data.candidateIds.includes(candidate.id)),
        );
        if (!selected.length)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "请至少选择一个候选。",
          );
        const adoptions: Array<Record<string, unknown>> = [];
        for (const item of selected) {
          if (item.type === "character") {
            const created = writingResources.create({
              kind: "characters",
              projectId: row.project_id,
              title: item.title,
              payload: { 候选摘要: item.summary, 来源变更集: id },
            });
            adoptions.push({
              candidateId: item.id,
              owner: "writing",
              id: created.id,
              version: created.version,
            });
          } else if (item.type === "adaptation" || item.type === "scene") {
            const created = production.create(
              item.type === "adaptation" ? "adaptations" : "scenes",
              {
                projectId: row.project_id,
                title: item.title,
                payload: { 候选摘要: item.summary, 来源变更集: id },
              },
            );
            adoptions.push({
              candidateId: item.id,
              owner: "production",
              id: created.id,
              version: created.version,
            });
          } else if (item.type === "chapter-summary") {
            const chapter = writing
              .list(row.project_id)
              .find(
                (value) => value.title === item.sourceRefs[0]?.chapterTitle,
              );
            if (chapter) {
              const updated = writing.updateSummary(
                chapter.id,
                chapter.version,
                item.summary,
              );
              if (updated.state === "updated")
                adoptions.push({
                  candidateId: item.id,
                  owner: "writing-summary",
                  id: chapter.id,
                  previous: chapter.summary,
                  version: updated.value.version,
                });
            }
          } else {
            const created = media.create("visual-assets", {
              projectId: row.project_id,
              title: item.title,
              payload: {
                资产类型: "道具",
                关联对象: item.title,
                采用状态: "候选",
                锁定状态: "未锁定",
                权利状态: "待核验",
                费用状态: "未知",
                服务状态: "无需服务",
                候选摘要: item.summary,
                来源变更集: id,
              },
            });
            adoptions.push({
              candidateId: item.id,
              owner: "media",
              id: created.id,
              version: created.version,
            });
          }
          item.status = "adopted";
        }
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `UPDATE workspace_import_extractions SET status = 'applied',
             candidates_json = ?, adoptions_json = ?, applied_at = ?,
             undone_at = NULL, updated_at = ? WHERE id = ?`,
            JSON.stringify(candidates),
            JSON.stringify(adoptions),
            now,
            now,
            id,
          );
          const updated = toChangeSet(
            transaction.get<ExtractionRow>(
              "SELECT * FROM workspace_import_extractions WHERE id = ?",
              id,
            )!,
          );
          appendWorkspaceEvent(
            transaction,
            "import-extraction-adopted",
            id,
            updated,
          );
          return updated;
        });
        return requestContext.json(value);
      },
    ),
    route(
      {
        id: "workspace:import-extraction-undo",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/import-extractions/change-sets/{id}/undo",
        operationId: "import-extractions.undo",
      },
      declaration({
        method: "post",
        path: "/api/v2/import-extractions/change-sets/{id}/undo",
        operationId: "import-extractions.undo",
        params: idParams,
        response: ImportExtractionChangeSetSchema,
      }),
      (requestContext) => {
        const id = requestContext.req.param("id");
        const row = context.uow.execute((transaction) =>
          transaction.get<ExtractionRow>(
            "SELECT * FROM workspace_import_extractions WHERE id = ?",
            id,
          ),
        );
        if (!row || row.status !== "applied")
          return problem(requestContext, 409, "CONFLICT", "当前候选不可撤销。");
        const writingResources =
          context.services.optional<WritingResourceService>(
            WRITING_RESOURCE_SERVICE,
          );
        const production = context.services.optional<ProductionRecordService>(
          PRODUCTION_RECORD_SERVICE,
        );
        const media =
          context.services.optional<MediaRecordService>(MEDIA_RECORD_SERVICE);
        for (const adoption of JSON.parse(row.adoptions_json) as Array<
          Record<string, unknown>
        >) {
          if (adoption.owner === "writing" && typeof adoption.id === "string")
            writingResources?.remove(adoption.id, Number(adoption.version));
          if (
            adoption.owner === "production" &&
            typeof adoption.id === "string"
          )
            production?.remove(adoption.id, Number(adoption.version));
          if (adoption.owner === "media" && typeof adoption.id === "string")
            media?.remove(adoption.id, Number(adoption.version));
        }
        const candidates = (
          JSON.parse(row.candidates_json) as ImportExtractionCandidate[]
        ).map((item) =>
          item.status === "adopted"
            ? { ...item, status: "draft" as const }
            : item,
        );
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `UPDATE workspace_import_extractions SET status = 'draft',
             candidates_json = ?, adoptions_json = '[]', undone_at = ?, updated_at = ?
             WHERE id = ?`,
            JSON.stringify(candidates),
            now,
            now,
            id,
          );
          const updated = toChangeSet(
            transaction.get<ExtractionRow>(
              "SELECT * FROM workspace_import_extractions WHERE id = ?",
              id,
            )!,
          );
          appendWorkspaceEvent(
            transaction,
            "import-extraction-undone",
            id,
            updated,
          );
          return updated;
        });
        return requestContext.json(value);
      },
    ),
  ];
}
