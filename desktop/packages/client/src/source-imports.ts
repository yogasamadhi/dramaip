import {
  SourceImportPreviewInputSchema,
  SourceImportPreviewResponseSchema,
  SourceImportCommitInputSchema,
  SourceImportCommitRecoverySchema,
  SourceImportCommitResultSchema,
  type SourceImportCommitInput,
  type SourceImportCommitRecovery,
  type SourceImportCommitResult,
} from "@dramaip/contracts/workspace";
import type { z } from "zod";
import type { StudioClient as BaseClient } from "./generated.js";

export interface SourceImportClient extends Omit<
  BaseClient["sourceImports"],
  "preview" | "commit" | "getCommit"
> {
  preview(
    input: z.infer<typeof SourceImportPreviewInputSchema>,
  ): Promise<z.infer<typeof SourceImportPreviewResponseSchema>>;
  commit(
    id: string,
    input: SourceImportCommitInput,
    key?: string,
  ): Promise<SourceImportCommitResult>;
  getCommit(
    id: string,
    projectId: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<SourceImportCommitRecovery>;
}
export function createSourceImportClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
  base: BaseClient["sourceImports"],
): SourceImportClient {
  const path = (id: string) =>
    `/api/v2/source-imports/${encodeURIComponent(id)}/commit`;
  return {
    ...base,
    preview: async (input) =>
      SourceImportPreviewResponseSchema.parse(
        await request("/api/v2/source-imports/preview", {
          method: "POST",
          body: JSON.stringify(SourceImportPreviewInputSchema.parse(input)),
        }),
      ),
    commit: async (id, input, key) =>
      SourceImportCommitResultSchema.strict().parse(
        await request(path(id), {
          method: "POST",
          ...(key !== undefined ? { headers: { "Idempotency-Key": key } } : {}),
          body: JSON.stringify(SourceImportCommitInputSchema.parse(input)),
        }),
      ),
    getCommit: async (id, projectId, key, signal) => {
      const result = SourceImportCommitRecoverySchema.parse(
        await request(
          `${path(id)}?${new URLSearchParams({ projectId, requestKey: key })}`,
          { signal },
        ),
      );
      if (result.importId !== id || result.projectId !== projectId)
        throw new Error("导入回执不属于原项目／原预览，不替换请求。");
      return result;
    },
  };
}
