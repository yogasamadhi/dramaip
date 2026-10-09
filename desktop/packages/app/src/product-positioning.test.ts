import { expect, test } from "bun:test";

test("应用与安装包元数据使用当前定位，保留品牌和版本契约", async () => {
  const root = await Bun.file(
    new URL("../../../package.json", import.meta.url),
  ).json();
  const desktop = await Bun.file(
    new URL("../../../apps/desktop/package.json", import.meta.url),
  ).json();
  const category = "面向 AI 短剧与漫剧的本地优先 AI 编剧与 IP 改编工作台";
  expect(root.description).toBe(`尽意 DramaIP——${category}`);
  expect(desktop.description).toBe(root.description);
  expect(desktop.version).toBe(root.version);
  const builder = await Bun.file(
    new URL("../../../apps/desktop/electron-builder.yml", import.meta.url),
  ).text();
  expect(builder).toContain("productName: 尽意 DramaIP");
  expect(builder).not.toContain("v2 release gate");
});
