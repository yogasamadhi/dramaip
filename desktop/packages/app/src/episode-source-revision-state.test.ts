import { expect, test } from "vitest";
import type {
  EpisodeDevelopmentCatalog,
  EpisodeDevelopmentResult,
  ScreenplayDocument,
} from "@dramaip/contracts/production";
import {
  SourceRevisionRecoverySchema,
  readSourceRevisionRecovery,
  saveSourceRevisionRecovery,
  clearSourceRevisionRecovery,
  sourceRevisionRecoveryKey,
  verifySourceRevisionRecoveryReply,
  readExactSourceRevision,
  sourceRevisionSceneLinks,
  newSourceRevisionRequest,
  rebindSameSelectedSourceVersions,
  type SourceRevisionRecovery,
} from "./episode-source-revision-state";

// Pure protocol fixtures, not actual manuscripts, model output or quality proof.
const id = (n: number) =>
  `92000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const binding = {
  projectId: id(1),
  episodeId: id(2),
  sourceScript: { id: id(3), version: 2 },
  sourceOutline: { id: id(4), version: 3 },
};
const reference = {
  sourceKind: "project" as const,
  sourceId: id(1),
  sourceVersion: 2,
  fieldPath: "/project",
};
const outline = {
  title: "纯测试",
  logline: "纯测试",
  goal: "纯测试",
  mainConflict: "纯测试",
  turningPoint: "纯测试",
  endingHook: "纯测试",
  scenes: [
    {
      id: "scene-1",
      orderIndex: 0,
      location: "室内",
      timeOfDay: "夜",
      goal: "纯测试",
      conflict: "纯测试",
      outcome: "纯测试",
      characters: ["甲"],
      durationSeconds: 90,
      sourceChapters: [],
      sourceReferences: [reference],
      beats: [{ id: "beat", action: "纯测试", causalLink: "纯测试" }],
      sourceEvidence: [
        {
          id: "evidence",
          source: reference,
          valuePath: "/content/synopsis",
          quote: "固定原引文",
          rationale: "PRIVATE声明",
        },
      ],
    },
  ],
};
const request = {
  episodeId: binding.episodeId,
  baseOutlineId: binding.sourceOutline.id,
  direct: {
    entryPath: "inspiration" as const,
    project: { id: binding.projectId, version: 3 },
    authorIntent: { id: id(5), version: 1 },
    episode: { id: binding.episodeId, version: 0 },
    durationSeconds: 90,
  },
};
const input = {
  sourceVersion: binding.sourceScript.version,
  outline: binding.sourceOutline,
  documentVersion: 0,
  request,
  tokenBudget: 60_000,
  outlineContent: outline,
  sceneLinks: [{ sceneId: "scene-1", blockIds: [id(8), id(9)] }],
};
const preview = (): SourceRevisionRecovery =>
  SourceRevisionRecoverySchema.parse({
    ...binding,
    format: "author-source-revision-request-v1",
    document: { id: id(6), scriptId: id(7), version: 0 },
    key: id(10),
    savedAt: "2026-10-05T06:00:00.000Z",
    action: "preview",
    input,
  });
const storage = () => {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
};
const recoveryReply = (pending = preview()) => ({
  ...binding,
  document: pending.document,
  id: id(20),
  input,
  status: "pending" as const,
  stateVersion: 0,
});

test("来源恢复在发送前保存完整原请求，重启仍是原键／版本／预算／引文／映射", () => {
  const store = storage(),
    original = preview();
  expect(readSourceRevisionRecovery(store, binding)).toBeUndefined();
  saveSourceRevisionRecovery(store, original);
  expect(readSourceRevisionRecovery(store, binding)).toEqual(original);
  expect(store.entries.get(sourceRevisionRecoveryKey(binding))).toContain(
    "PRIVATE声明",
  );
  verifySourceRevisionRecoveryReply(recoveryReply(original), original);
  // Original preview replay can return its actual already-adopted projection.
  verifySourceRevisionRecoveryReply(
    { ...recoveryReply(original), status: "adopted", stateVersion: 1 },
    original,
  );
  clearSourceRevisionRecovery(store, original);
  expect(readSourceRevisionRecovery(store, binding)).toBeUndefined();
});
test("存储拒绝／静默丢写不发送，已有原请求／跨窗口变化不覆盖或删除", () => {
  for (const setItem of [
    () => {
      throw new Error("quota");
    },
    () => {},
  ]) {
    const store = { ...storage(), setItem };
    let sent = false;
    expect(() => {
      saveSourceRevisionRecovery(store, preview());
      sent = true;
    }).toThrow();
    expect(sent).toBe(false);
  }
  const store = storage(),
    original = preview();
  saveSourceRevisionRecovery(store, original);
  expect(() =>
    saveSourceRevisionRecovery(store, { ...original, key: id(11) }),
  ).toThrow();
  const changed = { ...original, key: id(12) };
  store.setItem(sourceRevisionRecoveryKey(binding), JSON.stringify(changed));
  expect(() => clearSourceRevisionRecovery(store, original)).toThrow();
  expect(readSourceRevisionRecovery(store, binding)?.key).toBe(changed.key);
});
test("坏记录／其他原双头／完整请求错配保留原字节，不猜新请求", () => {
  const original = preview();
  for (const raw of [
    "{broken",
    JSON.stringify({ ...original, format: "unknown" }),
    JSON.stringify({ ...original, sourceOutline: { id: id(99), version: 3 } }),
    JSON.stringify({ ...original, input: { ...input, sourceVersion: 4 } }),
  ]) {
    const store = storage();
    store.setItem(sourceRevisionRecoveryKey(binding), raw);
    expect(() => readSourceRevisionRecovery(store, binding)).toThrow();
    expect(store.getItem(sourceRevisionRecoveryKey(binding))).toBe(raw);
  }
});
test("恢复回复核完整身份、预算、文档与每项原引用，不清除错回执", () => {
  const original = preview(),
    reply = recoveryReply();
  for (const patch of [
    { projectId: id(99) },
    { episodeId: id(99) },
    { sourceScript: { ...binding.sourceScript, version: 9 } },
    { document: { ...original.document, version: 3 } },
    { input: { ...input, tokenBudget: 128 } },
    {
      input: {
        ...input,
        sceneLinks: [...input.sceneLinks].map((link) => ({
          ...link,
          blockIds: [...link.blockIds].reverse(),
        })),
      },
    },
  ])
    expect(() =>
      verifySourceRevisionRecoveryReply({ ...reply, ...patch }, original),
    ).toThrow();
});
test("五项原审阅采用与撤回分开冻结，原状态／预览错配不认作决定", () => {
  const base = preview(),
    confirmation = {
      currentSourcesReviewed: true,
      outlineReviewed: true,
      actualDocumentReviewed: true,
      sceneMappingReviewed: true,
      retainedManuscriptReviewed: true,
    } as const;
  const adoption = SourceRevisionRecoverySchema.parse({
    ...binding,
    format: base.format,
    document: base.document,
    key: id(30),
    savedAt: base.savedAt,
    action: "adopt",
    id: id(20),
    stateVersion: 5,
    confirmation,
  });
  const reply = {
    ...recoveryReply(),
    status: "adopted" as const,
    stateVersion: 6,
    confirmation,
  };
  verifySourceRevisionRecoveryReply(reply, adoption);
  for (const patch of [
    { id: id(99) },
    { stateVersion: 7 },
    { status: "discarded" as const },
    { confirmation: undefined },
  ])
    expect(() =>
      verifySourceRevisionRecoveryReply({ ...reply, ...patch }, adoption),
    ).toThrow();
  expect(
    SourceRevisionRecoverySchema.safeParse({
      ...adoption,
      confirmation: { ...confirmation, currentSourcesReviewed: false },
    }).success,
  ).toBe(false);
  const discard = SourceRevisionRecoverySchema.parse({
    ...binding,
    format: base.format,
    document: base.document,
    key: id(31),
    savedAt: base.savedAt,
    action: "discard",
    id: id(20),
    stateVersion: 5,
  });
  verifySourceRevisionRecoveryReply({ ...reply, status: "discarded" }, discard);
});
test("来源首读／失败缓存和错预览不可见，后续成功轮询只保留精确原快照", () => {
  const value = recoveryReply(),
    expected = { ...binding, id: value.id },
    query = { data: value, status: "success", isFetchedAfterMount: true };
  expect(readExactSourceRevision(query, expected)).toBe(value);
  for (const patch of [
    { isFetchedAfterMount: false },
    { status: "pending" },
    { error: new Error("owner") },
    { data: { ...value, id: id(99) } },
    {
      data: {
        ...value,
        sourceOutline: { ...binding.sourceOutline, version: 7 },
      },
    },
  ])
    expect(
      readExactSourceRevision({ ...query, ...patch }, expected),
    ).toBeUndefined();
});
test("实际映射只沿稳定标题块，新标题须明确选择；标题前内容不丢弃", () => {
  const blocks = [
    { id: id(8), type: "scene_heading" as const, text: "INT. 室内 - NIGHT" },
    { id: id(9), type: "action" as const, text: "原稿" },
    { id: id(40), type: "scene_heading" as const, text: "EXT. 室外 - NIGHT" },
    { id: id(41), type: "action" as const, text: "新场" },
  ];
  const document = { blocks } as ScreenplayDocument;
  expect(
    sourceRevisionSceneLinks(document, {
      blocks,
      sceneLinks: input.sceneLinks,
    }),
  ).toEqual([...input.sceneLinks, { sceneId: "", blockIds: [id(40), id(41)] }]);
  expect(() =>
    sourceRevisionSceneLinks(
      { blocks: blocks.slice(1) } as ScreenplayDocument,
      { blocks, sceneLinks: input.sceneLinks },
    ),
  ).toThrow();
});
const original = {
  id: binding.sourceScript.id,
  version: binding.sourceScript.version,
  projectId: binding.projectId,
  episodeId: binding.episodeId,
  operation: "episode-script",
  basis: {
    request: {
      outline: binding.sourceOutline,
      direct: request.direct,
      sourceEvidenceFormat: "exact-expression-quotes-v1",
    },
  },
} as EpisodeDevelopmentResult;
const catalog = {
  projectId: binding.projectId,
  direct: {
    entryPath: "inspiration",
    project: request.direct.project,
    authorIntent: request.direct.authorIntent,
    episodes: [
      {
        ...request.direct.episode,
        scripts: [
          { id: id(45), version: 4, documentVersion: 2, title: "实际稿件" },
        ],
      },
    ],
  },
} as EpisodeDevelopmentCatalog;
const choice = {
  durationSeconds: 90,
  novelMode: "inherit" as const,
  narrative: { format: "narrative-context-v1" as const, chapters: [] },
};
test("新来源选择不猜首项、跨路径或其他集，不强迫独立创意引用小说／稿件", () => {
  const selected = newSourceRevisionRequest(original, catalog, choice);
  expect(selected.direct?.sourceScript).toBeUndefined();
  expect(selected.seasonPlan).toBeUndefined();
  expect(selected.sourceEvidenceFormat).toBe("exact-expression-quotes-v1");
  expect(() =>
    newSourceRevisionRequest(
      original,
      { ...catalog, projectId: id(99) },
      choice,
    ),
  ).toThrow();
  expect(() =>
    newSourceRevisionRequest(original, catalog, {
      ...choice,
      sourceScriptId: id(99),
    }),
  ).toThrow();
  const scriptCatalog = {
      ...catalog,
      direct: { ...catalog.direct!, entryPath: "script" as const },
    },
    scriptOriginal = {
      ...original,
      basis: {
        ...original.basis,
        request: {
          ...original.basis.request,
          direct: {
            ...request.direct,
            entryPath: "script" as const,
            sourceScript: { id: id(45), version: 3, documentVersion: 1 },
          },
        },
      },
    };
  expect(() =>
    newSourceRevisionRequest(scriptOriginal, scriptCatalog, choice),
  ).toThrow();
  expect(
    newSourceRevisionRequest(scriptOriginal, scriptCatalog, {
      ...choice,
      sourceScriptId: id(45),
    }).direct?.sourceScript,
  ).toEqual({ id: id(45), version: 4, documentVersion: 2 });
});
test("显式同 ID 换版不改引文、位置、路径或其他来源身份；旧大纲不变", () => {
  const next = rebindSameSelectedSourceVersions(outline, request, catalog);
  expect(next.scenes[0]!.sourceReferences![0]!.sourceVersion).toBe(3);
  expect(next.scenes[0]!.sourceEvidence![0]!.source.sourceVersion).toBe(3);
  expect(next.scenes[0]!.sourceEvidence![0]!.quote).toBe("固定原引文");
  expect(next.scenes[0]!.sourceEvidence![0]!.valuePath).toBe(
    "/content/synopsis",
  );
  expect(outline.scenes[0]!.sourceReferences[0]!.sourceVersion).toBe(2);
});

test("小说新来源明确保留原集并选当前季纲，独立表达空选择拒绝，不强制继承", () => {
  const novel = {
    ...original,
    basis: {
      ...original.basis,
      request: {
        episodeId: binding.episodeId,
        outline: binding.sourceOutline,
        seasonPlan: { id: id(50), version: 1 },
        sourceEvidenceFormat: "exact-expression-quotes-v1" as const,
      },
    },
  };
  const sources = {
    projectId: binding.projectId,
    seasonPlan: { id: id(51), version: 2 },
    episodes: [
      { id: binding.episodeId, sourceChapters: [{ id: id(52), version: 3 }] },
    ],
    narrativeSources: { basis: { chapters: [] } },
  } as unknown as EpisodeDevelopmentCatalog;
  const inherited = newSourceRevisionRequest(novel, sources, choice);
  expect(inherited.seasonPlan).toEqual(sources.seasonPlan);
  expect(inherited.inheritSeasonNarrative).toBe(true);
  expect(inherited.direct).toBeUndefined();
  expect(() =>
    newSourceRevisionRequest(novel, { ...sources, episodes: [] }, choice),
  ).toThrow();
  expect(() =>
    newSourceRevisionRequest(novel, sources, {
      ...choice,
      novelMode: "independent",
    }),
  ).toThrow();
  const narrative = {
    format: "narrative-context-v1" as const,
    chapters: [
      {
        id: id(52),
        version: 3,
        representation: "paragraphs" as const,
        paragraphIds: ["original-location"],
      },
    ],
  };
  const selected = newSourceRevisionRequest(novel, sources, {
    ...choice,
    novelMode: "independent",
    narrative,
  });
  expect(selected.inheritSeasonNarrative).toBeUndefined();
  expect(selected.episodeNarrativeContext).toEqual(narrative);
  expect(selected.sourceEvidenceFormat).toBe("exact-expression-quotes-v1");
});
