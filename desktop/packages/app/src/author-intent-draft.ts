import { z } from "zod";
import type { AuthorIntentContent } from "@dramaip/contracts/workspace";

export const AUTHOR_INTENT_DRAFT_FIELDS = [
  "themeStatement",
  "emotionalPromise",
  "targetAudience",
  "mustKeep",
  "mayChange",
  "mustAvoid",
  "endingContract",
  "toneAndVoice",
] as const satisfies readonly (keyof AuthorIntentContent)[];
export type AuthorIntentEditFields = Record<keyof AuthorIntentContent, string>;
const fieldsSchema = z
  .object({
    themeStatement: z.string().max(40_000),
    emotionalPromise: z.string().max(40_000),
    targetAudience: z.string().max(40_000),
    mustKeep: z.string().max(40_000),
    mayChange: z.string().max(40_000),
    mustAvoid: z.string().max(40_000),
    endingContract: z.string().max(40_000),
    toneAndVoice: z.string().max(40_000),
  })
  .strict();
const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().uuid(),
    basisVersion: z.number().int().nonnegative(),
    baseAdoptedId: z.string().uuid().optional(),
    sourceKind: z.enum(["manual", "legacy-project"]),
    fields: fieldsSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();
export type AuthorIntentEdit = Pick<
  z.infer<typeof recordSchema>,
  "fields" | "basisVersion" | "baseAdoptedId" | "sourceKind"
>;
export type AuthorIntentDraftStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
export type AuthorIntentDraftStore = () => AuthorIntentDraftStorage;
const key = (projectId: string) => `dramaip-author-intent-edit:v1:${projectId}`;
const unavailable =
  "本地编辑草稿未能保存；当前输入仍保留，但不能保证重启恢复。";
const conflict =
  "本地草稿已在其他窗口变化，未覆盖它；当前输入仍保留，请重新核对后再操作。";

export function emptyAuthorIntentEdit(basisVersion: number): AuthorIntentEdit {
  return {
    basisVersion,
    sourceKind: "manual",
    fields: Object.fromEntries(
      AUTHOR_INTENT_DRAFT_FIELDS.map((name) => [name, ""]),
    ) as AuthorIntentEditFields,
  };
}
export function readAuthorIntentDraft(
  projectId: string,
  store: AuthorIntentDraftStore,
): {
  raw: string | null;
  record?: z.infer<typeof recordSchema>;
  error?: string;
} {
  let raw: string | null = null;
  try {
    raw = store().getItem(key(projectId));
    if (raw === null) return { raw };
    const record = recordSchema.parse(JSON.parse(raw));
    if (record.projectId !== projectId) throw new Error("wrong project");
    return { raw, record };
  } catch {
    // Preserve invalid/unsupported data. Never log or show its private text.
    return {
      raw,
      error:
        "本地草稿无法安全恢复，原记录未删除或覆盖。可明确清空该项目的编辑草稿；正式版本和候选不受影响。",
    };
  }
}
export function saveAuthorIntentDraft(
  projectId: string,
  edit: AuthorIntentEdit,
  expectedRaw: string | null,
  store: AuthorIntentDraftStore,
): { raw?: string; error?: string } {
  try {
    const storage = store();
    if (storage.getItem(key(projectId)) !== expectedRaw)
      return { error: conflict };
    const record = recordSchema.parse({
      ...edit,
      schemaVersion: 1,
      projectId,
      updatedAt: new Date().toISOString(),
    });
    const raw = JSON.stringify(record);
    storage.setItem(key(projectId), raw);
    return { raw };
  } catch {
    return { error: unavailable };
  }
}
export function clearAuthorIntentDraft(
  projectId: string,
  expectedRaw: string | null,
  store: AuthorIntentDraftStore,
): { cleared: boolean; error?: string } {
  try {
    const storage = store();
    if (storage.getItem(key(projectId)) !== expectedRaw)
      return { cleared: false, error: conflict };
    storage.removeItem(key(projectId));
    return { cleared: true };
  } catch {
    return { cleared: false, error: unavailable };
  }
}
