import { expect, test } from "bun:test";
import { authorizeMcpTool, enforceMcpResultLimit } from "./index";

const claims = {
  tokenId: "token-1",
  userId: "desktop-owner",
  projectId: "project-a",
  sessionId: "session-a",
  runId: "run-a",
  contextSnapshotId: "snapshot-a",
  tools: ["dramaip_get_project", "dramaip_get_chapter"] as const,
  expiresAt: 2_000,
  maxResultBytes: 100,
};

test("只读工具授权绑定项目、工具、运行时限和返回量", () => {
  expect(
    authorizeMcpTool({
      claims,
      tool: "dramaip_get_project",
      projectId: "project-a",
      now: 1_000,
    }).allowed,
  ).toBe(true);
  expect(
    authorizeMcpTool({
      claims,
      tool: "dramaip_get_project",
      projectId: "project-b",
      now: 1_000,
    }).allowed,
  ).toBe(false);
  expect(
    authorizeMcpTool({
      claims,
      tool: "dramaip_list_shots",
      projectId: "project-a",
      now: 1_000,
    }).allowed,
  ).toBe(false);
  expect(
    authorizeMcpTool({
      claims,
      tool: "dramaip_get_project",
      projectId: "project-a",
      now: 2_001,
    }).allowed,
  ).toBe(false);
  expect(enforceMcpResultLimit(claims, 101).allowed).toBe(false);
});
