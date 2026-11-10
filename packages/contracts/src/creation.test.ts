import { expect, test } from "vitest";
import { parseCreationContent } from "./creation";

test("模型用 null 表示可选字段时保留有效正文与业务数据", () => {
  const result = parseCreationContent(
    "```json\n" +
      JSON.stringify({
        title: "雨夜",
        brief: null,
        content: "门外雨声渐近。",
        items: [
          {
            ref: "one",
            parentRef: null,
            kind: "characters",
            title: "林晚",
            data: { background: null },
          },
        ],
      }) +
      "\n```",
  );
  expect(result.content).toBe("门外雨声渐近。");
  expect(result.brief).toBeUndefined();
  expect(result.items[0]?.parentRef).toBeUndefined();
  expect(result.items[0]?.data).toEqual({ background: null });
});
test("候选必填字段仍严格校验，错误不向用户显示原始解析堆栈", () => {
  for (const raw of [
    '{"content":"未结束',
    JSON.stringify({
      items: [
        { parentRef: null, kind: "characters", title: "缺少 ref", data: {} },
      ],
    }),
    JSON.stringify({
      items: [
        {
          ref: "one",
          parentRef: 12,
          kind: "characters",
          title: "非法父项",
          data: {},
        },
      ],
    }),
  ]) {
    expect(() => parseCreationContent(raw)).toThrow("AI 返回的候选格式不完整");
  }
});
