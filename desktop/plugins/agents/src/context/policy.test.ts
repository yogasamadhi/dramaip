import { describe, it, expect } from "vitest";
import {
  agentContextManifestJSON,
  AgentContextIntegritySchema,
  AgentContextPreparationRequestSchema,
  type AgentContextReference,
} from "@dramaip/contracts/agent-context";
import { contextPolicy } from "./policy";

const reference: AgentContextReference = {
  sourceKind: "knowledge",
  sourceId: "summary",
  sourceVersion: 0,
  fieldPath: "/knowledge/summary",
  value: "派生概括",
  sensitivity: "project",
  policyDependencies: [
    { sourceId: "chapter", sourceVersion: 1, fieldPath: "/chapters/chapter" },
  ],
};
describe("original context integrity material", () => {
  it("accepts only owner-scoped preparation hashes without plaintext keys, prompts or private recovery material", () => {
    const request = {
      scope: "production.episode-source-revision",
      keySha256: "1".repeat(64),
      requestSha256: "2".repeat(64),
    };
    expect(AgentContextPreparationRequestSchema.parse(request)).toEqual(
      request,
    );
    for (const invalid of [
      { ...request, scope: "../PRIVATE" },
      { ...request, keySha256: "A".repeat(64) },
      { ...request, requestSha256: "PRIVATE body" },
      { ...request, idempotencyKey: "PRIVATE original action key" },
      { ...request, finalPrompt: "PRIVATE source preparation prompt" },
    ])
      expect(
        AgentContextPreparationRequestSchema.safeParse(invalid).success,
      ).toBe(false);
  });
  it("preserves the same manifest through JSON persistence for omitted optional shot-plan fields without erasing actual null, zero or false", () => {
    const material = {
      projectId: crypto.randomUUID(),
      destination: { kind: "local", provider: "test", model: undefined },
      tokenBudget: 60000,
      entries: [
        {
          value: {
            shots: [
              {
                id: "retained",
                retains: { recordId: crypto.randomUUID(), version: 0 },
              },
              { id: "new", retains: undefined },
            ],
            optional: undefined,
            explicitNull: null,
            empty: "",
            actualFalse: false,
            actualZero: 0,
          },
        },
      ],
    };
    const stored = JSON.parse(JSON.stringify(material));
    expect(agentContextManifestJSON(material)).toBe(
      agentContextManifestJSON(stored),
    );
    const original = agentContextManifestJSON(stored);
    for (const key of ["explicitNull", "empty", "actualFalse", "actualZero"]) {
      const changed = structuredClone(stored);
      delete changed.entries[0].value[key];
      expect(agentContextManifestJSON(changed)).not.toBe(original);
    }
    expect(agentContextManifestJSON({ z: 1, a: { d: "中文", c: 0 } })).toBe(
      agentContextManifestJSON({ a: { c: 0, d: "中文" }, z: 1 }),
    );
  });
  it("accepts only body-free original snapshot identities and strict lowercase SHA256 digests, never prompt text or additional proof claims", () => {
    const valid = {
      snapshotId: crypto.randomUUID(),
      manifestSha256: "1".repeat(64),
      finalPromptSha256: "2".repeat(64),
    };
    expect(AgentContextIntegritySchema.parse(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, snapshotId: "not-an-identity" },
      { ...valid, manifestSha256: "A".repeat(64) },
      { ...valid, finalPromptSha256: "short" },
      { ...valid, finalPrompt: "PRIVATE no prompt in integrity metadata" },
      { ...valid, semanticVerification: "verified" },
    ])
      expect(AgentContextIntegritySchema.safeParse(invalid).success).toBe(
        false,
      );
  });
});
describe("derived context privacy", () => {
  it("higher summaries inherit every original and intermediate summary denial even when the final derivative is always", () => {
    const higher = {
      ...reference,
      fieldPath: "/narrative-summaries/higher",
      policyDependencies: [
        ...reference.policyDependencies!,
        { sourceId: "second", sourceVersion: 1, fieldPath: "/chapters/second" },
        {
          sourceId: "summary",
          sourceVersion: 0,
          fieldPath: "/knowledge/summary",
        },
      ],
    };
    for (const path of [
      "/chapters/chapter",
      "/chapters/second",
      "/chapters",
      "/knowledge/summary",
      "/knowledge",
    ])
      expect(
        contextPolicy(
          higher,
          new Map([
            [path, "never"],
            [higher.fieldPath, "always"],
          ]),
          new Map([[higher.fieldPath, "always"]]),
        ),
      ).toEqual({ mode: "never", deniedDependency: path });
  });
  it("denies a derived source even if its own path is always or temporarily always", () => {
    for (const overrides of [
      new Map(),
      new Map([[reference.fieldPath, "always" as const]]),
    ])
      expect(
        contextPolicy(
          reference,
          new Map([
            ["/chapters/chapter", "never"],
            [reference.fieldPath, "always"],
          ]),
          overrides,
        ),
      ).toEqual({ mode: "never", deniedDependency: "/chapters/chapter" });
  });
  it("inherits ancestor denial without accidentally matching sibling paths", () => {
    expect(
      contextPolicy(reference, new Map([["/chapters", "never"]]), new Map())
        .mode,
    ).toBe("never");
    expect(
      contextPolicy(
        reference,
        new Map([["/chapters/chap", "never"]]),
        new Map(),
      ).mode,
    ).toBe("auto");
    expect(
      contextPolicy(reference, new Map([["/knowledge", "never"]]), new Map())
        .mode,
    ).toBe("never");
  });
  it("retains deliberate overrides on the original policy path, not on its derivative", () => {
    expect(
      contextPolicy(
        reference,
        new Map([["/chapters/chapter", "never"]]),
        new Map([["/chapters/chapter", "auto"]]),
      ).mode,
    ).toBe("auto");
    expect(
      contextPolicy(
        { ...reference, policyDependencies: undefined, fieldPath: "/project" },
        new Map([["/project", "never"]]),
        new Map([["/project", "always"]]),
      ).mode,
    ).toBe("always");
  });
});
