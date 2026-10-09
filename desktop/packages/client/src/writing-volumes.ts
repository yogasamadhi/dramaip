import {
  canonicalImportRequestJSON,
  WritingVolumeInputSchema,
  WritingVolumeSchema,
  WritingVolumePageSchema,
  WritingVolumeAssignmentInputSchema,
  WritingVolumeAssignmentReceiptSchema,
  type WritingVolumeAssignmentInput,
} from "@dramaip/contracts/writing";
import type { z } from "zod";

export function createWritingVolumesClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  const path = (projectId: string) =>
    `/api/v2/projects/${encodeURIComponent(projectId)}`;
  const write = (input: unknown, key: string): RequestInit => {
    if (key.length < 8 || key.length > 200 || key !== key.trim())
      throw new Error("须保留有效的原卷操作请求键。");
    return {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(input),
    };
  };
  return {
    async list(
      projectId: string,
      options: { cursor?: string; limit?: number } = {},
    ) {
      const query = new URLSearchParams();
      if (options.cursor !== undefined) query.set("cursor", options.cursor);
      if (options.limit !== undefined)
        query.set("limit", String(options.limit));
      const page = WritingVolumePageSchema.parse(
        await request(
          `${path(projectId)}/volumes${query.size ? `?${query}` : ""}`,
        ),
      );
      if (
        page.items.some((item) => item.projectId !== projectId) ||
        new Set(page.items.map((item) => item.id)).size !== page.items.length ||
        page.items.some(
          (item, index) =>
            item.orderIndex <= Number(options.cursor ?? -1) ||
            (index > 0 && item.orderIndex <= page.items[index - 1]!.orderIndex),
        ) ||
        (page.nextCursor !== undefined &&
          page.nextCursor !== String(page.items.at(-1)?.orderIndex))
      )
        throw new Error("实际卷的项目、顺序或分页回执无法核对，未替换目录。");
      return page;
    },
    async create(
      projectId: string,
      input: Omit<z.infer<typeof WritingVolumeInputSchema>, "projectId">,
      key: string,
    ) {
      const parsed = WritingVolumeInputSchema.omit({ projectId: true })
        .strict()
        .parse(input);
      const value = WritingVolumeSchema.parse(
        await request(`${path(projectId)}/volumes`, write(parsed, key)),
      );
      if (
        value.projectId !== projectId ||
        value.version !== 0 ||
        value.title !== parsed.title ||
        value.outline !== (parsed.outline ?? "")
      )
        throw new Error("原卷创建回执不匹配明确输入，未当作新卷成功。");
      return value;
    },
    async assign(
      projectId: string,
      input: WritingVolumeAssignmentInput,
      key: string,
    ) {
      const parsed = WritingVolumeAssignmentInputSchema.parse(input);
      const value = WritingVolumeAssignmentReceiptSchema.parse(
        await request(
          `${path(projectId)}/volume-memberships`,
          write(parsed, key),
        ),
      );
      if (
        value.projectId !== projectId ||
        canonicalImportRequestJSON(value.input) !==
          canonicalImportRequestJSON(parsed)
      )
        throw new Error("归属回执不是原章节／卷版本及明确选择，不自动换源。");
      return value;
    },
  };
}
export type WritingVolumesClient = ReturnType<
  typeof createWritingVolumesClient
>;
