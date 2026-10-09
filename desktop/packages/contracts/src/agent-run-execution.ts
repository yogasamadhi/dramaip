import { z } from "zod";

const identity = z.string().min(1).max(200);
export const AgentRunExecutionSchema = z
  .object({
    format: z.literal("agent-run-execution-v1"),
    runId: identity,
    sessionId: identity,
    projectId: identity.optional(),
    contextSnapshotId: z.string().uuid().optional(),
    engineKind: z.enum(["pi", "codex", "langgraph"]),
    taskType: identity,
    status: z.enum([
      "created",
      "queued",
      "preparing",
      "running",
      "waiting_approval",
      "committing",
      "completed",
      "interrupted",
      "failed",
      "aborted",
      "canceled",
      "orphaned",
      "recoverable",
    ]),
    model: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("recorded"),
          modelId: identity,
          providerId: identity.optional(),
          profileId: identity.optional(),
        })
        .strict(),
      z.object({ status: z.literal("unrecorded") }).strict(),
      z.object({ status: z.literal("invalid") }).strict(),
    ]),
    timing: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("measured"),
          startedAt: z.string().datetime(),
          completedAt: z.string().datetime(),
          durationMs: z
            .number()
            .int()
            .nonnegative()
            .max(Number.MAX_SAFE_INTEGER),
        })
        .strict(),
      z
        .object({
          status: z.literal("in-progress"),
          startedAt: z.string().datetime(),
        })
        .strict(),
      z.object({ status: z.literal("unrecorded") }).strict(),
      z.object({ status: z.literal("invalid") }).strict(),
    ]),
    source: z.literal("persisted-agent-run"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.timing.status === "measured" &&
      Date.parse(value.timing.completedAt) -
        Date.parse(value.timing.startedAt) !==
        value.timing.durationMs
    )
      ctx.addIssue({
        code: "custom",
        path: ["timing"],
        message: "运行耗时须来自实际起止时间，不补零或当前时钟。",
      });
    if (
      value.timing.status === "in-progress" &&
      [
        "completed",
        "failed",
        "canceled",
        "aborted",
        "interrupted",
        "orphaned",
      ].includes(value.status)
    )
      ctx.addIssue({
        code: "custom",
        path: ["timing"],
        message: "终态未记完成时间不等于仍在运行。",
      });
  });
export type AgentRunExecution = z.infer<typeof AgentRunExecutionSchema>;
