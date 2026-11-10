import {
  CreationInputSchema,
  CreationWorkflowSchema,
} from "@dramaip/contracts/creation";
import type { StudioClient } from "./generated.js";

/** Validate frozen confirmed inputs at the hand-maintained SDK boundary. */
export function createCreationWorkflowClient(
  base: StudioClient["creation"],
): StudioClient["creation"] {
  const item = (raw: unknown, id?: string) => {
    const value = CreationWorkflowSchema.parse(raw);
    if (id && value.id !== id)
      throw new Error("创作响应不是明确请求的原工作流，不切最新或其他工作流。");
    return value;
  };
  return {
    ...base,
    get: async (id) => item(await base.get(id), id),
    start: async (raw, key) => {
      const input = CreationInputSchema.parse(raw);
      const value = item(await base.start(input, key));
      const confirmed = [
        "narrativeContextRequest",
        "narrativePlanningRequest",
        "productionNarrativeRequest",
        "qualityReviewRequest",
      ] as const;
      if (
        value.input.projectId !== input.projectId ||
        value.input.operation !== input.operation ||
        confirmed.some(
          (field) =>
            JSON.stringify(value.input[field]) !== JSON.stringify(input[field]),
        )
      )
        throw new Error(
          "创作冻结响应与原明确项目／操作／来源选择不一致，不采用替换的输入。",
        );
      return value;
    },
    action: async (id, action, key) =>
      item(await base.action(id, action, key), id),
    rebase: async (id, input, key) => item(await base.rebase(id, input, key)),
    list: async (projectId, targetId, cursor) => {
      const page = await base.list(projectId, targetId, cursor);
      const items = page.items.map((value) => item(value));
      if (
        items.some(
          (value) =>
            value.input.projectId !== projectId ||
            (targetId && value.input.targetId !== targetId),
        )
      )
        throw new Error("创作列表包含非本轮项目／目标工作流。");
      return { ...page, items };
    },
  };
}
