import { createHash } from "node:crypto";
import { optionalService } from "@dramaip/plugin-api/internal";
import {
  CreativeSourceConfirmationFactSchema,
  type CreativeSourceConfirmationFact,
} from "@dramaip/contracts/insights";
import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  MEDIA_RECORD_SERVICE,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import {
  PRODUCTION_RECORD_SERVICE,
  ProductionImportBatchInputSchema,
  type ProductionRecordService,
} from "@dramaip/contracts/production";
import {
  ImportExtractionAdoptInputSchema,
  ImportExtractionCandidatePatchSchema,
  ImportExtractionChangeSetSchema,
  SourceImportCommitInputSchema,
  SourceImportCommitResultSchema,
  SourceImportCommitRecoverySchema,
  SourceImportPreviewInputSchema,
  SourceImportPreviewSchema,
  SourceImportPreviewResponseSchema,
  canonicalImportRequestJSON,
  StructuredScriptDocumentSchema,
  type ImportExtractionCandidate,
  type ImportExtractionChangeSet,
  type SourceImportPreview,
  type WorkspaceProjectService,
  type Project,
  type SourceImportCommitResult,
} from "@dramaip/contracts/workspace";
import {
  WRITING_CHAPTER_SERVICE,
  WritingImportBatchInputSchema,
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
  type RoutePolicy,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";
import {
  SourceImportRecoveryError,
  completeOrdinaryImport,
  prepareOrdinaryImport,
  readOrdinaryImport,
  type OrdinaryImportTarget,
} from "./source-import-recovery.js";

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
    query(name: string): string | undefined;
    header(name: string): string | undefined;
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
  query?: ZodType;
  headers?: ZodType;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["source-imports"],
    request: {
      ...(input.query ? { query: input.query } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
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
  policy?: Partial<RoutePolicy>,
): RouteContribution {
  return defineRouteContribution({
    ...metadata,
    declaration: openapi,
    handler,
    ...(policy ? { policy } : {}),
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
  if (file.format === "script-json")
    return parseStructuredScript(file.name, file.content);
  if (file.format === "fountain" || file.format === "fdx")
    throw new Error("剧本文件必须通过 Production Screenplay Import 导入。");
  return parseTextSource(file.name, file.content, file.format);
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
  workspaceTx: {
    project(tx: UnitOfWorkTransaction, id: string): Project | undefined;
    selectAdaptation(
      tx: UnitOfWorkTransaction,
      id: string,
      target: OrdinaryImportTarget,
      adaptationId: string,
    ): void;
  },
): readonly RouteContribution[] {
  const idParams = z.object({ id: z.string().uuid() });
  const candidateParams = z.object({
    id: z.string().uuid(),
    candidateId: z.string().uuid(),
  });
  const keyFor = (id: string, header: string | undefined) => {
    if (
      header !== undefined &&
      (!header.trim() || header.trim().length < 8 || header.trim().length > 200)
    )
      throw new SourceImportRecoveryError(
        400,
        "VALIDATION_ERROR",
        "导入动作键无效；不会更换原请求。",
      );
    return header?.trim() ?? `legacy-source-import:${id}`;
  };
  const durableCommit = async (
    requestContext: RouteContext,
  ): Promise<Response> => {
    try {
      const id = requestContext.req.param("id");
      const header = requestContext.req.header("Idempotency-Key");
      const key = keyFor(id, header);
      const parsed = SourceImportCommitInputSchema.safeParse(
        await requestContext.req.json(),
      );
      if (!parsed.success)
        throw new SourceImportRecoveryError(
          400,
          "VALIDATION_ERROR",
          "导入确认内容无效。",
        );
      const input = parsed.data;
      const original = context.uow.execute((tx) => {
        const previous = readOrdinaryImport(
          tx,
          id,
          key,
          input.projectId,
          input,
        );
        if (previous) {
          if (previous.recovery.state === "committed" && header === undefined)
            throw new SourceImportRecoveryError(
              404,
              "NOT_FOUND",
              "未找到导入预览。",
            );
          if (!workspaceTx.project(tx, input.projectId))
            throw new SourceImportRecoveryError(
              404,
              "NOT_FOUND",
              "原导入项目不可用。",
            );
          return previous;
        }
        const stored = tx.get<PreviewRow>(
          "SELECT * FROM workspace_source_imports WHERE id = ?",
          id,
        );
        if (!stored)
          throw new SourceImportRecoveryError(
            404,
            "NOT_FOUND",
            "未找到导入预览。",
          );
        let preview: SourceImportPreview;
        try {
          preview = SourceImportPreviewSchema.parse(
            JSON.parse(stored.preview_json),
          );
        } catch {
          throw new SourceImportRecoveryError(
            409,
            "CONFLICT",
            "原导入预览无法安全读取。",
          );
        }
        const project = workspaceTx.project(tx, input.projectId);
        if (
          !project ||
          (stored.project_id !== null &&
            stored.project_id !== input.projectId) ||
          input.preview.contentKind !== preview.contentKind ||
          input.preview.sourceType !== preview.sourceType ||
          !input.rightsConfirmed ||
          stored.expires_at < new Date().toISOString()
        )
          throw new SourceImportRecoveryError(
            400,
            "VALIDATION_ERROR",
            "导入确认内容无效。",
          );
        if (input.strategy !== "append")
          throw new SourceImportRecoveryError(
            409,
            "UNSUPPORTED_OPERATION",
            "当前版本仅允许追加导入。",
          );
        const ownerInput =
          input.preview.contentKind === "script"
            ? ProductionImportBatchInputSchema.safeParse({
                importId: id,
                projectId: input.projectId,
                title: input.preview.title,
                sourceName: input.preview.fileName,
                episodes: input.preview.episodes.map(
                  ({ key: sourceKey, ...episode }) => ({
                    sourceKey,
                    ...episode,
                  }),
                ),
              })
            : WritingImportBatchInputSchema.safeParse({
                importId: id,
                projectId: input.projectId,
                chapters: input.preview.chapters.map((chapter) => ({
                  sourceKey: chapter.key,
                  title: chapter.title,
                  content: chapter.content,
                })),
              });
        if (!ownerInput.success)
          throw new SourceImportRecoveryError(
            400,
            "VALIDATION_ERROR",
            "导入章节／分集的范围或名称无效；未创建内容。",
          );
        const target = {
          projectVersion: project.version,
          currentAdaptationId: project.currentAdaptationId ?? null,
        };
        prepareOrdinaryImport(tx, id, key, input, target);
        return readOrdinaryImport(tx, id, key, input.projectId, input)!;
      });
      if (original.recovery.state === "committed")
        return requestContext.json(original.recovery.result, 201);
      // Peer services run their own atomic batches, never inside Workspace's UOW.
      const frozen = original.recovery.input;
      let write: (tx: UnitOfWorkTransaction) => SourceImportCommitResult;
      let sourceEntries: CreativeSourceConfirmationFact["entries"];
      let receiptFingerprint: string;
      let sceneCount = 0;
      const digest = (value: unknown) =>
        createHash("sha256")
          .update(canonicalImportRequestJSON(value))
          .digest("hex");
      if (frozen.preview.contentKind === "script") {
        const owner = optionalService(context, PRODUCTION_RECORD_SERVICE);
        if (!owner)
          throw new SourceImportRecoveryError(
            409,
            "CONFLICT",
            "制作套件不可用，原请求保留。",
          );
        const batch = owner.importBatch({
          importId: id,
          projectId: frozen.projectId,
          title: frozen.preview.title,
          sourceName: frozen.preview.fileName,
          episodes: frozen.preview.episodes.map(
            ({ key: sourceKey, ...episode }) => ({ sourceKey, ...episode }),
          ),
        });
        if (batch.state !== "committed")
          throw new SourceImportRecoveryError(
            409,
            "CONFLICT",
            "原制作批次无法核对；不重复导入。",
          );
        sourceEntries = batch.receipt.episodes.map((episode, sourceIndex) => ({
          kind: "script-record",
          sourceIndex,
          id: episode.scriptId,
          version: episode.version,
        }));
        receiptFingerprint = digest(batch.receipt);
        sceneCount = batch.receipt.episodes.reduce(
          (sum, episode) => sum + episode.sceneIds.length,
          0,
        );
        write = (tx) => {
          workspaceTx.selectAdaptation(
            tx,
            frozen.projectId,
            original.target,
            batch.receipt.adaptationId,
          );
          appendWorkspaceEvent(tx, "source-import-committed", id, {
            projectId: frozen.projectId,
            contentKind: "script",
          });
          return {
            createdChapters: 0,
            updatedChapters: 0,
            createdEpisodes: batch.receipt.episodes.length,
            createdScripts: batch.receipt.episodes.length,
            updatedScripts: 0,
            createdScenes: batch.receipt.episodes.reduce(
              (sum, episode) => sum + episode.sceneIds.length,
              0,
            ),
            adaptationProjectId: batch.receipt.adaptationId,
            checkpointCount: 0,
          };
        };
      } else {
        const owner = optionalService(context, WRITING_CHAPTER_SERVICE);
        if (!owner)
          throw new SourceImportRecoveryError(
            409,
            "CONFLICT",
            "写作套件不可用，原请求保留。",
          );
        const batch = owner.importBatch({
          importId: id,
          projectId: frozen.projectId,
          chapters: frozen.preview.chapters.map((chapter) => ({
            sourceKey: chapter.key,
            title: chapter.title,
            content: chapter.content,
          })),
        });
        if (batch.state !== "committed")
          throw new SourceImportRecoveryError(
            409,
            "CONFLICT",
            "原章节批次无法核对；不重复导入。",
          );
        sourceEntries = batch.receipt.chapters.map((chapter, sourceIndex) => ({
          kind: "chapter",
          sourceIndex,
          id: chapter.chapterId,
          version: chapter.version,
        }));
        receiptFingerprint = digest(batch.receipt);
        const bindings = new Map(
          batch.receipt.chapters.map((chapter) => [chapter.sourceKey, chapter]),
        );
        const candidates = extractionCandidates(frozen.preview).map((item) => ({
          ...item,
          sourceRefs: item.sourceRefs.map((ref) => {
            const actual = bindings.get(ref.sourceKey);
            if (!actual) throw new Error("原章节绑定无法核对。");
            return {
              ...ref,
              chapterId: actual.chapterId,
              sourceVersion: actual.version,
            };
          }),
        }));
        write = (tx) => {
          const changeSetId = crypto.randomUUID();
          const now = new Date().toISOString();
          const summary = `已从《${frozen.preview.title}》整理 ${candidates.length} 条待审查候选：人物、场景、道具、章节摘要与改编建议均可逐项采用。`;
          tx.run(
            `INSERT INTO workspace_import_extractions(id, project_id, source_fingerprint, source_title, status, summary, candidates_json, adoptions_json, applied_at, undone_at, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, '[]', NULL, NULL, NULL, ?, ?)`,
            changeSetId,
            frozen.projectId,
            fingerprint(JSON.stringify(frozen.preview)),
            frozen.preview.title,
            summary,
            JSON.stringify(candidates),
            now,
            now,
          );
          const changeSet = toChangeSet(
            tx.get<ExtractionRow>(
              "SELECT * FROM workspace_import_extractions WHERE id = ?",
              changeSetId,
            )!,
          );
          appendWorkspaceEvent(tx, "source-import-committed", id, changeSet);
          return {
            createdChapters: batch.receipt.chapters.length,
            updatedChapters: 0,
            createdEpisodes: 0,
            createdScripts: 0,
            updatedScripts: 0,
            createdScenes: 0,
            checkpointCount: 0,
            extractionChangeSet: changeSet,
          };
        };
      }
      const result = context.uow.execute((tx) => {
        if (!workspaceTx.project(tx, frozen.projectId))
          throw new SourceImportRecoveryError(
            404,
            "NOT_FOUND",
            "原导入项目不可用。",
          );
        const current = readOrdinaryImport(
          tx,
          id,
          key,
          frozen.projectId,
          frozen,
        )!;
        if (current.recovery.state === "committed")
          return current.recovery.result!;
        const result = completeOrdinaryImport(tx, id, key, frozen, write(tx));
        const project = workspaceTx.project(tx, frozen.projectId)!;
        tx.append({
          type: "workspace.creation-source-confirmed.v1",
          pluginId: "workspace",
          aggregateType: "project",
          aggregateId: project.id,
          aggregateVersion: project.version,
          payload: CreativeSourceConfirmationFactSchema.parse({
            eventVersion: 1,
            owner: "workspace",
            sourceId: id,
            projectId: project.id,
            projectVersion: project.version,
            projectMode: project.mode,
            workflowPath:
              project.mode === "series_longform"
                ? "novel"
                : project.mode === "single_season"
                  ? "adaptation"
                  : null,
            entry: "ordinary-import",
            sourceFormat: frozen.preview.sourceType,
            contentKind: frozen.preview.contentKind,
            scopePolicy: "confirmed-parsed-entries-not-entire-file",
            entryCount: sourceEntries.length,
            sceneCount,
            entries: sourceEntries,
            bindingFingerprint: digest({ importId: id, input: frozen }),
            receiptFingerprint,
            rightsState: "declared-not-verified",
            evidenceKind: "explicit-source-declaration-and-owner-commit",
            modelEvidence: "unknown",
            qualityState: "unverified",
            currentValidity: "not-assessed",
          }),
        });
        return result;
      });
      return requestContext.json(result, 201);
    } catch (error) {
      return error instanceof SourceImportRecoveryError
        ? problem(requestContext, error.status, error.code, error.message)
        : problem(
            requestContext,
            500,
            "IMPORT_COMMIT_INCOMPLETE",
            "导入提交未完成；原请求保留，请核对后恢复同一次导入，不更换动作键。",
          );
    }
  };
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
            ? optionalService<WritingChapterService>(
                context,
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
        headers: z.object({
          "idempotency-key": z.string().min(8).max(200).optional(),
        }),
        response: SourceImportCommitResultSchema,
        status: 201,
      }),
      durableCommit,
      { idempotency: "optional", idempotencyReplay: "handler" },
    ),
    route(
      {
        id: "workspace:source-import-commit-recovery",
        pluginId: "workspace",
        method: "get",
        path: "/api/v2/source-imports/{id}/commit",
        operationId: "source-imports.getCommit",
      },
      declaration({
        method: "get",
        path: "/api/v2/source-imports/{id}/commit",
        operationId: "source-imports.getCommit",
        params: idParams,
        query: z.object({
          projectId: z.string().uuid(),
          requestKey: z.string().min(8).max(200),
        }),
        response: SourceImportCommitRecoverySchema,
      }),
      (requestContext) => {
        try {
          const id = requestContext.req.param("id");
          const projectId = requestContext.req.query("projectId")!;
          const key = requestContext.req.query("requestKey")!;
          const saved = context.uow.execute((tx) => {
            if (!workspaceTx.project(tx, projectId)) return;
            return readOrdinaryImport(tx, id, key, projectId);
          });
          return saved
            ? requestContext.json(saved.recovery)
            : problem(
                requestContext,
                404,
                "NOT_FOUND",
                "未找到本次导入回执；不会补造原输入。",
              );
        } catch (error) {
          return error instanceof SourceImportRecoveryError
            ? problem(requestContext, error.status, error.code, error.message)
            : problem(
                requestContext,
                500,
                "IMPORT_RECOVERY_UNAVAILABLE",
                "导入回执暂不可读取；不替换原请求。",
              );
        }
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
          if (
            transaction.get(
              "SELECT import_id FROM workspace_source_import_commits WHERE import_id = ?",
              id,
            )
          )
            return "bound";
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
        if (found === "bound")
          return problem(
            requestContext,
            409,
            "IMPORT_ALREADY_BOUND",
            "本次导入已绑定原请求；请先核对或恢复，不删除预览或更换动作键。",
          );
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
        const writingResources = optionalService<WritingResourceService>(
          context,
          WRITING_RESOURCE_SERVICE,
        );
        const writing = optionalService<WritingChapterService>(
          context,
          WRITING_CHAPTER_SERVICE,
        );
        const production = optionalService<ProductionRecordService>(
          context,
          PRODUCTION_RECORD_SERVICE,
        );
        const media = optionalService<MediaRecordService>(
          context,
          MEDIA_RECORD_SERVICE,
        );
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
        const summarySources = new Map<
          string,
          ReturnType<WritingChapterService["get"]>
        >();
        for (const item of selected.filter(
          (candidate) => candidate.type === "chapter-summary",
        )) {
          const ref = item.sourceRefs[0];
          const oldMatches = ref?.chapterId
            ? []
            : writing
                .list(row.project_id)
                .filter((chapter) => chapter.title === ref?.chapterTitle);
          const chapter = ref?.chapterId
            ? writing.get(ref.chapterId)
            : oldMatches.length === 1
              ? oldMatches[0]
              : undefined;
          if (
            !ref ||
            !chapter ||
            chapter.projectId !== row.project_id ||
            chapter.version !== ref.sourceVersion
          )
            return problem(
              requestContext,
              409,
              "SOURCE_CHANGED",
              "原章节身份／版本无法核对；不按同名章节或最新版本采用摘要。",
            );
          summarySources.set(item.id, chapter);
        }
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
            const chapter = summarySources.get(item.id);
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
        const writingResources = optionalService<WritingResourceService>(
          context,
          WRITING_RESOURCE_SERVICE,
        );
        const production = optionalService<ProductionRecordService>(
          context,
          PRODUCTION_RECORD_SERVICE,
        );
        const media = optionalService<MediaRecordService>(
          context,
          MEDIA_RECORD_SERVICE,
        );
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
