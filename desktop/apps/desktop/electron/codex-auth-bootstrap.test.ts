import { expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bootstrapCodexAuthentication,
  disableCodexAuthBootstrap,
} from "./codex-auth-bootstrap";

const AUTH = JSON.stringify({
  auth_mode: "chatgpt",
  tokens: { access_token: "test-access-token" },
});

test("只把现有 Codex 登录缓存导入隔离目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-codex-auth-"));
  try {
    const sourceHome = join(root, "source");
    const destinationHome = join(root, "destination");
    await mkdir(sourceHome);
    await writeFile(join(sourceHome, "auth.json"), AUTH, { mode: 0o600 });
    await writeFile(join(sourceHome, "config.toml"), "model = 'example'");

    expect(
      await bootstrapCodexAuthentication({ sourceHome, destinationHome }),
    ).toBe("imported");
    expect(await readFile(join(destinationHome, "auth.json"), "utf8")).toBe(
      AUTH,
    );
    if (process.platform !== "win32")
      expect(
        (await lstat(join(destinationHome, "auth.json"))).mode & 0o777,
      ).toBe(0o600);
    expect(await Bun.file(join(destinationHome, "config.toml")).exists()).toBe(
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("不会覆盖隔离目录已有的 Codex 登录", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-codex-auth-"));
  try {
    const sourceHome = join(root, "source");
    const destinationHome = join(root, "destination");
    await mkdir(sourceHome);
    await mkdir(destinationHome);
    await writeFile(join(sourceHome, "auth.json"), AUTH);
    await writeFile(
      join(destinationHome, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "existing-key" }),
    );

    expect(
      await bootstrapCodexAuthentication({ sourceHome, destinationHome }),
    ).toBe("already_configured");
    expect(
      await readFile(join(destinationHome, "auth.json"), "utf8"),
    ).toContain("existing-key");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("主动退出后不会在下次启动重新导入", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-codex-auth-"));
  try {
    const sourceHome = join(root, "source");
    const destinationHome = join(root, "destination");
    await mkdir(sourceHome);
    await writeFile(join(sourceHome, "auth.json"), AUTH);
    await disableCodexAuthBootstrap(destinationHome);

    expect(
      await bootstrapCodexAuthentication({ sourceHome, destinationHome }),
    ).toBe("disabled");
    expect(await Bun.file(join(destinationHome, "auth.json")).exists()).toBe(
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("拒绝符号链接和无效的认证文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-codex-auth-"));
  try {
    const target = join(root, "target.json");
    const sourceHome = join(root, "source");
    await mkdir(sourceHome);
    if (process.platform !== "win32") {
      await writeFile(target, AUTH);
      await symlink(target, join(sourceHome, "auth.json"));
      expect(
        await bootstrapCodexAuthentication({
          sourceHome,
          destinationHome: join(root, "destination-one"),
        }),
      ).toBe("source_invalid");
      await rm(join(sourceHome, "auth.json"));
    }
    await writeFile(join(sourceHome, "auth.json"), "{}");
    await chmod(join(sourceHome, "auth.json"), 0o600);
    expect(
      await bootstrapCodexAuthentication({
        sourceHome,
        destinationHome: join(root, "destination-two"),
      }),
    ).toBe("source_invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
