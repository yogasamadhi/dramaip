// @vitest-environment jsdom
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContextPicker,
  type ContextPickerViewProps,
} from "../src/client/context/ContextPicker.tsx";
import { zh } from "../src/client/context/locale.ts";
import {
  narrativeStoryConnection,
  narrativeStoryDirectory,
  narrativeStoryScopeReasons,
  narrativeStoryVisibleEntries,
} from "../src/client/context/story.ts";
import { StorySources } from "../src/client/context/StorySources.tsx";
import type {
  Chapter,
  NarrativeContextRequest,
  NarrativeStoryIndexEntry,
} from "../src/client/context/types.ts";

afterEach(cleanup);

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"narrative">;

const ok = (value: unknown) => Promise.resolve({ ok: true, value });
const failed = (message: string) =>
  Promise.resolve({ ok: false, error: { code: "test", message } });
const PROJECT = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const FORMAT = "narrative-context-v1";

const chapter = (index: number, content = `第${index}章正文`) =>
  ({
    id: `2000000${index}-0000-4000-8000-000000000001`,
    projectId: PROJECT,
    title: `第${index}章`,
    orderIndex: index,
    content,
    version: index,
  }) as unknown as Chapter;
const CHAPTERS = [chapter(1), chapter(2), chapter(3)];

function entry(
  overrides: Partial<NarrativeStoryIndexEntry> = {},
): NarrativeStoryIndexEntry {
  return {
    projectId: PROJECT,
    selection: { kind: "declaration", id: "decl-1", version: 1 },
    title: "主角",
    statement: "主角在雨夜归来。",
    classification: "character",
    status: "adopted",
    sourceFingerprint: "fp-1",
    sourceState: "current",
    interpretation: "author-declared",
    eligibility: { state: "eligible", reasons: [] },
    sourceChapters: [{ id: CHAPTERS[0]!.id, version: 1 }],
    sourceScripts: [],
    endpoints: [],
    ...overrides,
  } as unknown as NarrativeStoryIndexEntry;
}

function knowledge(overrides: Record<string, unknown> = {}) {
  return {
    narrativeSummariesScopes: vi.fn(() =>
      ok({ projectId: PROJECT, scopes: [], unavailable: [] }),
    ),
    narrativeSummariesGet: vi.fn(),
    narrativeIndexChapter: vi.fn((projectId: string, chapterId: string) => {
      const found = CHAPTERS.find((item) => item.id === chapterId)!;
      return ok({
        projectId,
        chapter: { id: found.id, version: found.version },
        paragraphs: [{ id: `${found.id}:p1`, start: 0, end: 2 }],
        summaries: [
          { id: `sum-${found.orderIndex}`, version: 1, text: "摘要" },
        ],
      });
    }),
    narrativeStoryIndexCatalog: vi.fn(() =>
      ok({ projectId: PROJECT, fingerprint: "dir-1", entries: [] }),
    ),
    ...overrides,
  };
}

function mount(
  props: Omit<Partial<ContextPickerViewProps>, "knowledge"> & {
    knowledge?: ReturnType<typeof knowledge>;
  } = {},
) {
  const onChange = vi.fn();
  const remote = props.knowledge ?? knowledge();
  const all = {
    t,
    chapters: CHAPTERS,
    request: { format: FORMAT, chapters: [] } as NarrativeContextRequest,
    disabled: false,
    target: CHAPTERS[2]!,
    onChange,
    ...props,
    knowledge: remote,
  } as unknown as ContextPickerViewProps;
  const view = render(<ContextPicker {...all} />);
  const open = () =>
    act(() => {
      const details = view.container.querySelector("details")!;
      details.open = true;
      fireEvent(details, new Event("toggle"));
    });
  return { onChange, remote, open, view };
}

