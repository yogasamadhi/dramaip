import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("DramaIP Hermes adapter exposes only per-run MCP and disables persistence", async () => {
  const source = await readFile(
    join(
      import.meta.dir,
      "../../../apps/desktop/hermes-adapter/dramaip_hermes_acp.py",
    ),
    "utf8",
  );
  expect(source).toContain('enabled_toolsets=["dramaip-runtime"]');
  expect(source).toContain(
    'state.agent.enabled_toolsets = ["dramaip-runtime", "mcp-dramaip"]',
  );
  expect(source).toContain('"hermes-acp"');
  expect(source).toContain("session_db=None");
  expect(source).toContain("skip_context_files=True");
  expect(source).toContain("skip_memory=True");
  expect(source).toContain("checkpoints_enabled=False");
  expect(source).toContain("def _get_db(self):\n        return None");
  expect(source).not.toContain('enabled_toolsets=["hermes-acp"]');
});
