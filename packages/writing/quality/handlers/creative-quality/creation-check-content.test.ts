import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreationContentSchema,
  CreationIssueSchema,
  CreationOperationSchema,
  type CreationContent,
  type CreationIssue,
} from "@dramaip/contracts/creation";
import {
  collectCreationIssues,
  creationQualityPrompt,
} from "./creation-check-content.js";

const issue = {
  severity: "warning" as const,
  message: "合成局部建议",
  evidence: "推开门",
  location: "作者可读位置标签",
  suggestion: "核对动作原因，保留其他段落",
  source: "model" as const,
};
const candidate = (): CreationContent => ({
  title: "本轮候选",
  content: "林晚推开门。她又推开门。",
  items: [],
});
const check = (value: unknown) => JSON.stringify({ issues: [value] });
const rules: CreationIssue[] = [
  {
    severity: "error",
    message: "缺失必需结构",
    evidence: "",
    location: "必需场景",
    suggestion: "补齐结构后复检",
    source: "rule",
  },
];

describe("creation checkpoint literal candidate evidence", () => {
  it("records every exact UTF-16 position and the parsed actual candidate hash, preserving independent structural rules without semantic certification", () => {
    const input = candidate();
    const before = structuredClone({ input, rules });
    const result = collectCreationIssues(check(issue), rules, input);
    expect(result).toEqual([
      rules[0],
      {
        ...issue,
        candidateEvidence: {
          candidateSha256: createHash("sha256")
            .update(JSON.stringify(CreationContentSchema.parse(input)))
            .digest("hex"),
          matches: [
            { valuePath: "/content", start: 2, end: 5 },
            { valuePath: "/content", start: 8, end: 11 },
          ],
        },
      },
    ]);
    expect({ input, rules }).toEqual(before);
    expect(CreationIssueSchema.parse(result[1])).toEqual(result[1]);
  });

  it("locates structured diagnosis/season/script/storyboard candidate fields and escapes JSON pointer keys, not ref/kind metadata", () => {
    const input: CreationContent = {
      title: "题目",
      brief: "简介",
      content: "",
      items: [
        {
          ref: "PRIVATE REF",
          parentRef: "PRIVATE PARENT",
          kind: "PRIVATE KIND",
          title: "镜头1",
          data: {
            "对白/视角~": ["😀推开门", { action: "推开门" }],
            duration: 90,
            enabled: true,
          },
        },
      ],
    };
    expect(
      collectCreationIssues(check(issue), [], input)[0]?.candidateEvidence
        ?.matches,
    ).toEqual([
      { valuePath: "/items/0/data/对白~1视角~0/0", start: 2, end: 5 },
      { valuePath: "/items/0/data/对白~1视角~0/1/action", start: 0, end: 3 },
    ]);
    for (const evidence of [
      "PRIVATE REF",
      "PRIVATE PARENT",
      "PRIVATE KIND",
      "duration",
      "90",
      "true",
    ])
      expect(() =>
        collectCreationIssues(check({ ...issue, evidence }), [], input),
      ).toThrow("本轮候选");
    for (const evidence of ["题目", "简介", "镜头1"])
      expect(
        collectCreationIssues(check({ ...issue, evidence }), [], input)[0]
          ?.candidateEvidence?.matches,
      ).toHaveLength(1);
  });

  for (const field of ["message", "evidence", "location", "suggestion"])
    it(`rejects empty or whitespace-only ${field} on new checkpoints while historical issue parsing remains compatible`, () => {
      for (const blank of ["", " \n\t "]) {
        const invalid = { ...issue, [field]: blank };
        expect(() =>
          collectCreationIssues(check(invalid), [], candidate()),
        ).toThrow("创作检查结果无效");
        if (field !== "message" || blank)
          expect(CreationIssueSchema.parse(invalid)).toEqual(invalid);
      }
    });

  it("rejects fabricated, normalized or former-candidate quotes instead of silently dropping issues; revision binds a new exact hash", () => {
    const original = candidate();
    const revised = { ...candidate(), content: "林晚来到窗边。" };
    for (const evidence of ["不存在的文字", "林晚 推开门", "推开門"])
      expect(() =>
        collectCreationIssues(check({ ...issue, evidence }), [], original),
      ).toThrow("本轮候选");
    const first = collectCreationIssues(check(issue), [], original)[0]!;
    expect(() => collectCreationIssues(check(issue), [], revised)).toThrow(
      "本轮候选",
    );
    const second = collectCreationIssues(
      check({ ...issue, evidence: "来到窗边" }),
      [],
      revised,
    )[0]!;
    expect(second.candidateEvidence!.candidateSha256).not.toBe(
      first.candidateEvidence!.candidateSha256,
    );
    expect(first.candidateEvidence!.matches).toHaveLength(2);
  });

  it("does not accept model-supplied anchors, extra fields or malformed checks, and a spoofed rule source remains a model interpretation", () => {
    for (const raw of [
      "not JSON",
      "null",
      "{}",
      JSON.stringify({ issues: [], passed: true }),
      check({
        ...issue,
        candidateEvidence: { candidateSha256: "a".repeat(64), matches: [] },
      }),
      check({ ...issue, locationPath: "/forged" }),
    ])
      expect(() => collectCreationIssues(raw, [], candidate())).toThrow(
        "创作检查结果无效",
      );
    expect(
      collectCreationIssues(
        check({ ...issue, source: "rule" }),
        [],
        candidate(),
      )[0]?.source,
    ).toBe("model");
    expect(
      collectCreationIssues('```json\n{"issues":[]}\n```', rules, candidate()),
    ).toEqual(rules);
  });

  it("keeps overlapping occurrences and rejects over-broad or over-deep evidence without guessing a first match", () => {
    expect(
      collectCreationIssues(check({ ...issue, evidence: "aa" }), [], {
        ...candidate(),
        content: "aaa",
      })[0]?.candidateEvidence?.matches,
    ).toEqual([
      { valuePath: "/content", start: 0, end: 2 },
      { valuePath: "/content", start: 1, end: 3 },
    ]);
    expect(() =>
      collectCreationIssues(check({ ...issue, evidence: "a" }), [], {
        ...candidate(),
        content: "a".repeat(101),
      }),
    ).toThrow("匹配过多");
    let nested: unknown = "推开门";
    for (let index = 0; index < 66; index++) nested = { nested };
    expect(() =>
      collectCreationIssues(check(issue), [], {
        ...candidate(),
        items: [
          { ref: "one", kind: "script", title: "结构", data: { nested } },
        ],
      }),
    ).toThrow("超出可核对范围");
  });

  it("supplies operation-specific original adoption Gate focus without forcing media or short-drama quality on novels", () => {
    for (const operation of CreationOperationSchema.options) {
      const prompt = creationQualityPrompt(operation);
      expect(prompt).toContain("审阅候选与冻结");
      expect(prompt).toContain("本轮候选");
      expect(prompt).toContain("引文存在不等于推断正确");
    }
    expect(creationQualityPrompt("chapter")).toContain("文风/叙述视角");
    expect(creationQualityPrompt("chapter")).toContain("不把未短剧化");
    expect(creationQualityPrompt("adaptation-diagnosis")).toContain(
      "严重覆盖不足",
    );
    expect(creationQualityPrompt("season-plan")).toContain("关键人物弧断裂");
    expect(creationQualityPrompt("episode-script")).toContain("目标时长和集尾");
    expect(creationQualityPrompt("storyboard-package")).toContain(
      "风险不是报价",
    );
  });
});
