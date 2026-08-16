import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("DramaIP Pi adapter exposes only authenticated read-only MCP tools", async () => {
  const source = await readFile(
    join(
      import.meta.dir,
      "../../../apps/desktop/pi-adapter/dramaip-pi-runtime.ts",
    ),
    "utf8",
  );
  expect(source).toContain("authorization: `Bearer ${this.options.token}`");
  expect(source).toContain(
    'body: JSON.stringify({ jsonrpc: "2.0", id, method, params })',
  );
  expect(source).toContain("tools.map((tool) => mcpTool(tool, mcp))");
  expect(source).toContain("这些能力没有授权，也没有提供");
  expect(source).not.toContain('from "node:child_process"');
  expect(source).not.toContain('from "node:fs"');
  expect(source).not.toContain("BashTool");
  expect(source).not.toContain("WriteTool");
  expect(source).not.toContain("WebSearchTool");
});
