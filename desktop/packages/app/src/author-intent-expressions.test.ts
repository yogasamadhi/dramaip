import { expect, test } from "vitest";
import { confirmAuthorIntentCreationRequest } from "./author-intent-creation-request";
import type { AuthorIntentSourceCatalog } from "@dramaip/contracts/workspace";
import type { NarrativeContextRequest } from "@dramaip/contracts/creation";
const chapter = crypto.randomUUID(),
  script = crypto.randomUUID();
const catalog: AuthorIntentSourceCatalog = {
  projectVersion: 3,
  chapterAvailable: true,
  scriptAvailable: true,
  items: [
    {
      title: "明确允许章",
      source: {
        kind: "chapter",
        id: chapter,
        version: 4,
        contentHash: "a".repeat(64),
      },
    },
    {
      title: "明确完整剧本",
      source: {
        kind: "script",
        id: script,
        version: 2,
        documentVersion: null,
        contentHash: "b".repeat(64),
      },
    },
  ],
};
const context: NarrativeContextRequest = {
  format: "narrative-context-v1",
  chapters: [
    {
      id: chapter,
      version: 4,
      representation: "paragraphs",
      paragraphIds: ["原明确段落"],
    },
  ],
};
test("AI intent explicit expression confirmation preserves original versions and selections without default original prose or dropping a chosen script", () => {
  const before = structuredClone(context);
  const value = confirmAuthorIntentCreationRequest(
    catalog,
    [script, chapter],
    context,
  );
  expect(value).toEqual({
    request: {
      projectVersion: 3,
      baseAdoptedId: undefined,
      sources: catalog.items.map((item) => item.source),
      context,
    },
  });
  expect(context).toEqual(before);
  expect(JSON.stringify(value)).not.toContain('"representation":"original"');
});
test("AI intent explicit expression confirmation refuses absent scope, foreign or old versions and duplicate paragraph identities rather than substituting current chapters", () => {
  const invalid: [string[], NarrativeContextRequest][] = [
    [[], context],
    [
      [chapter],
      {
        ...context,
        chapters: [{ ...context.chapters[0], id: crypto.randomUUID() }],
      },
    ],
    [
      [chapter],
      { ...context, chapters: [{ ...context.chapters[0], version: 5 }] },
    ],
    [
      [chapter],
      {
        ...context,
        chapters: [
          {
            id: chapter,
            version: 4,
            representation: "paragraphs",
            paragraphIds: ["same", "same"],
          },
        ],
      },
    ],
  ];
  for (const [ids, changed] of invalid)
    expect(
      confirmAuthorIntentCreationRequest(catalog, ids, changed),
    ).toHaveProperty("error");
});
test("AI intent long allowed metadata scope stays explicit while the old complete-source limit remains unchanged", () => {
  const large: AuthorIntentSourceCatalog = {
    ...catalog,
    items: Array.from({ length: 101 }, (_, index) => ({
      title: `原允许范围 ${index}`,
      source: {
        kind: "chapter" as const,
        id: crypto.randomUUID(),
        version: 0,
        contentHash: "c".repeat(64),
      },
    })),
  };
  const ids = large.items.map((item) => item.source.id);
  expect(confirmAuthorIntentCreationRequest(large, ids)).toHaveProperty(
    "error",
  );
  const actual: NarrativeContextRequest = {
    format: "narrative-context-v1",
    chapters: large.items.map(({ source }) => ({
      id: source.id,
      version: source.version,
      representation: "original",
    })),
  };
  const confirmed = confirmAuthorIntentCreationRequest(large, ids, actual);
  expect(confirmed).toHaveProperty("request");
  if ("request" in confirmed) {
    expect(confirmed.request.sources).toHaveLength(101);
    expect(confirmed.request.context).toEqual(actual);
  }
});
