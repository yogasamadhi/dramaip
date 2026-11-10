import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("DramaIP Pi adapter exposes only authenticated read-only MCP tools", async () => {
  const source = await readFile(
    join(
      import.meta.dirname,
      "../../../apps/desktop/pi-adapter/dramaip-pi-runtime.ts",
    ),
    "utf8",
  );
  expect(source).toContain("Authorization: `Bearer ${options.mcp.token}`");
  expect(source).toContain("new McpClient(");
  expect(source).toContain("new StreamableHttpTransport(");
  expect(source).not.toContain("class DramaIpMcpClient");
  expect(source).toContain("tools.map((tool) => mcpTool(tool, mcp))");
  expect(source).toContain('status: event.isError ? "failed" : "completed"');
  expect(source).toContain(": { result: event.result }");
  expect(source).toContain("这些能力没有授权，也没有提供");
  expect(source).not.toContain('from "node:child_process"');
  expect(source).not.toContain('from "node:fs"');
  expect(source).not.toContain("BashTool");
  expect(source).not.toContain("WriteTool");
  expect(source).not.toContain("WebSearchTool");
});
