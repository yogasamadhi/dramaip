import { z } from "zod";

const identity = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const CreationSourceChangeSchema = z
  .object({
    sourceKind: z.enum([
      "author_intent",
      "project",
      "chapter",
      "writing_resource",
      "production",
      "knowledge",
      "story_bible",
    ]),
    frozen: identity,
    current: identity,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.frozen.id === value.current.id &&
      value.frozen.version === value.current.version
    )
      ctx.addIssue({
        code: "custom",
        message:
          "A source conflict requires an observed identity or version difference.",
      });
  });
export type CreationSourceChange = z.infer<typeof CreationSourceChangeSchema>;
export const CreationSourceConflictSchema = z
  .object({
    projectId: z.string().uuid(),
    workflowId: z.string().uuid(),
    changes: z.array(CreationSourceChangeSchema).min(1).max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(
        value.changes.map(
          (change) => `${change.sourceKind}:${change.frozen.id}`,
        ),
      ).size !== value.changes.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Frozen source identities must be unique.",
      });
  });
export type CreationSourceConflict = z.infer<
  typeof CreationSourceConflictSchema
>;
type WorkflowScope = { id: string; input: { projectId: string } };

/** Internal owner evidence, never inferred from an error message or a 409. */
export class CreationSourceConflictError extends Error {
  readonly sourceConflict: CreationSourceConflict;
  constructor(
    workflow: WorkflowScope,
    changes: CreationSourceChange[],
    message: string,
  ) {
    super(message);
    this.name = "CreationSourceConflictError";
    this.sourceConflict = CreationSourceConflictSchema.parse({
      projectId: workflow.input.projectId,
      workflowId: workflow.id,
      changes,
    });
  }
}

/** Unknown/missing sources remain ordinary rejection, not observed change. */
export function assertCreationSourceVersionCurrent(
  workflow: WorkflowScope,
  sourceKind: CreationSourceChange["sourceKind"],
  frozen: { id: string; version: number },
  current: { id: string; version: number } | undefined,
  message: string,
): void {
  if (current?.id === frozen.id && current.version === frozen.version) return;
  const observed = CreationSourceChangeSchema.safeParse({
    sourceKind,
    frozen: { id: frozen.id, version: frozen.version },
    current: current ? { id: current.id, version: current.version } : undefined,
  });
  if (!observed.success) throw new Error(message);
  throw new CreationSourceConflictError(workflow, [observed.data], message);
}