describe("the narrative context picker", () => {
  it("offers only the chapters before the target and includes none by default", () => {
    const { open } = mount();
    expect(screen.getByText(/本轮前文来源 · 明确选择 0 章/)).toBeTruthy();
    open();
    expect(screen.getByRole("group", { name: "前文来源 第1章" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "前文来源 第2章" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "前文来源 第3章" })).toBeNull();
    expect(screen.getByText(/当前前文 2 章，未选 2 章/)).toBeTruthy();
  });

  it("includes the target itself for a continuation", () => {
    const { open } = mount({ includeTarget: true });
    open();
    expect(screen.getByRole("group", { name: "前文来源 第3章" })).toBeTruthy();
  });

  it("emits the chosen full text, keeping chapter order and other choices", () => {
    const request = {
      format: FORMAT,
      chapters: [
        { id: CHAPTERS[1]!.id, version: 2, representation: "original" },
      ],
    } as NarrativeContextRequest;
    const { open, onChange } = mount({ request });
    open();
    fireEvent.change(screen.getByLabelText("前文表达 第1章"), {
      target: { value: "original" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      format: FORMAT,
      chapters: [
        { id: CHAPTERS[0]!.id, version: 1, representation: "original" },
        { id: CHAPTERS[1]!.id, version: 2, representation: "original" },
      ],
    });
  });

  it("reads a chapter's index before offering its summaries and paragraphs", async () => {
    const { open, remote, onChange } = mount();
    open();
    const select = screen.getByLabelText("前文表达 第1章") as HTMLSelectElement;
    expect(
      [...select.options].find((option) => option.value === "paragraphs")!
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getAllByText("读取此章摘要和段落")[0]!);
    await waitFor(() =>
      expect(screen.getByText("已采用摘要 · 摘要")).toBeTruthy(),
    );
    expect(remote.narrativeIndexChapter).toHaveBeenCalledWith(
      PROJECT,
      CHAPTERS[0]!.id,
    );
    fireEvent.change(select, { target: { value: "summary:sum-1" } });
    expect(onChange).toHaveBeenLastCalledWith({
      format: FORMAT,
      chapters: [
        {
          id: CHAPTERS[0]!.id,
          version: 1,
          representation: "summary",
          record: { id: "sum-1", version: 1 },
        },
      ],
    });
  });

  it("flags a chosen chapter version that is no longer current", () => {
    const request = {
      format: FORMAT,
      chapters: [
        { id: CHAPTERS[0]!.id, version: 0, representation: "original" },
      ],
    } as NarrativeContextRequest;
    const { open } = mount({ request });
    open();
    expect(screen.getByText("选择已失效，请清除后明确重新选择。")).toBeTruthy();
  });

  it("requires a paragraph before a paragraph choice can generate", async () => {
    const request = {
      format: FORMAT,
      chapters: [
        {
          id: CHAPTERS[0]!.id,
          version: 1,
          representation: "paragraphs",
          paragraphIds: [],
        },
      ],
    } as NarrativeContextRequest;
    const { open, onChange } = mount({ request });
    open();
    expect(
      screen.getByText("至少明确选择一个原文段落后才能生成。"),
    ).toBeTruthy();
    const paragraph = await screen.findByLabelText("上下文段落 第1章 0");
    fireEvent.click(paragraph);
    expect(onChange).toHaveBeenLastCalledWith({
      format: FORMAT,
      chapters: [
        {
          id: CHAPTERS[0]!.id,
          version: 1,
          representation: "paragraphs",
          paragraphIds: [`${CHAPTERS[0]!.id}:p1`],
        },
      ],
    });
  });

  it("offers an adopted higher summary only when it covers prior chapters", async () => {
    const summary = (covered: Chapter[]) => ({
      id: "head-1",
      projectId: PROJECT,
      version: 4,
      sourceState: "current",
      contextEligibility: { state: "eligible", reasons: [] },
      content: {
        summary: "第一卷摘要",
        coveredChapters: covered.map(({ id, version }) => ({ id, version })),
      },
    });
    const remote = knowledge({
      narrativeSummariesScopes: vi.fn(() =>
        ok({
          projectId: PROJECT,
          unavailable: [],
          scopes: [
            { title: "第一卷", head: { id: "head-1", version: 4 } },
            { title: "未采用", head: null },
          ],
        }),
      ),
      narrativeSummariesGet: vi
        .fn()
        .mockReturnValueOnce(ok(summary(CHAPTERS.slice(0, 2))))
        .mockReturnValue(ok(summary(CHAPTERS))),
    });
    const { open, onChange, view } = mount({ knowledge: remote });
    open();
    fireEvent.click(screen.getByText("读取卷／故事弧／全书采用头"));
    await screen.findByRole("group", { name: "高层摘要来源 第一卷" });
    expect(
      screen.queryByRole("group", { name: "高层摘要来源 未采用" }),
    ).toBeNull();
    fireEvent.click(screen.getByText("读取此摘要的冻结范围"));
    const include = (await screen.findByLabelText(
      "纳入高层摘要 head-1",
    )) as HTMLInputElement;
    await waitFor(() => expect(include.disabled).toBe(false));
    fireEvent.click(include);
    expect(onChange).toHaveBeenLastCalledWith({
      format: FORMAT,
      chapters: [],
      summaries: [{ id: "head-1", version: 4 }],
    });
    // A summary that also covers the target cannot be cut down to prior text.
    fireEvent.click(screen.getByText("读取此摘要的冻结范围"));
    await screen.findByText("含当前章、后文或旧版本，不能拆掉部分摘要使用。");
    expect(include.disabled).toBe(true);
    view.unmount();
  });

  it("shows a failed summary directory read instead of an empty one", async () => {
    const remote = knowledge({
      narrativeSummariesScopes: vi.fn(() => failed("目录不可用")),
    });
    const { open } = mount({ knowledge: remote });
    open();
    fireEvent.click(screen.getByText("读取卷／故事弧／全书采用头"));
    await screen.findByText("高层摘要未核全：目录不可用");
    expect(screen.queryByText(/没有实际采用摘要/)).toBeNull();
  });

  it("asks for an explicit range when a scoped picker has no chapters", () => {
    mount({
      target: undefined,
      scope: { projectId: PROJECT, title: "制作范围" },
      purpose: "production",
      chapters: [],
    } as never);
    expect(
      screen.getByText(/请先明确选择制作范围，不自动补入原文或摘要/),
    ).toBeTruthy();
  });
});

describe("the narrative story sources", () => {
  function mountSources(
    catalog: unknown,
    selected: NarrativeContextRequest["story"] = [],
  ) {
    const onChange = vi.fn();
    const remote = knowledge({
      narrativeStoryIndexCatalog: vi.fn(() => catalog),
    });
    render(
      <StorySources
        t={t}
        knowledge={remote as never}
        projectId={PROJECT}
        chapters={CHAPTERS.slice(0, 2)}
        selected={selected ?? []}
        disabled={false}
        onChange={onChange}
      />,
    );
    return { onChange, remote };
  }

  it("refuses a catalog whose project does not check out", async () => {
    mountSources(
      ok({
        projectId: PROJECT,
        fingerprint: "dir",
        entries: [entry({ projectId: OTHER } as never)],
      }),
    );
    fireEvent.click(screen.getByText("读取人物／因果／认知来源目录"));
    await screen.findByText(/叙事索引项目或身份不符/);
    expect(screen.queryByText("主角在雨夜归来。")).toBeNull();
  });

  it("selects an eligible declaration and blocks one outside the range", async () => {
    const outside = entry({
      selection: { kind: "declaration", id: "decl-2", version: 1 },
      title: "反派",
      statement: "反派出现在第三章。",
      sourceChapters: [{ id: CHAPTERS[2]!.id, version: 3 }],
    } as never);
    const { onChange } = mountSources(
      ok({
        projectId: PROJECT,
        fingerprint: "dir",
        entries: [entry(), outside],
      }),
    );
    fireEvent.click(screen.getByText("读取人物／因果／认知来源目录"));
    const included = (await screen.findByLabelText(
      "纳入叙事声明 decl-1",
    )) as HTMLInputElement;
    await waitFor(() => expect(included.disabled).toBe(false));
    expect(
      (screen.getByLabelText("纳入叙事声明 decl-2") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(zh["story.reason.scope"])).toBeTruthy();
    fireEvent.click(included);
    expect(onChange).toHaveBeenLastCalledWith([
      { kind: "declaration", id: "decl-1", version: 1 },
    ]);
  });

  it("keeps a stale or missing choice visible instead of swapping it", async () => {
    mountSources(
      ok({
        projectId: PROJECT,
        fingerprint: "dir",
        entries: [
          entry({
            selection: { kind: "declaration", id: "decl-1", version: 2 },
          } as never),
        ],
      }),
      [
        { kind: "declaration", id: "decl-1", version: 1 },
        { kind: "assertion", id: "gone", version: 3 },
      ],
    );
    await screen.findByText(
      "原选择 v1 已失效，未自动改为 v2；请移除后重新选择。",
    );
    expect(
      screen.getByText("原所选 assertion gone v3 当前未核对；未切换最近声明。"),
    ).toBeTruthy();
  });
});

describe("the story index helpers", () => {
  it("lists every reason a declaration cannot enter the round", () => {
    const reasons = narrativeStoryScopeReasons(
      t,
      entry({
        projectId: OTHER,
        sourceScripts: [{ id: "script", version: 1 }],
        sourceChapters: [],
      } as never),
      PROJECT,
      CHAPTERS,
    );
    expect(reasons).toEqual([
      zh["story.reason.project"],
      zh["story.reason.script"],
      zh["story.reason.noChapter"],
    ]);
  });

  it("filters by a current story arc and orders cognition by declared order", () => {
    const directory = narrativeStoryDirectory({
      state: "available",
      chapters: CHAPTERS.map(({ id, version, title }) => ({
        id,
        version,
        title,
      })),
      groups: [
        {
          id: "arc",
          version: 1,
          kind: "story-arc",
          title: "雨夜",
          chapterIds: [CHAPTERS[0]!.id],
          state: "current",
          reasons: [],
        },
      ],
    } as never);
    const cognition = (id: string, storyOrder: number) =>
      entry({
        selection: { kind: "assertion", id, version: 1 },
        classification: "cognition",
        storyOrder,
      } as never);
    const later = entry({
      selection: { kind: "declaration", id: "later", version: 1 },
      sourceChapters: [{ id: CHAPTERS[1]!.id, version: 2 }],
    } as never);
    const all = [cognition("b", 2), cognition("a", 5), later];
    expect(
      narrativeStoryVisibleEntries(all, directory, {
        groupKey: "story-arc:arc",
        view: "cognition",
      }).map((item) => item.selection.id),
    ).toEqual(["b", "a"]);
    expect(
      narrativeStoryVisibleEntries(all, directory, { view: "nodes" }).map(
        (item) => item.selection.id,
      ),
    ).toEqual(["later"]);
  });

  it("describes a relationship's direction with its actual endpoints", () => {
    expect(
      narrativeStoryConnection(
        t,
        entry({
          classification: "relationship",
          relation: "causes",
          endpoints: [{ id: "n1", version: 1, title: "雨夜" }],
          relationshipEndpoints: {
            from: { id: "n1", version: 1 },
            to: { id: "n2", version: 1 },
          },
        } as never),
      ),
    ).toBe("雨夜 v1（n1） → 导致 → 原端点暂未核全");
  });
});
