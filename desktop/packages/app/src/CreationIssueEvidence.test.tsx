import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CreationIssue } from "@dramaip/contracts/creation";
import { CreationIssueEvidence } from "./features/CreationIssueEvidence";

const issue: CreationIssue = {
  severity: "warning",
  message: "合成意见",
  evidence: "文字",
  location: "模型位置标签",
  suggestion: "局部修改",
  source: "model",
};

test("candidate evidence shows all original field positions, exact fingerprint and interpretation boundary", () => {
  const recorded = {
    ...issue,
    candidateEvidence: {
      candidateSha256: "a".repeat(64),
      matches: [
        { valuePath: "/content", start: 2, end: 4 },
        { valuePath: "/items/0/data/action", start: 0, end: 2 },
      ],
    },
  };
  const before = structuredClone(recorded);
  const html = renderToStaticMarkup(<CreationIssueEvidence issue={recorded} />);
  for (const expected of [
    "本轮候选引文位置（2 处）",
    "/content",
    "/items/0/data/action",
    "[2, 4)",
    "[0, 2)",
    "a".repeat(64),
    "不证明模型判断正确",
    "UTF-16",
  ])
    expect(html).toContain(expected);
  expect(recorded).toEqual(before);
});

test("historical model issues retain unknown anchors and structural rules do not pretend to be candidate literal evidence", () => {
  const html = renderToStaticMarkup(<CreationIssueEvidence issue={issue} />);
  expect(html).toContain("未记录 AI 草稿引文位置");
  expect(html).not.toContain("SHA-256");
  expect(
    renderToStaticMarkup(
      <CreationIssueEvidence issue={{ ...issue, source: "rule" }} />,
    ),
  ).toBe("");
});
