import { expect, test } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyElectronPreferences } from "./profile-storage";

test("迁入配置目录时保留界面偏好、跳过锁和系统加密状态且不覆盖新数据", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-electron-preferences-"));
  const previous = join(root, "previous");
  const directory = join(root, ".dramaip", "desktop", "electron");
  try {
    await mkdir(join(previous, "Local Storage"), { recursive: true });
    await writeFile(
      join(previous, "Local Storage", "preferences"),
      "saved-editor-layout",
    );
    await writeFile(join(previous, "Local Storage", "LOCK"), "old-lock");
    await writeFile(join(previous, "Preferences"), "saved-ui-preferences");
    await writeFile(join(previous, "Local State"), "old-os-encrypted-state");
    copyElectronPreferences(previous, directory);
    expect(
      await readFile(join(directory, "Local Storage", "preferences"), "utf8"),
    ).toBe("saved-editor-layout");
    expect(await readdir(join(directory, "Local Storage"))).not.toContain(
      "LOCK",
    );
    expect(await readdir(directory)).not.toContain("Local State");
    await writeFile(join(directory, "Preferences"), "new-preferences");
    copyElectronPreferences(previous, directory);
    expect(await readFile(join(directory, "Preferences"), "utf8")).toBe(
      "new-preferences",
    );
    expect(await readFile(join(previous, "Preferences"), "utf8")).toBe(
      "saved-ui-preferences",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
