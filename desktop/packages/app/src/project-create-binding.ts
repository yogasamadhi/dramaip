import {
  ProjectInputSchema,
  ProjectGoalConfirmationInputSchema,
  type ProjectInput,
  type ProjectGoalConfirmationInput,
} from "@dramaip/contracts/workspace";
import type {
  ProjectMode,
  ProjectInput as RendererProjectInput,
} from "@dramaip/contracts/product";
import type { ProjectCreationSource } from "./project-intake";
import type { CreationDraftV1 } from "./studio-session";

/** Called only by the explicit goal button, never by recommendations or parsing. */
export function explicitCreationGoal(
  mode: ProjectMode,
  material: ProjectCreationSource,
): ProjectGoalConfirmationInput | undefined {
  if (mode !== "series_longform" && mode !== "single_season") return undefined;
  return {
    confirmed: true,
    goal: mode === "series_longform" ? "novel-first" : "screenplay-first",
    material,
  };
}

export function projectInputWithExplicitGoal(
  input: ProjectInput | RendererProjectInput,
  confirmation?: ProjectGoalConfirmationInput,
): ProjectInput {
  const value = ProjectInputSchema.parse(input);
  if (!confirmation) return value;
  const goal = ProjectGoalConfirmationInputSchema.parse(confirmation);
  if (
    value.mode !==
    (goal.goal === "novel-first" ? "series_longform" : "single_season")
  )
    throw new Error("明确目标与实际创建模式不一致；未开始创建。");
  return ProjectInputSchema.parse({ ...value, goalConfirmation: goal });
}

/** Editable native form validation is non-throwing and never enables invalid writes. */
export function projectInputForNativeCreation(
  input: ProjectInput | RendererProjectInput,
  confirmation?: ProjectGoalConfirmationInput,
): ProjectInput | undefined {
  // Rendering an editable form must not throw a write-boundary validation
  // error. Invalid input disables creation without dropping the draft/key.
  try {
    return projectInputWithExplicitGoal(input, confirmation);
  } catch {
    return undefined;
  }
}

/** Preserve the exact input/key before sending an ambiguous create write. */
export function prepareProjectCreationAttempt(
  draft: CreationDraftV1 | undefined,
  candidate: ProjectInput | RendererProjectInput,
) {
  if (draft?.attemptId) {
    if (draft.frozenProjectInput !== undefined) {
      const parsed = ProjectInputSchema.safeParse(draft.frozenProjectInput);
      if (!parsed.success)
        throw new Error("原创建输入损坏；保留同一创建键，不换键或补确认。");
      return {
        attemptId: draft.attemptId,
        input: structuredClone(parsed.data),
        frozenProjectInput: draft.frozenProjectInput,
        legacyInputUnknown: false,
      };
    }
    // Old drafts did not retain the original request. Let the owner compare the
    // best available old fields, but never add proof or pretend it was frozen.
    const { goalConfirmation: ignored, ...legacy } =
      ProjectInputSchema.parse(candidate);
    void ignored;
    return {
      attemptId: draft.attemptId,
      input: ProjectInputSchema.parse(legacy),
      frozenProjectInput: undefined,
      legacyInputUnknown: true,
    };
  }
  const input = projectInputWithExplicitGoal(
    candidate,
    draft?.goalConfirmation,
  );
  return {
    attemptId: crypto.randomUUID(),
    input,
    frozenProjectInput: structuredClone(input),
    legacyInputUnknown: false,
  };
}
