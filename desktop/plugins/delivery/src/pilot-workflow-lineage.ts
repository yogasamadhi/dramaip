import { z } from "zod";
import {
  CreationProjectLineagePageSchema,
  type CreationProjectLineagePage,
  type CreationProjectLineageReceipt,
} from "@dramaip/contracts/creation-project-lineage";
import type { EpisodeDevelopmentResult } from "@dramaip/contracts/production";

type Result = Pick<
  EpisodeDevelopmentResult,
  | "id"
  | "version"
  | "projectId"
  | "operation"
  | "origin"
  | "workflowId"
  | "sourceSnapshotId"
  | "runIds"
>;
import { CreationProjectLineageReceiptSchema } from "@dramaip/contracts/creation-project-lineage";
const identitySchema = z
  .object({ id: z.string().uuid(), version: z.number().int().nonnegative() })
  .strict();
const stageFields = {
  result: identitySchema,
  operation: z.enum([
    "episode-outline",
    "episode-script",
    "storyboard-package",
  ]),
  origin: z.enum([
    "model",
    "historical-origin-unspecified",
    "human-script-revision",
    "human-topology-revision",
    "human-source-revision",
  ]),
};
export const PilotWorkflowLineageSchema = z
  .object({
    format: z.literal("pilot-selected-workflow-lineage-v1"),
    sourceProject: identitySchema,
    coverage: z.literal(
      "selected-adopted-production-workflows-only-not-project-history",
    ),
    textIncluded: z.literal(false),
    semanticVerification: z.literal("unverified"),
    stages: z
      .array(
        z.discriminatedUnion("state", [
          z
            .object({
              ...stageFields,
              state: z.literal("available"),
              receipt: CreationProjectLineageReceiptSchema,
            })
            .strict(),
          z
            .object({
              ...stageFields,
              state: z.literal("unavailable"),
              reason: z.literal("original-workflow-receipt-not-available"),
            })
            .strict(),
          z
            .object({
              ...stageFields,
              state: z.literal("human-confirmation-not-new-model-input"),
            })
            .strict(),
        ]),
      )
      .length(3),
  })
  .strict()
  .superRefine((value, check) => {
    if (
      new Set(value.stages.map((stage) => stage.operation)).size !== 3 ||
      new Set(value.stages.map((stage) => stage.result.id)).size !== 3
    )
      check.addIssue({
        code: "custom",
        message: "所选试制阶段与成果不能重复。",
      });
    for (const stage of value.stages) {
      const human =
        stage.origin !== "model" &&
        stage.origin !== "historical-origin-unspecified";
      if (
        human !== (stage.state === "human-confirmation-not-new-model-input") ||
        (stage.state === "available" &&
          (stage.receipt.projectId !== value.sourceProject.id ||
            stage.receipt.operation !== stage.operation ||
            stage.receipt.stage !== "applied" ||
            stage.receipt.outputs.episodeResultId !== stage.result.id))
      )
        check.addIssue({
          code: "custom",
          message: "原工作流回执／人工确认与所选阶段不符。",
        });
    }
  });
const ref = ({ id, version }: { id: string; version: number }) => ({
  id,
  version,
});
const sameIds = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Only explicitly selected adopted stages. Read original receipts, never latest
 * heads, prompts, author text or peer tables. Human confirmations are not new
 * model inputs and do not automatically acquire their inherited run's receipt. */
export function pilotWorkflowLineage(
  project: { id: string; version: number },
  results: readonly Result[],
  service?: {
    list(
      projectId: string,
      options: { cursor?: string; limit: number },
    ): CreationProjectLineagePage;
  },
) {
  z.string().uuid().parse(project.id);
  z.number().int().nonnegative().parse(project.version);
  const expected = ["episode-outline", "episode-script", "storyboard-package"];
  if (
    results.length !== 3 ||
    expected.some(
      (operation) =>
        results.filter((result) => result.operation === operation).length !== 1,
    )
  )
    throw new Error("试制谱系必须绑定三个实际采用阶段。");
  const ids = new Set<string>();
  for (const result of results) {
    z.string().uuid().parse(result.id);
    z.number().int().positive().parse(result.version);
    if (result.projectId !== project.id || ids.has(result.id))
      throw new Error("试制谱系原成果身份不符。");
    ids.add(result.id);
  }
  const selected = results.filter(
    (result) =>
      (!result.origin || result.origin === "model") && result.workflowId,
  );
  const receipts = new Map<string, CreationProjectLineageReceipt>();
  if (service && selected.length) {
    const seen = new Set<string>(),
      cursors = new Set<string>();
    let cursor: string | undefined,
      complete = false;
    for (let index = 0; index < 10000; index++) {
      const page = CreationProjectLineagePageSchema.parse(
        service.list(project.id, { cursor, limit: 25 }),
      );
      for (const receipt of page.items) {
        if (receipt.projectId !== project.id || seen.has(receipt.id))
          throw new Error("试制谱系分页身份不符。");
        seen.add(receipt.id);
        if (selected.some((result) => result.workflowId === receipt.id))
          receipts.set(receipt.id, receipt);
      }
      if (!page.nextCursor) {
        complete = true;
        break;
      }
      if (!page.items.length || cursors.has(page.nextCursor))
        throw new Error("试制谱系分页未完整结束。");
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    if (!complete) throw new Error("试制谱系分页未完整结束。");
  }
  const stages = results.map((result) => {
    const common = {
      result: ref(result),
      operation: result.operation,
      origin: result.origin ?? "historical-origin-unspecified",
    };
    if (result.origin && result.origin !== "model")
      return {
        ...common,
        state: "human-confirmation-not-new-model-input" as const,
      };
    const receipt = result.workflowId
      ? receipts.get(result.workflowId)
      : undefined;
    if (!receipt)
      return {
        ...common,
        state: "unavailable" as const,
        reason: "original-workflow-receipt-not-available" as const,
      };
    if (
      receipt.stage !== "applied" ||
      receipt.operation !== result.operation ||
      receipt.outputs.episodeResultId !== result.id ||
      receipt.sourceSnapshotId !== result.sourceSnapshotId ||
      !sameIds(receipt.runIds, result.runIds)
    )
      throw new Error("试制谱系原工作流与实际采用成果不符。");
    return { ...common, state: "available" as const, receipt };
  });
  return PilotWorkflowLineageSchema.parse({
    format: "pilot-selected-workflow-lineage-v1" as const,
    sourceProject: ref(project),
    coverage:
      "selected-adopted-production-workflows-only-not-project-history" as const,
    textIncluded: false as const,
    semanticVerification: "unverified" as const,
    stages,
  });
}
export type PilotWorkflowLineage = ReturnType<typeof pilotWorkflowLineage>;
