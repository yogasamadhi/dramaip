import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AssistantMessageContent,
  AssistantStageSummary,
  AssistantToolActivity,
  assistantToolLabel,
  isAssistantTimelineAtLatest,
} from "./assistant-message-content";

describe("助手消息排版", () => {
  test("将标题、强调、列表和表格渲染为可读结构", () => {
    const html = renderToStaticMarkup(
      <AssistantMessageContent
        content={`## 题材建议

**都市悬疑**很适合快速进入故事。

- 强冲突
- 快节奏

| 方向 | 书名 |
| --- | --- |
| 悬疑 | 雾港来信 |`}
      />,
    );
    expect(html).toContain("题材建议");
    expect(html).toContain("<strong>都市悬疑</strong>");
    expect(html).toContain("<ul");
    expect(html).toContain("<table");
    expect(html).not.toContain("## 题材建议");
  });

  test("技术工具名转换为中文工作摘要", () => {
    expect(assistantToolLabel("dramaip_get_chapter")).toBe("读取章节正文");
    expect(assistantToolLabel("unknown_tool")).toBe("读取项目资料");
  });

  test("像 Codex 一样连续展示完整工作过程", () => {
    const items = [
      { id: "one", type: "stage", status: "completed", content: "准备上下文" },
      { id: "two", type: "stage", status: "completed", content: "校验结果" },
    ];
    const running = renderToStaticMarkup(
      <AssistantStageSummary items={items} active />,
    );
    expect(running).toContain("校验结果");
    expect(running).toContain("准备上下文");
    expect(running).toContain("工作过程");
    const completed = renderToStaticMarkup(
      <AssistantStageSummary items={items} active={false} />,
    );
    expect(completed).toContain("工作过程");
    expect(completed).toContain("准备上下文");
  });

  test("工具卡默认展开调用目的、输入与结果摘要", () => {
    const html = renderToStaticMarkup(
      <AssistantToolActivity
        item={{
          status: "completed",
          content: "dramaip_get_chapter",
          payload: {
            arguments: { chapterId: "chapter-1" },
            result: { title: "第一章" },
          },
        }}
      />,
    );
    expect(html).toContain('open=""');
    expect(html).toContain("调用目的");
    expect(html).toContain("chapter-1");
    expect(html).toContain("第一章");
  });

  test("只有停留在消息底部时才继续自动跟随", () => {
    expect(
      isAssistantTimelineAtLatest({
        scrollHeight: 1_000,
        scrollTop: 600,
        clientHeight: 400,
      }),
    ).toBe(true);
    expect(
      isAssistantTimelineAtLatest({
        scrollHeight: 1_000,
        scrollTop: 597,
        clientHeight: 400,
      }),
    ).toBe(true);
    expect(
      isAssistantTimelineAtLatest({
        scrollHeight: 1_000,
        scrollTop: 500,
        clientHeight: 400,
      }),
    ).toBe(false);
  });
});
