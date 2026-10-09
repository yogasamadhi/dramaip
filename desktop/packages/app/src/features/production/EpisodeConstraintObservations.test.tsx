import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { EpisodeUpstreamConstraints } from "@dramaip/contracts/production";
import { EpisodeConstraintObservations } from "./EpisodeConstraintObservations";

// Pure presentation samples, not real Runtime sources or semantic proof.
const id = "91000000-0000-4000-8000-000000000003";
const value: EpisodeUpstreamConstraints = {
  format: "formal-constraint-observations-v1",
  items: [
    {
      kind: "direct-source-script",
      frozen: { id, version: 1, contentHash: null, documentVersion: null },
      current: {
        id,
        version: 1,
        contentHash: "a".repeat(64),
        documentVersion: null,
      },
      change: "same-reference",
      readState: "available",
      currentSourceState: "stale",
    },
  ],
  approvedStoryBible: {
    frozenCount: 0,
    currentCount: 0,
    readState: "available",
  },
};
test("constraint view distinguishes absent legacy projection from an actual empty approved collection", () => {
  const absent = renderToStaticMarkup(<EpisodeConstraintObservations />);
  expect(absent).toContain("此原清单未提供正式约束明细");
  expect(absent).not.toContain("冻结 0 份");
  expect(absent).not.toContain("<table");
  const actual = renderToStaticMarkup(
    <EpisodeConstraintObservations value={value} />,
  );
  expect(actual).toContain("冻结 0 份");
  expect(actual).toContain("本次实际集合已读取");
});
test("constraint view presents exact metadata and stale source without treating same identity or missing hash/document as content proof", () => {
  const html = renderToStaticMarkup(
    <EpisodeConstraintObservations value={value} />,
  );
  expect(html.match(new RegExp(id, "g"))).toHaveLength(3);
  expect(html).toContain("身份／版本未观察变化");
  expect(html).toContain("来源服务报告当前来源失效");
  expect(html).toContain("保存文档版本：未记录");
  expect(html).not.toContain("v未记录");
  expect(html).toContain("原清单未记录内容指纹");
  expect(html).toContain("不是全部原著来源或语义影响证明");
  expect(html).toContain("不解除来源失效或全包复核");
  expect(html).toContain("a".repeat(64));
});
test("constraint view does not confuse failed read with removed record or newly added membership", () => {
  const unavailable: EpisodeUpstreamConstraints = {
    ...value,
    items: [
      {
        ...value.items[0]!,
        current: null,
        readState: "unavailable",
        currentSourceState: null,
        change: "unavailable",
      },
    ],
    approvedStoryBible: {
      frozenCount: 0,
      currentCount: null,
      readState: "unavailable",
    },
  };
  const failed = renderToStaticMarkup(
    <EpisodeConstraintObservations value={unavailable} />,
  );
  expect(failed).toContain("当前读取未核全");
  expect(failed).not.toContain("当前记录或正式头不存在");
  expect(failed).toContain("当前 未核全 份");
  const added = renderToStaticMarkup(
    <EpisodeConstraintObservations
      value={{
        ...value,
        items: [{ ...value.items[0]!, frozen: null, change: "added" }],
      }}
    />,
  );
  expect(added).toContain("原清单未绑定此记录");
  expect(added).toContain("当前集合新增");
  const removed = renderToStaticMarkup(
    <EpisodeConstraintObservations
      value={{
        ...value,
        items: [
          {
            ...value.items[0]!,
            current: null,
            currentSourceState: null,
            change: "removed",
          },
        ],
      }}
    />,
  );
  expect(removed).toContain("当前记录或正式头不存在");
  expect(removed).not.toContain("当前读取未核全");
});
