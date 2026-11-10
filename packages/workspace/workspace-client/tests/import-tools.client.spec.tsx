// @vitest-environment jsdom
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import type { SourceImportsCommitInput } from "@dramaip/workspace-workspace/types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zh } from "../src/client/locale.ts";
import { ImportReviewTool } from "../src/client/tools/ImportReviewTool.tsx";
import { ImportTool } from "../src/client/tools/ImportTool.tsx";
import type { ToolProps } from "../src/client/tools/PersonalTheaterTool.tsx";
import {
  canonicalRequestJSON,
  checkSourceImportRecovery,
  freezeSourceImportAttempt,
  isSourceImportAttempt,
  persistSourceImportAttempt,
  readSourceImportAttempt,
} from "../src/client/tools/source-import.ts";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"workspace">;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const PROJECT = "a47fa85e-0191-42fd-b89b-134cfbabbb09";
const IMPORT = "b47fa85e-0191-42fd-b89b-134cfbabbb09";

const input: SourceImportsCommitInput = {
  projectId: PROJECT,
  strategy: "append",
  rightsConfirmed: true,
  destructiveConfirmed: false,
  preview: {
    fileName: "原.md",
    sourceType: "markdown",
    contentKind: "novel",
    title: "原输入",
    charCount: 4,
    chapters: [
      {
        key: "original",
        title: "原章节",
        content: "私有正文",
        orderIndex: 0,
        wordCount: 4,
      },
    ],
    episodes: [],
    warnings: [],
  },
};

function props(remotes: Partial<ToolProps>, search = "") {
  const reload = vi.fn(() => Promise.resolve());
  const navigate = vi.fn();
  return {
    reload,
    navigate,
    props: {
      projectId: PROJECT,
      record: {},
      search,
      reload,
      navigate,
      t,
      renderFactorySlot: vi.fn(() => null),
      workspace: {},
      media: {},
      writing: {},
      knowledge: {},
      system: {},
      automation: {},
      ...remotes,
    } as unknown as ToolProps,
  };
}

describe("the frozen source import attempt", () => {
  it("freezes the original key and input before sending and keeps them on recovery", () => {
    const candidate = structuredClone(input);
    const first = freezeSourceImportAttempt(IMPORT, candidate);
    candidate.preview.chapters[0]!.content = "编辑的新内容";
    expect(first.input).toEqual(input);
    const second = freezeSourceImportAttempt(IMPORT, candidate, first);
    expect(second).toEqual(first);
    second.input.preview.chapters[0]!.title = "修改副本";
    expect(first.input.preview.chapters[0]!.title).toBe("原章节");
  });

  it("refuses a broken or foreign original and an input its owner refuses", () => {
    const attempt = freezeSourceImportAttempt(IMPORT, input);
    for (const old of [
      { ...attempt, input: undefined },
      { ...attempt, requestKey: "lost" },
      { ...attempt, importId: PROJECT },
    ])
      expect(() =>
        freezeSourceImportAttempt(IMPORT, input, old as typeof attempt),
      ).toThrow("foreign");
    expect(() =>
      freezeSourceImportAttempt(
        IMPORT,
        { ...input, projectId: IMPORT },
        attempt,
      ),
    ).toThrow("foreign");
    expect(isSourceImportAttempt({ ...attempt, grantId: PROJECT })).toBe(false);
    const refused: SourceImportsCommitInput[] = [
      { ...input, rightsConfirmed: false },
    ];
    for (const title of ["   ", "字".repeat(161)]) {
      const next = structuredClone(input);
      next.preview.chapters[0]!.title = title;
      refused.push(next);
    }
    const duplicate = structuredClone(input);
    duplicate.preview.chapters.push({
      ...duplicate.preview.chapters[0]!,
      orderIndex: 1,
    });
    refused.push(duplicate);
    const empty = structuredClone(input);
    empty.preview.chapters = [];
    refused.push(empty);
    const script = structuredClone(input);
    script.preview.contentKind = "script";
    script.preview.episodes = [
      {
        key: "episode",
        episodeNumber: 1,
        title: "原集",
        content: "原文",
        scenes: [{ title: "场".repeat(241) }],
      },
    ];
    refused.push(script);
    for (const next of refused)
      expect(() => freezeSourceImportAttempt(IMPORT, next)).toThrow("invalid");
  });

  it("binds a recovery to the exact original import, project and body", () => {
    const attempt = freezeSourceImportAttempt(IMPORT, input);
    const recovery = {
      importId: IMPORT,
      projectId: PROJECT,
      input,
      state: "pending" as const,
      createdAt: "2026-11-03T00:00:00.000Z",
    };
    expect(() => checkSourceImportRecovery(attempt, recovery)).not.toThrow();
    expect(() =>
      checkSourceImportRecovery(attempt, {
        ...recovery,
        input: { ...input, preview: { ...input.preview, title: "重拼" } },
      }),
    ).toThrow("mismatch");
    expect(() =>
      checkSourceImportRecovery(attempt, { ...recovery, importId: PROJECT }),
    ).toThrow("mismatch");
    expect(
      canonicalRequestJSON({ b: 1, a: undefined, c: [{ z: 1, y: 2 }] }),
    ).toBe('{"b":1,"c":[{"y":2,"z":1}]}');
  });

  it("keeps an unreadable stored attempt rather than dropping it", () => {
    expect(readSourceImportAttempt(PROJECT)).toBeUndefined();
    localStorage.setItem(`dramaip-source-import-attempt:${PROJECT}`, "{");
    expect(readSourceImportAttempt(PROJECT)).toBeNull();
  });
});

