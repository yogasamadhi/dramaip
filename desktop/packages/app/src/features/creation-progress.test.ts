import { describe, expect, it } from "bun:test";
import { creationElapsed, creationStreamPreview } from "./creation-progress";

describe("creation live preview", () => {
  it("renders unfinished content and escape sequences without leaking the JSON envelope", () => {
    expect(
      creationStreamPreview(
        '{"title":"雨夜","content":"林晚推门。\\n他说：\\"回来\\"',
      ),
    ).toBe('林晚推门。\n他说："回来"');
    expect(creationStreamPreview('{"content":"雨\\u591')).toBe("雨");
    expect(creationStreamPreview('{"content":"雨\\u591c\\ud83d')).toBe("雨夜");
    expect(creationStreamPreview('{"content":"雨\\u591c\\ud83d\\ude00"}')).toBe(
      "雨夜😀",
    );
  });
  it("only reads structural keys, including when the chapter quotes JSON", () => {
    const content = '她看到 {"message":"假的检查", "content":"嵌套内容"}。';
    const raw = JSON.stringify({
      title: "雨夜",
      content,
      items: [{ data: { content: "其他字段" } }],
    });
    expect(creationStreamPreview(raw)).toBe(content);
    expect(creationStreamPreview(raw, true)).toBe("");
    expect(creationStreamPreview('```json\n{"content":"正文')).toBe("正文");
  });
  it("shows partial review findings instead of raw issue records", () => {
    expect(
      creationStreamPreview(
        '{"issues":[{"message":"人物动机需要补充","evidence":"原文"},{"message":"检查时间线',
        true,
      ),
    ).toBe("人物动机需要补充\n检查时间线");
    expect(creationStreamPreview('{"issues":[]}', true)).toBe("");
  });
  it("formats actual elapsed time and tolerates clock differences", () => {
    const start = "2026-09-09T00:00:00.000Z";
    expect(creationElapsed(start, Date.parse(start) + 125_000)).toBe(
      "2 分 5 秒",
    );
    expect(creationElapsed(start, Date.parse(start) - 1000)).toBe("0 秒");
  });
});
