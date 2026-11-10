import { z } from "zod";
import {
  WritingVolumeInputSchema,
  WritingVolumeAssignmentInputSchema,
} from "@dramaip/contracts/writing";
const common = {
  projectId: z.string().uuid(),
  key: z.string().uuid(),
  confirmedAt: z.string().datetime(),
};
export const WritingVolumeRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...common,
      kind: z.literal("create"),
      input: WritingVolumeInputSchema.omit({ projectId: true }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("assign"),
      input: WritingVolumeAssignmentInputSchema,
    })
    .strict(),
]);
export type WritingVolumeRequest = z.infer<typeof WritingVolumeRequestSchema>;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const storageKey = (projectId: string) =>
  `dramaip-volume-request:v1:${projectId}`;
export function readVolumeRequest(
  projectId: string,
  store: () => Store,
): { raw: string | null; request?: WritingVolumeRequest; error?: string } {
  let raw: string | null = null;
  try {
    raw = store().getItem(storageKey(projectId));
    if (raw === null) return { raw };
    const request = WritingVolumeRequestSchema.parse(JSON.parse(raw));
    if (request.projectId !== projectId) throw new Error("Foreign request");
    return { raw, request };
  } catch {
    return {
      raw,
      error:
        "本地原卷请求无法安全恢复，原记录未删除或覆盖；请先核对，不另建请求。",
    };
  }
}
export function writeVolumeRequest(
  projectId: string,
  request: WritingVolumeRequest | null,
  expectedRaw: string | null,
  store: () => Store,
): string | null {
  const storage = store();
  if (storage.getItem(storageKey(projectId)) !== expectedRaw)
    throw new Error("原卷请求已在其他窗口变化，未覆盖或发起新请求。");
  if (request === null) {
    storage.removeItem(storageKey(projectId));
    return null;
  }
  const parsed = WritingVolumeRequestSchema.parse(request);
  if (parsed.projectId !== projectId)
    throw new Error("原卷请求不属于当前项目。");
  const raw = JSON.stringify(parsed);
  storage.setItem(storageKey(projectId), raw);
  return raw;
}
