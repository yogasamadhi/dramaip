import { expect, test } from "bun:test";
import { ProjectInputSchema } from "@dramaip/contracts/workspace";
import { createCreationDraft, parseCreationDraft } from "./studio-session";
import {
  explicitCreationGoal,
  projectInputForNativeCreation,
  prepareProjectCreationAttempt,
  projectInputWithExplicitGoal,
} from "./project-create-binding";

test("invalid native form input is non-throwing and cannot silently drop explicit proof or enable a write", () => {
  const goal = explicitCreationGoal("single_season", "script");
  expect(
    projectInputForNativeCreation(
      { title: "长".repeat(161), mode: "single_season" },
      goal,
    ),
  ).toBeUndefined();
  expect(
    projectInputForNativeCreation({ title: "", mode: "single_season" }, goal),
  ).toBeUndefined();
  expect(
    projectInputForNativeCreation(
      { title: "错配模式", mode: "series_longform" },
      goal,
    ),
  ).toBeUndefined();
  expect(
    projectInputForNativeCreation(
      { title: "有效名称", mode: "single_season" },
      goal,
    )?.goalConfirmation,
  ).toEqual(goal);
});

test("only a primary explicit goal selection creates proof; recommendations and old draft steps remain unknown", () => {
  const draft = createCreationDraft("project-home");
  expect(draft.goalConfirmation).toBeUndefined();
  expect(
    parseCreationDraft(JSON.stringify({ ...draft, intakeStep: 3 }))
      ?.goalConfirmation,
  ).toBeUndefined();
  expect(explicitCreationGoal("series_longform", "inspiration")).toEqual({
    confirmed: true,
    goal: "novel-first",
    material: "inspiration",
  });
  expect(explicitCreationGoal("single_season", "script")).toEqual({
    confirmed: true,
    goal: "screenplay-first",
    material: "script",
  });
  expect(
    explicitCreationGoal("personal_theater", "inspiration"),
  ).toBeUndefined();
  expect(
    explicitCreationGoal("creator_channel", "inspiration"),
  ).toBeUndefined();
  const input = ProjectInputSchema.parse({ title: "不推断目标" });
  expect(projectInputWithExplicitGoal(input).goalConfirmation).toBeUndefined();
  expect(() =>
    projectInputWithExplicitGoal(
      input,
      explicitCreationGoal("single_season", "script"),
    ),
  ).toThrow("不一致");
});

test("a new create freezes exact original input with its key, surviving edited forms and JSON restart without re-confirming", () => {
  const draft = createCreationDraft("project-home");
  draft.goalConfirmation = explicitCreationGoal(
    "series_longform",
    "source-import",
  );
  const candidate = ProjectInputSchema.parse({
    title: "原请求标题",
    synopsis: "PRIVATE manuscript brief",
  });
  const first = prepareProjectCreationAttempt(draft, candidate);
  expect(first.input.goalConfirmation).toEqual(draft.goalConfirmation);
  expect(first.frozenProjectInput).toEqual(first.input);
  const restored = parseCreationDraft(
    JSON.stringify({
      ...draft,
      attemptId: first.attemptId,
      frozenProjectInput: first.frozenProjectInput,
      goalConfirmation: explicitCreationGoal("single_season", "script"),
      brief: { ...draft.brief, title: "编辑后的标题" },
    }),
  )!;
  const second = prepareProjectCreationAttempt(
    restored,
    ProjectInputSchema.parse({ title: "编辑后的标题", mode: "single_season" }),
  );
  expect(second.attemptId).toBe(first.attemptId);
  expect(second.input).toEqual(first.input);
  expect(second.legacyInputUnknown).toBe(false);
  first.input.title = "改变返回对象";
  expect(second.input.title).toBe("原请求标题");
  expect(restored.frozenProjectInput?.title).toBe("原请求标题");
});

test("old ambiguous keys never gain new goal fields or fabricated original input, and corrupt frozen input preserves recovery identity", () => {
  const draft = createCreationDraft("project-home");
  draft.attemptId = "old-ambiguous-key";
  draft.goalConfirmation = explicitCreationGoal(
    "series_longform",
    "inspiration",
  );
  const candidate = ProjectInputSchema.parse({
    title: "旧输入",
    goalConfirmation: draft.goalConfirmation,
  });
  const attempt = prepareProjectCreationAttempt(draft, candidate);
  expect(attempt.attemptId).toBe(draft.attemptId);
  expect(attempt.input.goalConfirmation).toBeUndefined();
  expect(attempt.frozenProjectInput).toBeUndefined();
  expect(attempt.legacyInputUnknown).toBe(true);
  const bad = parseCreationDraft(
    JSON.stringify({ ...draft, frozenProjectInput: { title: null } }),
  )!;
  expect(bad.attemptId).toBe(draft.attemptId);
  expect(() => prepareProjectCreationAttempt(bad, candidate)).toThrow(
    "原创建输入损坏",
  );
  expect(bad.attemptId).toBe(draft.attemptId);
});
