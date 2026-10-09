import { expect, test } from "bun:test";
import {
  SourceImportCommitRecoverySchema,
  type SourceImportCommitInput,
} from "@dramaip/contracts/workspace";
import {
  freezeSourceImportAttempt,
  checkSourceImportRecovery,
  restoredSourceImportDraft,
  SourceImportAttemptSchema,
} from "./source-import-binding";
const projectId = "a47fa85e-0191-42fd-b89b-134cfbabbb09";
const importId = "b47fa85e-0191-42fd-b89b-134cfbabbb09";
const input: SourceImportCommitInput = {
  projectId,
  strategy: "append",
  rightsConfirmed: true,
  destructiveConfirmed: false,
  preview: {
    fileName: "原.md",
    sourceType: "markdown",
    contentKind: "novel",
    title: "原输入",
    charCount: 4,
    chapters: [
      {
        key: "original",
        title: "原章节",
        content: "私有正文",
        orderIndex: 0,
        wordCount: 4,
      },
    ],
    episodes: [],
    warnings: [],
  },
};
test("ordinary import freezes original key/input before send and clones mutable scene payloads", () => {
  const candidate = structuredClone(input);
  const first = freezeSourceImportAttempt(importId, candidate);
  candidate.preview.chapters[0]!.content = "编辑的新内容";
  expect(first.input).toEqual(input);
  const second = freezeSourceImportAttempt(importId, candidate, first);
  expect(second).toEqual(first);
  second.input.preview.chapters[0]!.title = "修改副本";
  expect(first.input.preview.chapters[0]!.title).toBe("原章节");
  const script = {
    ...structuredClone(input),
    preview: {
      ...structuredClone(input.preview),
      contentKind: "script" as const,
      episodes: [
        {
          key: "episode",
          episodeNumber: 1,
          title: "剧本",
          content: "内容",
          scenes: [{ characters: ["原人物"] }],
        },
      ],
    },
  };
  const frozen = freezeSourceImportAttempt(importId, script);
  script.preview.episodes[0]!.scenes[0]!.characters.push("新人物");
  expect(frozen.input.preview.episodes[0]!.scenes[0]!.characters).toEqual([
    "原人物",
  ]);
});
test("malformed or foreign import attempts refuse rather than replace key or reconstruct preview", () => {
  const attempt = freezeSourceImportAttempt(importId, input);
  for (const old of [
    { ...attempt, input: undefined },
    { ...attempt, requestKey: "lost" },
    { ...attempt, importId: projectId },
  ])
    expect(() =>
      freezeSourceImportAttempt(importId, input, old as typeof attempt),
    ).toThrow("保留原键");
  expect(() =>
    freezeSourceImportAttempt(
      importId,
      { ...input, projectId: importId },
      attempt,
    ),
  ).toThrow("归属不符");
  expect(() =>
    freezeSourceImportAttempt(importId, { ...input, rightsConfirmed: false }),
  ).toThrow();
  expect(
    SourceImportAttemptSchema.safeParse({ ...attempt, grantId: projectId })
      .success,
  ).toBe(false);
});
test("invalid editable owner input is rejected before an ordinary import attempt is frozen", () => {
  const candidates: SourceImportCommitInput[] = [];
  for (const title of ["   ", "字".repeat(161)]) {
    const candidate = structuredClone(input);
    candidate.preview.chapters[0]!.title = title;
    candidates.push(candidate);
  }
  const duplicate = structuredClone(input);
  duplicate.preview.chapters.push({
    ...duplicate.preview.chapters[0]!,
    orderIndex: 1,
  });
  candidates.push(duplicate);
  const missing = structuredClone(input);
  missing.preview.chapters = [];
  candidates.push(missing);
  const script = structuredClone(input);
  script.preview.contentKind = "script";
  script.preview.episodes = [
    {
      key: "episode",
      episodeNumber: 1,
      title: "原集",
      content: "原文",
      scenes: [{ title: "场".repeat(241) }],
    },
  ];
  candidates.push(script);
  for (const candidate of candidates) {
    const original = structuredClone(candidate);
    expect(() => freezeSourceImportAttempt(importId, candidate)).toThrow(
      "不冻结动作键",
    );
    expect(candidate).toEqual(original);
  }
  // Correcting the still-editable preview is possible; there is no bad frozen key.
  expect(freezeSourceImportAttempt(importId, input).input).toEqual(input);
});
test("unsubmitted restored preview resets rights; original explicit attempt retains only its historical declaration", () => {
  const draft = {
    importId,
    preview: input.preview,
    expiresAt: "2026-10-04T00:00:00.000Z",
    rightsConfirmed: true,
  };
  expect(restoredSourceImportDraft(undefined, draft)?.rightsConfirmed).toBe(
    false,
  );
  const attempt = freezeSourceImportAttempt(importId, input);
  expect(restoredSourceImportDraft(attempt, draft)?.rightsConfirmed).toBe(true);
  expect(
    restoredSourceImportDraft({ ...attempt, input: undefined }, draft),
  ).toBeUndefined();
});
test("read-only recovery must bind exact original scope and body, not changed current editor", () => {
  const attempt = freezeSourceImportAttempt(importId, input);
  const recovery = SourceImportCommitRecoverySchema.parse({
    importId,
    projectId,
    input,
    state: "pending",
    createdAt: "2026-10-04T00:00:00.000Z",
  });
  expect(() => checkSourceImportRecovery(attempt, recovery)).not.toThrow();
  expect(() =>
    checkSourceImportRecovery(attempt, {
      ...recovery,
      input: { ...input, preview: { ...input.preview, title: "重新拼的预览" } },
    }),
  ).toThrow("不重拼");
  expect(() =>
    checkSourceImportRecovery(attempt, { ...recovery, importId: projectId }),
  ).toThrow();
});
