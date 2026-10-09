import { describe, expect, test } from "bun:test";
import type {
  NarrativeQualityRequest,
  NarrativeQualityCatalog,
} from "@dramaip/contracts/creative-quality";
import {
  sameQualityRequest,
  sameQualityTarget,
  isQualityRequestCurrent,
} from "./narrative-quality-scope";

const target: NarrativeQualityRequest["target"] = {
  kind: "chapter",
  id: "b9e57d51-c079-4f2c-8d48-b463c45b0a07",
  version: 3,
};

describe("quality scope identity", () => {
  test("catalog and parsed targets match independently of JSON property order", () => {
    const parsed = {
      id: target.id,
      version: target.version,
      kind: target.kind,
    };
    expect(JSON.stringify(parsed)).not.toBe(JSON.stringify(target));
    expect(sameQualityTarget(target, parsed)).toBe(true);
  });

  test("a source change never silently matches the confirmed target", () => {
    expect(sameQualityTarget(target, { ...target, version: 4 })).toBe(false);
    expect(sameQualityTarget(target, { ...target, kind: "diagnosis" })).toBe(
      false,
    );
    expect(sameQualityTarget(target, { ...target, id: "other" })).toBe(false);
  });
  test("ordinary saved source identity binds the actual fingerprint even when record version is unchanged", () => {
    for (const kind of ["script", "scene"] as const) {
      const source = { ...target, kind, sourceFingerprint: "a".repeat(64) };
      const request: NarrativeQualityRequest = {
        target: source,
        dimensions: ["causality"],
      };
      const catalog: NarrativeQualityCatalog = {
        targets: [{ target: source, title: "实际稿件" }],
        unavailable: [],
      };
      expect(isQualityRequestCurrent(request, catalog)).toBe(true);
      const changed = { ...source, sourceFingerprint: "b".repeat(64) };
      expect(sameQualityTarget(source, changed)).toBe(false);
      expect(sameQualityRequest(request, { ...request, target: changed })).toBe(
        false,
      );
      catalog.targets[0]!.target = changed;
      expect(isQualityRequestCurrent(request, catalog)).toBe(false);
      expect(isQualityRequestCurrent(request, undefined)).toBe(false);
    }
  });

  test("request identity includes the complete dimension scope, not JSON order", () => {
    const request: NarrativeQualityRequest = {
      target,
      dimensions: ["timeline", "causality"],
    };
    expect(
      sameQualityRequest(request, {
        dimensions: ["causality", "timeline"],
        target: { version: 3, id: target.id, kind: "chapter" },
      }),
    ).toBe(true);
    expect(
      sameQualityRequest(request, { ...request, dimensions: ["timeline"] }),
    ).toBe(false);
    expect(
      sameQualityRequest(request, {
        ...request,
        target: { ...target, version: 4 },
      }),
    ).toBe(false);
    expect(sameQualityRequest(request, undefined)).toBe(false);
  });

  const bookTarget: NarrativeQualityRequest["target"] = {
    ...target,
    kind: "chapter-set",
  };
  const chapters = [1, 2, 3, 4].map((index) => ({
    id: `chapter-${index}`,
    version: index,
    title: `第${index}章`,
    hasContent: true,
  }));
  const catalog = (): NarrativeQualityCatalog => ({
    targets: [{ target: bookTarget, title: "全书" }],
    unavailable: [],
    chapterSet: {
      target: bookTarget,
      chapters: [...chapters],
      directoryFingerprint: "a".repeat(64),
    },
  });
  const selected = (): NarrativeQualityRequest => ({
    target: bookTarget,
    dimensions: ["timeline"],
    chapterScope: { mode: "selection", chapters: [chapters[0]!, chapters[3]!] },
  });
  test("recheck identity preserves exact chosen expressions and accepts only canonical object order, not source substitution", () => {
    const request = selected();
    request.context = {
      format: "narrative-context-v1",
      chapters: [
        {
          id: target.id,
          version: 3,
          representation: "paragraphs",
          paragraphIds: ["actual-a", "actual-b"],
        },
      ],
      summaries: [{ id: "8e74c718-3323-4483-a02a-53ac91b4e71b", version: 1 }],
    };
    const equivalent = structuredClone(request);
    equivalent.context!.chapters = [
      {
        paragraphIds: ["actual-a", "actual-b"],
        representation: "paragraphs",
        version: 3,
        id: target.id,
      },
    ];
    expect(sameQualityRequest(request, equivalent)).toBe(true);
    for (const context of [
      undefined,
      {
        ...request.context,
        chapters: [
          { id: target.id, version: 3, representation: "original" as const },
        ],
      },
      {
        ...request.context,
        chapters: [
          {
            id: target.id,
            version: 3,
            representation: "paragraphs" as const,
            paragraphIds: ["actual-a"],
          },
        ],
      },
      {
        ...request.context,
        summaries: [{ id: request.context.summaries![0]!.id, version: 2 }],
      },
    ])
      expect(sameQualityRequest(request, { ...request, context })).toBe(false);
  });
  test("cross-chapter identity includes mode, ordered chapter versions and full-directory fingerprint", () => {
    const request = selected();
    expect(sameQualityRequest(request, structuredClone(request))).toBe(true);
    for (const scope of [
      { ...request.chapterScope!, chapters: [chapters[3]!, chapters[0]!] },
      {
        ...request.chapterScope!,
        chapters: [chapters[0]!, { ...chapters[3]!, version: 5 }],
      },
      { ...request.chapterScope!, chapters: chapters.slice(0, 3) },
      {
        ...request.chapterScope!,
        mode: "full" as const,
        directoryFingerprint: "a".repeat(64),
      },
    ])
      expect(
        sameQualityRequest(request, { ...request, chapterScope: scope }),
      ).toBe(false);
    const full = {
      ...request,
      chapterScope: {
        mode: "full" as const,
        chapters,
        directoryFingerprint: "a".repeat(64),
      },
    };
    expect(
      sameQualityRequest(full, {
        ...full,
        chapterScope: {
          ...full.chapterScope,
          directoryFingerprint: "b".repeat(64),
        },
      }),
    ).toBe(false);
  });
  test("explicit first-and-fourth selection remains local and never expands when unselected chapters change", () => {
    const sources = catalog();
    expect(isQualityRequestCurrent(selected(), sources)).toBe(true);
    sources.chapterSet!.chapters[1] = { ...chapters[1]!, version: 20 };
    sources.chapterSet!.directoryFingerprint = "b".repeat(64);
    sources.chapterSet!.chapters.push({
      id: "new",
      version: 0,
      title: "新增",
      hasContent: true,
    });
    expect(isQualityRequestCurrent(selected(), sources)).toBe(true);
    sources.chapterSet!.chapters[3] = { ...chapters[3]!, version: 5 };
    expect(isQualityRequestCurrent(selected(), sources)).toBe(false);
    expect(isQualityRequestCurrent(selected(), undefined)).toBe(false);
  });
  test("full scope requires all current nonempty versions and unchanged complete directory", () => {
    const sources = catalog();
    const full: NarrativeQualityRequest = {
      target: bookTarget,
      dimensions: ["timeline"],
      chapterScope: {
        mode: "full",
        chapters,
        directoryFingerprint: "a".repeat(64),
      },
    };
    expect(isQualityRequestCurrent(full, sources)).toBe(true);
    expect(
      isQualityRequestCurrent(
        {
          ...full,
          chapterScope: {
            ...full.chapterScope!,
            chapters: chapters.slice(0, 3),
          },
        },
        sources,
      ),
    ).toBe(false);
    sources.chapterSet!.chapters.push({
      id: "blank",
      version: 0,
      title: "空章",
      hasContent: false,
    });
    sources.chapterSet!.directoryFingerprint = "b".repeat(64);
    expect(isQualityRequestCurrent(full, sources)).toBe(false);
    expect(
      isQualityRequestCurrent(
        {
          ...full,
          chapterScope: {
            ...full.chapterScope!,
            directoryFingerprint: "b".repeat(64),
          },
        },
        sources,
      ),
    ).toBe(true);
    sources.chapterSet!.chapters[3] = { ...chapters[3]!, hasContent: false };
    expect(isQualityRequestCurrent(full, sources)).toBe(false);
  });
});
