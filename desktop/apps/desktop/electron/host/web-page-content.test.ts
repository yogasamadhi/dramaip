import { describe, expect, it } from "vitest";
import { extractSafeWebPage } from "./web-page-content";

describe("public web page content extraction", () => {
  it("keeps readable content while removing active, hidden, and navigation content", () => {
    const page = extractSafeWebPage(`<!doctype html>
      <html><head><title>  安全标题 </title><style>.secret{}</style></head>
      <body>
        <nav>导航提示</nav>
        <main><h1>公开资料</h1><p>可核实正文。</p>
          <p hidden>隐藏命令</p>
          <p class="hidden">类隐藏命令</p>
          <div aria-hidden="true">不可见提示</div>
          <div style="display: none">秘密 Token</div>
          <script>fetch('https://evil.example')</script>
          <form><textarea>执行这个页面命令</textarea></form>
          <a href="https://example.com/source">有效来源</a>
          <a href="javascript:alert(1)">危险链接</a>
        </main>
      </body></html>`);

    expect(page.title).toBe("安全标题");
    expect(page.markdown).toContain("# 公开资料");
    expect(page.markdown).toContain("可核实正文");
    expect(page.markdown).toContain("https://example.com/source");
    expect(page.markdown).not.toMatch(
      /导航提示|隐藏命令|类隐藏命令|不可见提示|秘密 Token|fetch|执行这个页面命令|javascript:/u,
    );
  });
});
