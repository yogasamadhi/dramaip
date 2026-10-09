import { z } from "zod";
import { WritingImportBatchInputSchema } from "@dramaip/contracts/writing";
import { ProductionImportBatchInputSchema } from "@dramaip/contracts/production";
import {
  canonicalImportRequestJSON,
  SourceImportCommitInputSchema,
  SourceImportPreviewSchema,
  type SourceImportCommitInput,
  type SourceImportCommitRecovery,
} from "@dramaip/contracts/workspace";

export const SourceImportAttemptSchema = z
  .object({
    schemaVersion: z.literal(1),
    importId: z.string().uuid(),
    requestKey: z.string().uuid(),
    input: SourceImportCommitInputSchema,
  })
  .strict()
  .refine(
    (value) => value.input.strategy === "append" && value.input.rightsConfirmed,
  );
export type SourceImportAttempt = z.infer<typeof SourceImportAttemptSchema>;
export const SourceImportDraftSchema = z
  .object({
    importId: z.string().uuid(),
    preview: SourceImportPreviewSchema,
    expiresAt: z.string().datetime(),
    rightsConfirmed: z.boolean(),
  })
  .strict();
export type SourceImportDraft = z.infer<typeof SourceImportDraftSchema>;
export function restoredSourceImportDraft(
  attempt: unknown,
  rawDraft: unknown,
): SourceImportDraft | undefined {
  const draft = SourceImportDraftSchema.safeParse(rawDraft);
  if (attempt !== undefined) {
    const frozen = SourceImportAttemptSchema.safeParse(attempt);
    if (!frozen.success) return;
    return {
      importId: frozen.data.importId,
      preview: frozen.data.input.preview,
      expiresAt: draft.success
        ? draft.data.expiresAt
        : "1970-01-01T00:00:00.000Z",
      rightsConfirmed: true,
    };
  }
  return draft.success ? { ...draft.data, rightsConfirmed: false } : undefined;
}

export function freezeSourceImportAttempt(
  importId: string,
  input: SourceImportCommitInput,
  original?: SourceImportAttempt,
): SourceImportAttempt {
  if (original) {
    const parsed = SourceImportAttemptSchema.safeParse(original);
    if (
      !parsed.success ||
      parsed.data.importId !== importId ||
      parsed.data.input.projectId !== input.projectId
    )
      throw new Error(
        "原导入输入损坏或归属不符；保留原键，不换键或补造原预览。",
      );
    return structuredClone(parsed.data);
  }
  // Reject invalid editable rows before allocating/fixing a new action key.
  const ownerInput =
    input.preview.contentKind === "script"
      ? ProductionImportBatchInputSchema.safeParse({
          importId,
          projectId: input.projectId,
          title: input.preview.title,
          sourceName: input.preview.fileName,
          episodes: input.preview.episodes.map(
            ({ key: sourceKey, ...episode }) => ({ sourceKey, ...episode }),
          ),
        })
      : WritingImportBatchInputSchema.safeParse({
          importId,
          projectId: input.projectId,
          chapters: input.preview.chapters.map((chapter) => ({
            sourceKey: chapter.key,
            title: chapter.title,
            content: chapter.content,
          })),
        });
  if (!ownerInput.success)
    throw new Error(
      "导入章节／分集的范围或名称无效；请先修正预览，不冻结动作键或写入内容。",
    );
  return structuredClone(
    SourceImportAttemptSchema.parse({
      schemaVersion: 1,
      importId,
      requestKey: crypto.randomUUID(),
      input,
    }),
  );
}

export function checkSourceImportRecovery(
  attempt: SourceImportAttempt,
  recovery: SourceImportCommitRecovery,
): void {
  if (
    recovery.importId !== attempt.importId ||
    recovery.projectId !== attempt.input.projectId ||
    canonicalImportRequestJSON(recovery.input) !==
      canonicalImportRequestJSON(attempt.input)
  )
    throw new Error("服务端原导入与本机冻结请求不符；保留原键，不重拼或覆盖。");
}

const storageKey = (projectId: string) =>
  `dramaip-source-import-attempt:${projectId}`;
/** Retain malformed identity on read; the explicit write boundary refuses it. */
export function readSourceImportAttempt(
  projectId: string,
): SourceImportAttempt | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (raw === null) return;
    return JSON.parse(raw) as SourceImportAttempt;
  } catch {
    return {
      schemaVersion: 1,
      importId: "",
      requestKey: "",
      input: {},
    } as SourceImportAttempt;
  }
}
export function persistSourceImportAttempt(attempt: SourceImportAttempt): void {
  const parsed = SourceImportAttemptSchema.parse(attempt);
  window.localStorage.setItem(
    storageKey(parsed.input.projectId),
    JSON.stringify(parsed),
  );
}
export function clearSourceImportAttempt(projectId: string): void {
  window.localStorage.removeItem(storageKey(projectId));
}
