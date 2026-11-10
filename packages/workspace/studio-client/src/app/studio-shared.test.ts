import { expect, test } from "vitest";
import {
  PRODUCT_STATUS_LABELS,
  productStatusLabel,
  searchResultPath,
  workspaceStageStateLabel,
} from "./studio-shared";

test("专业阶段统一派生推荐、稍后和阻断文案", () => {
  expect(
    workspaceStageStateLabel({
      availability: "available",
      recommended: true,
    }),
  ).toBe("建议现在做");
  expect(
    workspaceStageStateLabel({
      availability: "available",
      recommended: false,
    }),
  ).toBe("可以稍后做");
  expect(
    workspaceStageStateLabel({ availability: "blocked", recommended: true }),
  ).toBe("需要先完成");
});

test("内部状态完整映射为中文产品状态且未知值不直出", () => {
  expect(PRODUCT_STATUS_LABELS).toMatchObject({
    "not-started": "尚未开始",
    preparing: "正在准备",
    pending: "等待用户确认",
    running: "进行中",
    completed: "已完成",
    "needs-input": "需要补充资料",
    failed: "执行失败",
    retryable: "可以重试",
  });
  expect(productStatusLabel("ready-for-review")).toBe("可以进入审核");
  expect(productStatusLabel("internal-future-state")).toBe("状态待确认");
});

test("搜索结果补齐项目、阶段与可推断的子级选择", () => {
  expect(searchResultPath("shots", "shot-1", "project-1")).toBe(
    "/adapt?stage=shots&projectId=project-1&shotId=shot-1",
  );
  expect(searchResultPath("delivery", "delivery-1", "project-1")).toBe(
    "/review?stage=delivery&projectId=project-1",
  );
});
