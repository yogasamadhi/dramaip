import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const sourcePath = join(import.meta.dir, "codex-sidecar.ts");
const repositoryRoot = join(import.meta.dir, "../../..");

test("Codex Host 只启动固定路径中的 App Server", async () => {
  const source = await readFile(sourcePath, "utf8");

  expect(source).toContain("spawn(\n    startCommand.binaryPath");
  expect(source).toContain('"app-server"');
  expect(source).toContain('"stdio://"');
  expect(source).toContain("env.CODEX_HOME = startCommand.codexHome");
  expect(source).toContain("cwd: startCommand.sessionRoot");
  expect(source).not.toMatch(/spawn\(\s*["']codex["']/);
  expect(source).not.toContain("{ ...process.env }");
  expect(source).not.toContain('env["PATH"]');
  expect(source).not.toContain("~/.codex");
});

test("Codex Host 固定只读、永不审批并关闭外部能力", async () => {
  const source = await readFile(sourcePath, "utf8");

  expect(source).toContain('approvalPolicy: "never"');
  expect(source).toContain('sandbox: "read-only"');
  expect(source).toContain('type: "readOnly"');
  expect(source).toContain('web_search: "disabled"');
  for (const feature of [
    "shell_tool",
    "unified_exec",
    "multi_agent",
    "apps",
    "remote_plugin",
    "skill_mcp_dependency_install",
  ]) {
    expect(source).toContain(`${feature}: false`);
  }
  expect(source).toContain('decision: "decline"');
  expect(source).toContain("DramaIP 只读 MCP");
  expect(source).toContain('bearer_token_env_var: "DRAMAIP_MCP_TOKEN"');
  expect(source).toContain('"item/reasoning/delta"');
  expect(source).toContain("hide_agent_reasoning=true");
  expect(source).toContain('cli_auth_credentials_store="file"');
  expect(source).toContain('mcp_oauth_credentials_store="file"');
  expect(source).not.toContain("keyring");
});

test("Codex 固定版本覆盖六个平台并绑定协议快照", async () => {
  const binaryLock = JSON.parse(
    await readFile(join(repositoryRoot, "vendor/codex.lock.json"), "utf8"),
  ) as {
    package: string;
    version: string;
    platforms: Record<string, { integrity?: string; binarySha256?: string }>;
  };
  const protocolLock = JSON.parse(
    await readFile(
      join(repositoryRoot, "vendor/codex.protocol.lock.json"),
      "utf8",
    ),
  ) as { package: string; version: string; files: Record<string, string> };

  expect(binaryLock).toMatchObject({
    package: "@openai/codex",
    version: "0.147.0",
  });
  expect(Object.keys(binaryLock.platforms)).toHaveLength(6);
  for (const target of Object.values(binaryLock.platforms)) {
    expect(target.integrity).toMatch(/^sha512-/);
    expect(target.binarySha256).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(protocolLock.package).toBe(binaryLock.package);
  expect(protocolLock.version).toBe(binaryLock.version);
  expect(Object.keys(protocolLock.files).length).toBeGreaterThan(100);
});
