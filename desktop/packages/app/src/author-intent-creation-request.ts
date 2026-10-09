import {
  AuthorIntentCreationRequestSchema,
  type AuthorIntentCreationRequest,
  type AuthorIntentSourceCatalog,
} from "@dramaip/contracts/workspace";
import type { NarrativeContextRequest } from "@dramaip/contracts/creation";

/** Explicit confirmation only. Never ignore missing IDs or truncate a scope. */
export function confirmAuthorIntentCreationRequest(
  catalog: AuthorIntentSourceCatalog,
  selectedIds: readonly string[],
  context?: NarrativeContextRequest,
): { request: AuthorIntentCreationRequest } | { error: string } {
  if (new Set(selectedIds).size !== selectedIds.length)
    return { error: "所选来源重复，请重新核对，不会静默去重。" };
  if (
    selectedIds.some(
      (id) => !catalog.items.some((item) => item.source.id === id),
    )
  )
    return { error: "所选来源已缺失，请刷新并重新核对，不会忽略旧选择。" };
  const parsed = AuthorIntentCreationRequestSchema.safeParse({
    ...(context ? { context } : {}),
    projectVersion: catalog.projectVersion,
    baseAdoptedId: catalog.baseAdoptedId,
    sources: catalog.items
      .filter((item) => selectedIds.includes(item.source.id))
      .map((item) => item.source),
  });
  return parsed.success
    ? { request: parsed.data }
    : {
        error: context
          ? "混合表达确认无效；须绑定原允许章节及版本、完整表达和已采用来源，不能补全文或忽略无效选择。Runtime仍须核实际覆盖、隐私与预算。"
          : "来源确认无效；最多明确选择 100 份完整来源，请调整范围，不会裁剪或声称覆盖全书。",
      };
}
