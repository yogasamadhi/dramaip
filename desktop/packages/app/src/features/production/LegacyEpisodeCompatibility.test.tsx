import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LegacyEpisodeCompatibility } from "./LegacyEpisodeCompatibility";

test("旧 episode 默认折叠，显式恢复才展开，不移除原候选子节点", () => {
  for (const explicit of [false, true]) {
    const html = renderToStaticMarkup(
      <LegacyEpisodeCompatibility explicit={explicit}>
        <article data-workflow-id="original">旧候选</article>
      </LegacyEpisodeCompatibility>,
    );
    expect(html.includes('open=""')).toBe(explicit);
    expect(html).toContain('data-workflow-id="original"');
    expect(html).toContain("旧 episode 兼容路径");
    expect(html).toContain("展开不会调用模型或迁移记录");
  }
});
