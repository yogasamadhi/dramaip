// @vitest-environment jsdom
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackupSection,
  type BackupSectionProps,
} from "../src/client/BackupSection.tsx";

afterEach(cleanup);

/** Copy with its key and parameters visible, so assertions name the key. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params
    ? `${key}(${JSON.stringify(params)})`
    : key) as unknown as TranslateNS<"workspace">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = (message: string) =>
  Promise.resolve({
    ok: false as const,
    error: { code: "compat/problem", message },
  });

const backup = {
  id: "backup-1",
  name: "dramaip-2026-10-30.sqlite",
  size: 2048,
  createdAt: "2026-10-30T08:00:00.000Z",
};

function bench(list: unknown = [backup]) {
  const workspace = {
    backupsList: vi.fn(() => ok(list)),
    backupsCreate: vi.fn(() => ok(backup)),
    backupsRestore: vi.fn(() => ok(backup)),
  };
  const reload = vi.fn();
  render(
    <BackupSection
      {...({ workspace, reload, t } as unknown as BackupSectionProps)}
    />,
  );
  return { workspace, reload };
}

describe("backup settings section", () => {
  it("lists the backups with their size", async () => {
    bench();
    expect(await screen.findByText(backup.name)).toBeTruthy();
    // The size nests inside the meta copy, so its quotes come escaped.
    expect(
      screen.getByText(/backup\.size\.kb\(\{\\"size\\":2\}\)/u),
    ).toBeTruthy();
  });

  it("creates a backup with a replay key and reads the list again", async () => {
    const { workspace } = bench([]);
    expect(await screen.findByText("backup.empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "backup.create" }));
    await waitFor(() => expect(workspace.backupsList).toHaveBeenCalledTimes(2));
    expect(workspace.backupsCreate).toHaveBeenCalledWith(
      undefined,
      expect.any(String),
    );
  });

  it("restores only after the confirmation, then reloads the app", async () => {
    const { workspace, reload } = bench();
    fireEvent.click(
      await screen.findByRole("button", { name: "backup.restore" }),
    );
    expect(workspace.backupsRestore).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "backup.confirm.restore" }),
    );
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(workspace.backupsRestore).toHaveBeenCalledWith(
      backup.id,
      undefined,
      expect.any(String),
    );
  });

  it("keeps the app when a restore fails, and says why", async () => {
    const { workspace, reload } = bench();
    workspace.backupsRestore.mockImplementation(
      () => failed("备份文件已损坏") as never,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "backup.restore" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "backup.confirm.restore" }),
    );
    expect(
      await screen.findByText('backup.failed({"message":"备份文件已损坏"})'),
    ).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });
});
