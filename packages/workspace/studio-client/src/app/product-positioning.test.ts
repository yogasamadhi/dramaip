import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";

test("应用与安装包元数据使用当前定位，保留品牌和版本契约", async () => {
  const root = JSON.parse(
    await readFile(
      new URL("../../../../../package.json", import.meta.url),
      "utf8",
    ),
  );
  const desktop = JSON.parse(
    await readFile(
      new URL("../../../../../apps/desktop/package.json", import.meta.url),
      "utf8",
    ),
  );
  const category = "面向 AI 短剧与漫剧的本地优先 AI 编剧与 IP 改编工作台";
  expect(root.description).toBe(`尽意 DramaIP——${category}`);
  expect(desktop.description).toBe(root.description);
  expect(desktop.version).toBe(root.version);
  const builder = await readFile(
    new URL(
      "../../../../../apps/desktop/electron-builder.yml",
      import.meta.url,
    ),
    "utf8",
  );
  // 安装包、可执行文件与系统界面只显示英文名称。
  const productName = builder.match(/^productName: (.+)$/mu)?.[1];
  expect(productName).toBe("DramaIP");
  expect(productName).toMatch(/^[\x20-\x7e]+$/u);
  // 运行时显示名必须与打包名称一致，否则菜单与关于面板会退回包名。
  const application = await readFile(
    new URL(
      "../../../../../apps/desktop/electron/shell/application.ts",
      import.meta.url,
    ),
    "utf8",
  );
  expect(application).toContain(`app.setName("${productName}")`);
  expect(builder).not.toContain("v2 release gate");
});
