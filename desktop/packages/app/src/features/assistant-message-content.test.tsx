import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AssistantMessageContent,
  AssistantStageSummary,
  AssistantToolActivity,
  AssistantWebAccessControl,
  AssistantWebSourceCards,
  assistantWebSources,
  assistantToolLabel,
  isAssistantTimelineAutoScrollEvent,
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
    expect(assistantToolLabel("dramaip_web_search")).toBe("搜索公开网络");
    expect(assistantToolLabel("dramaip_read_web_page")).toBe("读取公开网页");
  });

  test("联网活动不展示原始 JSON 或网页正文", () => {
    const html = renderToStaticMarkup(
      <AssistantToolActivity
        item={{
          status: "completed",
          content: "dramaip_read_web_page",
          payload: {
            arguments: { url: "https://example.com/private-query" },
            result: {
              title: "公开来源",
              content: "这段网页正文绝不能出现在工具活动里",
            },
          },
        }}
      />,
    );
    expect(html).toContain("网页已安全读取");
    expect(html).not.toContain('open=""');
    expect(html).not.toContain("private-query");
    expect(html).not.toContain("绝不能出现在工具活动里");
    expect(html).not.toContain("结果摘要");
  });

  test("联网失败明确显示失败而不是零条搜索结果", () => {
    const html = renderToStaticMarkup(
      <AssistantToolActivity
        item={{
          status: "failed",
          content: "dramaip_web_search",
          payload: { error: "联网工具调用失败" },
        }}
      />,
    );
    expect(html).toContain("本次联网操作未完成");
    expect(html).toContain("联网工具调用失败");
    expect(html).not.toContain("已找到 0 条公开网页来源");
  });

  test("来源卡片默认折叠且只渲染清洗后的 HTTPS 元数据", () => {
    const payload = {
      result: {
        results: [
          {
            title: "DramaIP 公开资料",
            url: "https://www.example.com/article",
            excerpt: "用于回答的摘要",
            provider: "exa",
            publishedAt: "2026-08-28T00:00:00.000Z",
            retrievedAt: "2026-08-29T00:00:00.000Z",
            content: "不得持久化的正文",
          },
          { title: "不安全来源", url: "http://127.0.0.1/private" },
        ],
      },
    };
    expect(assistantWebSources(payload)).toHaveLength(1);
    const html = renderToStaticMarkup(
      <AssistantWebSourceCards payload={payload} onOpen={() => undefined} />,
    );
    expect(html).toContain("<details");
    expect(html).not.toContain('open=""');
    expect(html).toContain("1 条");
    expect(html).toContain("展开查看");
    expect(html).toContain("DramaIP 公开资料");
    expect(html).toContain("example.com · exa");
    expect(html).toContain("用于回答的摘要");
    expect(html).not.toContain("不得持久化的正文");
    expect(html).not.toContain("127.0.0.1");
  });

  test("联网模式开关清楚呈现自动、关闭和运行锁定状态", () => {
    const automatic = renderToStaticMarkup(
      <AssistantWebAccessControl mode="auto" onChange={() => undefined} />,
    );
    expect(automatic).toContain("联网搜索 · 自动");
    expect(automatic).toContain('aria-checked="true"');
    const disabled = renderToStaticMarkup(
      <AssistantWebAccessControl
        mode="off"
        disabled
        onChange={() => undefined}
      />,
    );
    expect(disabled).toContain("联网搜索 · 关闭");
    expect(disabled).toContain("disabled");
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
        scrollTop: 576,
        clientHeight: 400,
      }),
    ).toBe(true);
    expect(
      isAssistantTimelineAtLatest({
        scrollHeight: 1_000,
        scrollTop: 560,
        clientHeight: 400,
      }),
    ).toBe(false);
    expect(
      isAssistantTimelineAtLatest({
        scrollHeight: 1_000,
        scrollTop: 500,
        clientHeight: 400,
      }),
    ).toBe(false);
  });

  test("不会把延迟到达的自动滚动事件误判为用户上滑", () => {
    expect(
      isAssistantTimelineAtLatest({
        scrollHeight: 1_400,
        scrollTop: 600,
        clientHeight: 400,
      }),
    ).toBe(false);
    expect(isAssistantTimelineAutoScrollEvent(600, 600)).toBe(true);
    expect(isAssistantTimelineAutoScrollEvent(599.5, 600)).toBe(true);
    expect(isAssistantTimelineAutoScrollEvent(560, 600)).toBe(false);
    expect(isAssistantTimelineAutoScrollEvent(600, undefined)).toBe(false);
  });
});
