// @vitest-environment jsdom
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordsDomain } from "../src/client/contract.ts";
import { zh } from "../src/client/locale.ts";
import { RecordsWorkspace } from "../src/client/records/RecordsWorkspace.tsx";

afterEach(cleanup);

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"workspace">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

function domain(overrides: Partial<RecordsDomain> = {}): RecordsDomain {
  return {
    id: "review",
    label: "审片",
    description: "汇集审片包。",
    titleLabel: "审片包名称",
    fields: [
      { key: "审片方式", label: "审片方式", kind: "text" },
      { key: "评论", label: "评论", kind: "multiline" },
      { key: "时长", label: "时长", kind: "number" },
    ],
    store: {
      list: vi.fn(() =>
        Promise.resolve([
          {
            id: "r1",
            title: "第一版",
            version: 3,
            payload: { 审片方式: "离线", 保留: "原值" },
          },
        ]),
      ),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      remove: vi.fn(() => Promise.resolve(undefined)),
    },
    ...overrides,
  };
}

function remotes() {
  return {
    workspace: {
      projectsList: vi.fn(() => ok([{ id: "p1", title: "项目一" }])),
    },
    system: {
      pickFiles: vi.fn(() =>
        ok([{ grantId: "g1", displayName: "封面.png", kind: "file" }]),
      ),
    },
  } as unknown as Parameters<typeof RecordsWorkspace>[0] & object;
}

describe("the records workspace", () => {
  it("lists a fixed project's records under their parent and edits one keeping the other payload", async () => {
    const review = domain();
    render(
      <RecordsWorkspace
        {...remotes()}
        t={t}
        title="合规与审片"
        domains={[review]}
        projectId="p1"
        parentId="e1"
        parentRequired
      />,
    );
    await screen.findByText("第一版");
    expect(review.store.list).toHaveBeenCalledWith({
      projectId: "p1",
      parentId: "e1",
    });
    expect(screen.getByText("合规与审片资料库")).toBeTruthy();
    expect(screen.getByText("版本 3")).toBeTruthy();
    expect(screen.queryByLabelText("所属项目")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("评论"), {
      target: { value: "节奏偏慢" },
    });
    fireEvent.change(screen.getByLabelText("时长"), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(review.store.update).toHaveBeenCalledWith("r1", {
        title: "第一版",
        payload: { 审片方式: "离线", 保留: "原值", 评论: "节奏偏慢", 时长: 90 },
        version: 3,
      }),
    );
    await waitFor(() => expect(review.store.list).toHaveBeenCalledTimes(2));
  });

  it("refuses a new record without its parent", async () => {
    const review = domain();
    render(
      <RecordsWorkspace
        {...remotes()}
        t={t}
        title="合规与审片"
        domains={[review]}
        projectId="p1"
        parentRequired
      />,
    );
    await screen.findByText("第一版");
    fireEvent.click(screen.getByRole("button", { name: "新建审片" }));
    fireEvent.change(screen.getByLabelText("审片包名称"), {
      target: { value: "第二版" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "请先选择上级条目。",
    );
    expect(review.store.create).not.toHaveBeenCalled();
  });

  it("offers the project choice and a file grant when neither is fixed", async () => {
    const assets = domain({ id: "assets", label: "素材", file: true });
    const remote = remotes();
    render(
      <RecordsWorkspace {...remote} t={t} title="媒体" domains={[assets]} />,
    );
    const project = await screen.findByLabelText("所属项目");
    await within(project).findByText("项目一");
    fireEvent.change(project, { target: { value: "p1" } });
    await waitFor(() =>
      expect(assets.store.list).toHaveBeenLastCalledWith({
        projectId: "p1",
        parentId: undefined,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "新建素材" }));
    fireEvent.click(screen.getByRole("button", { name: "选择本地文件" }));
    await screen.findByRole("button", { name: "已选择：封面.png" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(assets.store.create).toHaveBeenCalledWith({
        title: "封面.png",
        projectId: "p1",
        parentId: undefined,
        payload: { 审片方式: "", 评论: "", 时长: undefined },
        capabilityToken: "g1",
      }),
    );
  });

  it("deletes only after the confirmation and runs a domain's own actions", async () => {
    const run = vi.fn(() => Promise.resolve("字幕文件已导出。"));
    const review = domain({
      actions: () => [{ key: "srt", label: "导出字幕", row: true, run }],
    });
    render(
      <RecordsWorkspace
        {...remotes()}
        t={t}
        title="本地化与交付"
        domains={[review, domain({ id: "delivery", label: "交付" })]}
        projectId="p1"
      />,
    );
    await screen.findByText("第一版");
    expect(screen.getByRole("tab", { name: "交付" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "导出字幕" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "字幕文件已导出。",
    );
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("删除「第一版」吗？");
    expect(review.store.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(review.store.remove).toHaveBeenCalledWith("r1"));
  });
});
