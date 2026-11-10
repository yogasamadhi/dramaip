import {
  ChapterPreviewRevisionEffortSchema,
  ChangePreviewSchema,
  type ChapterPreviewRevisionEffort,
  type ChangePreview,
} from "@dramaip/contracts/automation";

type OriginalPreview = Pick<
  ChangePreview,
  "id" | "projectId" | "taskId" | "status" | "contentHash"
> & {
  readonly targets: readonly {
    readonly kind: string;
    readonly id: string;
    readonly patch: unknown;
  }[];
};

export interface PreviewRevisionEffortClient {
  read(
    preview: OriginalPreview,
    signal?: AbortSignal,
  ): Promise<ChapterPreviewRevisionEffort>;
}
export function createPreviewRevisionEffortClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): PreviewRevisionEffortClient {
  return {
    read: async (preview, signal) => {
      const chapter =
        preview.targets.length === 1 ? preview.targets[0] : undefined;
      if (chapter?.kind !== "chapter")
        throw new Error("修订台账仅支持指定的单章候选。");
      const patch = ChangePreviewSchema.shape.targets.element.shape.patch.parse(
        chapter.patch,
      );
      const result = ChapterPreviewRevisionEffortSchema.parse(
        await request(
          `/api/v2/change-previews/${encodeURIComponent(preview.id)}/revision-effort?${new URLSearchParams(
            {
              projectId: preview.projectId,
              contentHash: preview.contentHash,
            },
          )}`,
          { signal },
        ),
      );
      if (
        result.previewId !== preview.id ||
        result.projectId !== preview.projectId ||
        result.chapterId !== chapter.id ||
        result.taskId !== preview.taskId ||
        result.contentHash !== preview.contentHash ||
        result.status !== preview.status
      )
        throw new Error(
          "修订台账与原候选、章节、项目、任务或状态不一致，请重新读取原预览。",
        );
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(String(patch.content)),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (
        typeof patch.content !== "string" ||
        result.candidateSha256 !== digest
      )
        throw new Error("原候选正文指纹无法核对，不展示其他内容的修订次数。");
      return result;
    },
  };
}