describe("the import tool", () => {
  it("previews a picked file, needs the rights declaration and commits under the frozen key", async () => {
    const workspace = {
      sourceImportsPreview: vi.fn(() =>
        ok({
          importId: IMPORT,
          preview: input.preview,
          duplicates: { chapters: ["原章节"], episodes: [] },
          expiresAt: "2026-11-04T00:00:00.000Z",
        }),
      ),
      sourceImportsCommit: vi.fn(() =>
        ok({
          createdChapters: 1,
          updatedChapters: 0,
          createdEpisodes: 0,
          createdScripts: 0,
          updatedScripts: 0,
          createdScenes: 0,
          checkpointCount: 1,
        }),
      ),
    };
    const system = {
      pickFiles: vi.fn(() => ok([{ grantId: "grant-1", name: "原.md" }])),
    };
    const {
      props: tool,
      reload,
      navigate,
    } = props({
      workspace: workspace as never,
      system: system as never,
    });
    window.location.hash = `#/projects/${PROJECT}/tools/import`;
    render(<ImportTool {...tool} />);
    fireEvent.click(screen.getByRole("button", { name: "选择文件并解析" }));
    expect(await screen.findByText("原.md")).toBeTruthy();
    expect(workspace.sourceImportsPreview).toHaveBeenCalledWith(
      { projectId: PROJECT, capabilityToken: "grant-1" },
      undefined,
      undefined,
    );
    expect(screen.getByText(/1 个同名章节/)).toBeTruthy();
    const commit = screen.getByRole("button", { name: "确认导入" });
    expect((commit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      screen.getByLabelText("我确认拥有此内容的使用权，或已经取得必要授权。"),
    );
    fireEvent.click(commit);
    expect(
      await screen.findByText("导入完成：新增 1 个章节、0 个剧本、0 个场景。"),
    ).toBeTruthy();
    const [importId, sent, ifMatch, key] = workspace.sourceImportsCommit.mock
      .calls[0] as unknown as [string, unknown, unknown, string];
    expect([importId, sent, ifMatch]).toEqual([IMPORT, input, undefined]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(readSourceImportAttempt(PROJECT)).toBeUndefined();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        `/projects/${PROJECT}/tools/review`,
      ),
    );
    expect(reload).toHaveBeenCalled();
  });

  it("recovers a frozen import the server already committed without sending it again", async () => {
    const attempt = freezeSourceImportAttempt(IMPORT, input);
    persistSourceImportAttempt(attempt);
    const workspace = {
      sourceImportsGetCommit: vi.fn(() =>
        ok({
          importId: IMPORT,
          projectId: PROJECT,
          input,
          state: "committed",
          createdAt: "2026-11-03T00:00:00.000Z",
          result: {
            createdChapters: 1,
            updatedChapters: 0,
            createdEpisodes: 0,
            createdScripts: 0,
            updatedScripts: 0,
            createdScenes: 0,
            checkpointCount: 1,
          },
        }),
      ),
      sourceImportsCommit: vi.fn(),
    };
    const { props: tool } = props({ workspace: workspace as never });
    render(<ImportTool {...tool} />);
    expect(
      await screen.findByText(
        "原导入已有持久成功回执；明确恢复后核验并收起，不重新写入内容。",
      ),
    ).toBeTruthy();
    expect(workspace.sourceImportsGetCommit).toHaveBeenCalledWith(IMPORT, {
      projectId: PROJECT,
      requestKey: attempt.requestKey,
    });
    expect(
      (screen.getByRole("button", { name: "重新选择" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("导入章节正文") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "恢复同一次导入" }));
    expect(
      await screen.findByText("导入完成：新增 1 个章节、0 个剧本、0 个场景。"),
    ).toBeTruthy();
    expect(workspace.sourceImportsCommit).not.toHaveBeenCalled();
    expect(readSourceImportAttempt(PROJECT)).toBeUndefined();
  });

  it("refuses a broken stored attempt instead of replacing it", async () => {
    localStorage.setItem(`dramaip-source-import-attempt:${PROJECT}`, "{");
    const { props: tool } = props({ workspace: {} as never });
    render(<ImportTool {...tool} />);
    expect(
      await screen.findByText(
        "原导入输入损坏或归属不符；保留原键，不换稿或创建替代导入。",
      ),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "选择文件并解析",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

function changeSet(overrides: Record<string, unknown> = {}) {
  const candidate = (id: string, type: string, title: string) => ({
    id,
    type,
    title,
    summary: `${title}说明`,
    confidence: 0.82,
    sourceRefs: [
      {
        sourceKey: "c1",
        chapterTitle: "第一章 雨夜来信",
        start: 0,
        end: 12,
        excerpt: "雨夜",
        sourceVersion: 1,
      },
    ],
    status: "draft",
  });
  return {
    id: "set-1",
    projectId: PROJECT,
    sourceFingerprint: "f",
    sourceTitle: "雨夜来信",
    status: "draft",
    summary: "两条候选",
    candidates: [
      candidate("c-1", "character", "林夏"),
      candidate("c-2", "scene", "旧码头"),
    ],
    createdAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("the import review tool", () => {
  it("adopts only the selected drafts after confirming, then offers the undo", async () => {
    let sets = [changeSet()];
    const workspace = {
      importExtractionsList: vi.fn(() => ok(sets)),
      importExtractionsAdopt: vi.fn(() => {
        sets = [changeSet({ status: "applied" })];
        return ok(sets[0]);
      }),
    };
    const { props: tool, reload } = props({ workspace: workspace as never });
    render(<ImportReviewTool {...tool} />);
    expect(await screen.findByText("人物")).toBeTruthy();
    expect(screen.getByText("场景")).toBeTruthy();
    expect(screen.getAllByText(/《第一章 雨夜来信》 0–12：雨夜/)).toHaveLength(
      2,
    );
    fireEvent.click(screen.getByLabelText("选择候选 旧码头"));
    fireEvent.click(screen.getByRole("button", { name: "采用已选项目" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/将采用 1 条已选 AI 草稿/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认" }));
    expect(
      await screen.findByText("已采用所选草稿，并保留可撤销记录。"),
    ).toBeTruthy();
    expect(workspace.importExtractionsAdopt).toHaveBeenCalledWith(
      "set-1",
      { candidateIds: ["c-1"] },
      undefined,
      undefined,
    );
    expect(
      await screen.findByRole("button", { name: "撤销采用" }),
    ).toBeTruthy();
    expect(reload).toHaveBeenCalled();
  });

  it("rejects one draft and edits another", async () => {
    const workspace = {
      importExtractionsList: vi.fn(() => ok([changeSet()])),
      importExtractionsUpdateCandidate: vi.fn(() => ok({})),
    };
    const { props: tool } = props({ workspace: workspace as never });
    render(<ImportReviewTool {...tool} />);
    await screen.findByText("林夏");
    fireEvent.click(screen.getAllByRole("button", { name: "不采用" })[0]!);
    expect(
      await screen.findByText("AI 草稿已保留为未采用，不会写入项目。"),
    ).toBeTruthy();
    expect(workspace.importExtractionsUpdateCandidate).toHaveBeenCalledWith(
      "set-1",
      "c-1",
      { status: "rejected" },
      undefined,
      undefined,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[1]!);
    fireEvent.change(screen.getByLabelText("草稿标题"), {
      target: { value: "新码头" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        workspace.importExtractionsUpdateCandidate,
      ).toHaveBeenLastCalledWith(
        "set-1",
        "c-2",
        { title: "新码头", summary: "旧码头说明" },
        undefined,
        undefined,
      ),
    );
  });

  it("shows only the requested change set and no other in its place", async () => {
    const workspace = {
      importExtractionsList: vi.fn(() => ok([changeSet()])),
    };
    const { props: tool } = props(
      { workspace: workspace as never },
      "?extractionId=other",
    );
    render(<ImportReviewTool {...tool} />);
    expect(
      await screen.findByText(
        "正在核对指定导入草稿；若已删除或不可用，不会打开其他 AI 草稿代替。",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("林夏")).toBeNull();
  });

  it("links to the import tool when there is nothing to review", async () => {
    const workspace = { importExtractionsList: vi.fn(() => ok([])) };
    const { props: tool } = props({ workspace: workspace as never });
    render(<ImportReviewTool {...tool} />);
    const link = await screen.findByRole("link", { name: "导入内容" });
    expect(link.getAttribute("href")).toBe(
      `#/projects/${PROJECT}/tools/import`,
    );
  });
});
