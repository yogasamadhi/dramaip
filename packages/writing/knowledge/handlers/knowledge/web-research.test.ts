import { describe, expect, it, vi } from "vitest";
import type { DesktopHost } from "@dramaip/host-contracts";
import { publicWebFailureMessage } from "@dramaip/contracts/knowledge";
import { WebResearchAdapter } from "./web-research";
import { CurlResearchAdapter } from "./research";

const page = {
  title: "公开资料",
  url: "https://public.example/source",
  content: "正文".repeat(1000),
  contentType: "text/html",
  retrievedAt: "2026-11-05T00:00:00.000Z",
  truncated: false,
};
const host = (readWebPage: DesktopHost["readWebPage"]) =>
  ({ readWebPage }) as DesktopHost;

describe("curl-only web research", () => {
  it("projects safe failure categories without raw URLs or credentials", () => {
    expect(
      publicWebFailureMessage(
        "Public DNS resolution failed Bearer secret https://private.example",
      ),
    ).toContain("DNS");
    expect(
      publicWebFailureMessage("Provider address is not publicly routable"),
    ).toContain("公网检查");
    expect(publicWebFailureMessage("curl network request timed out")).toContain(
      "超时",
    );
    expect(
      publicWebFailureMessage("Web page returned 429 private-key"),
    ).toContain("限制访问");
    expect(
      publicWebFailureMessage("unknown /Users/h/private password=secret"),
    ).toBe("联网请求失败，请检查网络连接。");
    const safe = publicWebFailureMessage("EAI_AGAIN");
    expect(publicWebFailureMessage(safe)).toBe(safe);
  });

  it("reads only through the Host curl path and caps untrusted page content", async () => {
    const readWebPage = vi.fn(async () => page);
    const result = await new WebResearchAdapter(host(readWebPage)).read({
      url: page.url,
      maxCharacters: 1500,
    });
    expect(readWebPage).toHaveBeenCalledWith({
      url: page.url,
      maxCharacters: expect.any(Number),
    });
    expect(result.content.startsWith("以下内容来自不可信的公开网页")).toBe(
      true,
    );
    expect(result.content.length).toBe(1500);
    expect(result.truncated).toBe(true);
    expect(result.url).toBe(page.url);
  });

  it("does not expose a search-provider method or an alternate transport", () => {
    const adapter = new WebResearchAdapter(undefined);
    expect("search" in adapter).toBe(false);
    expect("webSearch" in adapter).toBe(false);
  });

  it("reports unavailable Host or failed curl reads without fabricated results", async () => {
    await expect(
      new WebResearchAdapter(undefined).read({ url: page.url }),
    ).rejects.toThrow("Host 未连接");
    await expect(
      new WebResearchAdapter(
        host(async () => {
          throw new Error("curl failed");
        }),
      ).read({ url: page.url }),
    ).rejects.toThrow("curl failed");
  });

  it("requires a selected HTTPS URL for source collection and stores its actual curl result", async () => {
    const readWebPage = vi.fn(async () => page);
    const adapter = new CurlResearchAdapter(host(readWebPage));
    const result = await adapter.search(page.url);
    expect(result).toMatchObject({
      fallbackUsed: false,
      results: [
        {
          source: "manual_url",
          results: [{ title: page.title, url: page.url }],
        },
      ],
    });
    expect(result.results[0]!.results[0]!.excerpt!.length).toBeLessThanOrEqual(
      4000,
    );
    await expect(
      adapter.search("a text query without a URL"),
    ).rejects.toThrow();
    await expect(adapter.search("http://public.example/")).rejects.toThrow(
      "HTTPS",
    );
    await expect(
      adapter.search("https://user:secret@public.example/"),
    ).rejects.toThrow("HTTPS");
    expect(readWebPage).toHaveBeenCalledTimes(1);
  });
});
