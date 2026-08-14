import type { Page } from "playwright";

export async function openProjectTool(
  page: Page,
  tool: "导入内容" | "项目驾驶舱" | "试制计划" | "系列资料",
): Promise<void> {
  let navigation = page.getByRole("navigation", { name: "项目工具导航" });
  if ((await navigation.count()) === 0) {
    await page.getByRole("link", { name: "项目工具", exact: true }).click();
    navigation = page.getByRole("navigation", { name: "项目工具导航" });
  }
  await navigation.getByRole("link", { name: tool, exact: true }).click();
}

export async function openStoryBible(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Story Bible", exact: true }).click();
}
