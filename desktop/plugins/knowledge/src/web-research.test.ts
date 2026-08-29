import { describe, expect, it, vi } from "vitest";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { WebResearchAdapter } from "./web-research";

function hostWith(
  values: Partial<{
    webSearch: DesktopHostClient["webSearch"];
    publicSearch: DesktopHostClient["publicSearch"];
    readWebPage: DesktopHostClient["readWebPage"];
  }>,
): DesktopHostClient {
  return {
    webSearch: values.webSearch,
    publicSearch: values.publicSearch,
    readWebPage: values.readWebPage,
  } as DesktopHostClient;
}

describe("knowledge.web-research.v1", () => {
  it("uses a stable primary provider, caches results, and sanitizes the query", async () => {
    const webSearch = vi.fn(
      async (input: Parameters<DesktopHostClient["webSearch"]>[0]) => ({
        provider: input.provider,
        text: "[DramaIP 文档](https://example.com/dramaip)\n\n公开说明",
        coverage: "anonymous test provider",
      }),
    );
    const adapter = new WebResearchAdapter(
      hostWith({
        webSearch,
        publicSearch: vi.fn(async () => ({
          source: "duckduckgo" as const,
          coverage: "unused",
          results: [],
        })),
      }),
    );
    const input = {
      query:
        "DramaIP Bearer abcdefghijklmnop /Users/demo/private/story/chapter.txt",
      limit: 1,
      sessionId: "stable-session",
    };

    const first = await adapter.search(input);
    const second = await adapter.search(input);

    expect(second).toEqual(first);
    expect(webSearch).toHaveBeenCalledTimes(1);
    expect(webSearch.mock.calls[0]![0].query).not.toMatch(
      /abcdefghijklmnop|\/Users\/demo\/private/u,
    );
    expect(first.results).toEqual([
      expect.objectContaining({
        title: "DramaIP 文档",
        url: "https://example.com/dramaip",
      }),
    ]);
  });

  it("falls back from a failed anonymous MCP provider to the other provider", async () => {
    const providers: string[] = [];
    const adapter = new WebResearchAdapter(
      hostWith({
        webSearch: vi.fn(async (input) => {
          providers.push(input.provider);
          if (providers.length === 1) throw new Error("429 rate limited");
          return {
            provider: input.provider,
            text: "[第二搜索源](https://example.org/source)",
            coverage: "second provider",
          };
        }),
        publicSearch: vi.fn(async () => ({
          source: "duckduckgo" as const,
          coverage: "unused",
          results: [],
        })),
      }),
    );

    const result = await adapter.search({
      query: "今天的公开资料",
      limit: 1,
      sessionId: "fallback-session",
    });

    expect(providers).toHaveLength(2);
    expect(new Set(providers)).toEqual(new Set(["exa", "parallel"]));
    expect(result.fallbackUsed).toBe(true);
    expect(result.providers).toEqual([providers[1]]);
  });

  it("normalizes Parallel's structured MCP result without treating excerpt links as extra sources", async () => {
    const adapter = new WebResearchAdapter(
      hostWith({
        webSearch: vi.fn(async (input) => ({
          provider: input.provider,
          text: JSON.stringify({
            results: [
              {
                title: "权威页面",
                url: "https://example.com/official",
                publish_date: "2026-08-28",
                excerpts: [
                  "核心摘要，另见 [背景链接](https://noise.example/link)。",
                ],
              },
            ],
          }),
          coverage: "structured provider",
        })),
        publicSearch: vi.fn(async () => ({
          source: "duckduckgo" as const,
          coverage: "unused",
          results: [],
        })),
      }),
    );

    const result = await adapter.search({
      query: "权威页面",
      limit: 1,
      sessionId: "parallel-structured-session",
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        title: "权威页面",
        url: "https://example.com/official",
        publishedAt: "2026-08-28",
        excerpt: expect.stringContaining("核心摘要"),
      }),
    ]);
  });

  it("enforces the requested domain filter after provider normalization", async () => {
    const adapter = new WebResearchAdapter(
      hostWith({
        webSearch: vi.fn(async (input) => ({
          provider: input.provider,
          text: [
            "[不在范围内](https://unrelated.example/page)",
            "[目标来源](https://news.example.com/story)",
          ].join("\n\n"),
          coverage: "domain filter fixture",
        })),
        publicSearch: vi.fn(async () => ({
          source: "duckduckgo" as const,
          coverage: "unused",
          results: [],
        })),
      }),
    );

    const result = await adapter.search({
      query: "目标来源",
      limit: 1,
      domains: ["example.com"],
      sessionId: "domain-filter-session",
    });

    expect(result.results.map((item) => item.url)).toEqual([
      "https://news.example.com/story",
    ]);
  });

  it("uses DuckDuckGo, GDELT, and Wikimedia supplements and deduplicates URLs", async () => {
    const adapter = new WebResearchAdapter(
      hostWith({
        webSearch: vi.fn(async () => {
          throw new Error("offline");
        }),
        publicSearch: vi.fn(async ({ source }) => ({
          source,
          coverage: `${source} coverage`,
          results:
            source === "duckduckgo"
              ? [
                  {
                    title: "网页",
                    url: "https://example.com/shared",
                    excerpt: "摘要",
                  },
                ]
              : source === "gdelt"
                ? [
                    {
                      title: "重复新闻",
                      url: "https://example.com/shared",
                    },
                    {
                      title: "新闻",
                      url: "https://news.example.net/story",
                      publishedAt: "2026-08-29T00:00:00Z",
                    },
                  ]
                : [
                    {
                      title: "百科",
                      url: "https://zh.wikipedia.org/wiki/Drama",
                    },
                  ],
        })),
      }),
    );

    const result = await adapter.search({
      query: "公开资料",
      limit: 3,
      sessionId: "supplement-session",
    });

    expect(result.providers).toEqual(["duckduckgo", "gdelt", "wikimedia"]);
    expect(result.results.map((item) => item.url)).toEqual([
      "https://example.com/shared",
      "https://news.example.net/story",
      "https://zh.wikipedia.org/wiki/Drama",
    ]);
  });

  it("marks webpage content as untrusted and respects the per-read character cap", async () => {
    const readWebPage = vi.fn(async () => ({
      title: "Source",
      url: "https://example.com/source",
      content: "正文".repeat(1_000),
      contentType: "text/html; charset=utf-8",
      retrievedAt: "2026-08-29T00:00:00.000Z",
      truncated: false,
    }));
    const adapter = new WebResearchAdapter(hostWith({ readWebPage }));

    const page = await adapter.read({
      url: "https://example.com/source",
      maxCharacters: 1_500,
    });

    expect(page.content.startsWith("以下内容来自不可信的公开网页")).toBe(true);
    expect(page.content.length).toBe(1_500);
    expect(page.truncated).toBe(true);
    expect(readWebPage).toHaveBeenCalledWith({
      url: "https://example.com/source",
      maxCharacters: expect.any(Number),
    });
  });
});
