import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
} from "react";

const FOLLOW_LATEST_TOLERANCE = 32;
const AUTO_SCROLL_TARGET_TOLERANCE = 2;

export function isAssistantTimelineAtLatest(metrics: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <=
    FOLLOW_LATEST_TOLERANCE
  );
}

export function isAssistantTimelineAutoScrollEvent(
  scrollTop: number,
  target: number | undefined,
): boolean {
  return (
    target !== undefined &&
    Math.abs(scrollTop - target) <= AUTO_SCROLL_TARGET_TOLERANCE
  );
}

export function useAssistantAutoScroll(
  contentVersion: unknown,
  resetKey?: unknown,
): {
  scrollRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  followLatest(): void;
} {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const previousResetKeyRef = useRef(resetKey);
  const frameRef = useRef<number | undefined>(undefined);
  const autoScrollTargetRef = useRef<number | undefined>(undefined);

  const onScroll = useCallback<UIEventHandler<HTMLDivElement>>((event) => {
    if (
      isAssistantTimelineAutoScrollEvent(
        event.currentTarget.scrollTop,
        autoScrollTargetRef.current,
      )
    ) {
      autoScrollTargetRef.current = undefined;
      followLatestRef.current = true;
      return;
    }
    autoScrollTargetRef.current = undefined;
    followLatestRef.current = isAssistantTimelineAtLatest(event.currentTarget);
  }, []);

  const scheduleLatest = useCallback(() => {
    if (!followLatestRef.current || frameRef.current !== undefined) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = undefined;
      const container = scrollRef.current;
      if (!container || !followLatestRef.current) return;
      const target = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
      autoScrollTargetRef.current = target;
      container.scrollTop = target;
    });
  }, []);

  const followLatest = useCallback(() => {
    followLatestRef.current = true;
    scheduleLatest();
  }, [scheduleLatest]);

  useLayoutEffect(() => {
    if (previousResetKeyRef.current !== resetKey) {
      previousResetKeyRef.current = resetKey;
      followLatestRef.current = true;
    }
    scheduleLatest();
  }, [contentVersion, resetKey, scheduleLatest]);

  useEffect(
    () => () => {
      if (frameRef.current !== undefined)
        window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const observer = new MutationObserver(() => scheduleLatest());
    observer.observe(container, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [scheduleLatest]);

  return { scrollRef, endRef, onScroll, followLatest };
}

const TOOL_LABELS: Record<string, string> = {
  dramaip_get_project: "读取项目资料",
  dramaip_get_chapter: "读取章节正文",
  dramaip_list_chapters: "读取章节目录",
  dramaip_list_characters: "读取人物资料",
  dramaip_search_story_bible: "检索故事圣经",
  dramaip_analyze_continuity: "检查故事连续性",
  dramaip_search_project: "检索项目资料",
  dramaip_get_adaptation: "读取改编方案",
  dramaip_list_episodes: "读取分集资料",
  dramaip_get_script: "读取剧本",
  dramaip_list_scenes: "读取场景资料",
  dramaip_list_shots: "读取分镜资料",
  dramaip_list_asset_metadata: "读取资产信息",
  dramaip_web_search: "搜索公开网络",
  dramaip_read_web_page: "读取公开网页",
};

const TOOL_PURPOSES: Record<string, string> = {
  dramaip_get_project: "核对项目定位、题材和创作约束",
  dramaip_get_chapter: "读取当前权威章节，避免基于过期正文回答",
  dramaip_list_chapters: "了解章节结构、顺序和当前写作进度",
  dramaip_list_characters: "核对人物身份、关系、目标和状态",
  dramaip_search_story_bible: "查找与当前问题有关的世界观和固定设定",
  dramaip_analyze_continuity: "检查人物、时间线和设定是否前后一致",
  dramaip_search_project: "在项目资料中定位与本轮要求有关的信息",
  dramaip_get_adaptation: "核对当前改编方案和生产约束",
  dramaip_list_episodes: "了解分集结构和各集状态",
  dramaip_get_script: "读取权威剧本内容",
  dramaip_list_scenes: "核对场景结构和上下文",
  dramaip_list_shots: "核对分镜安排和镜头信息",
  dramaip_list_asset_metadata: "确认已存在的项目资产及其状态",
  dramaip_web_search: "查找与当前问题有关的公开网页来源",
  dramaip_read_web_page: "读取并核实所选公开网页的正文",
};

export function assistantToolLabel(value?: string): string {
  if (!value) return "读取项目资料";
  return TOOL_LABELS[value] ?? "读取项目资料";
}

export function AssistantStageSummary(props: {
  items: Array<{
    id: string;
    type: string;
    status: string;
    content?: string;
  }>;
  active: boolean;
}) {
  const stages = props.items.filter(
    (item) => item.type === "stage" && item.content,
  );
  if (!stages.length) return null;
  const failed = stages.some((item) => item.status === "failed");
  return (
    <section
      className="rounded-lg border border-line bg-surface-muted/60 px-3 py-2 text-xs text-muted"
      aria-label="AI 工作过程"
    >
      <p className="font-medium text-ink">
        {failed ? "工作过程 · 处理失败" : "工作过程"}
      </p>
      <div className="mt-2 space-y-1.5 border-l border-line pl-3">
        {stages.map((stage) => (
          <p key={stage.id} className="flex items-start gap-2">
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${stage.status === "failed" ? "bg-danger" : props.active && stage.id === stages.at(-1)?.id ? "animate-pulse bg-brand" : "bg-line-strong"}`}
            />
            <span>{stage.content}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

export function AssistantToolActivity(props: {
  item: {
    status: string;
    content?: string;
    payload?: unknown;
  };
}) {
  const tool = props.item.content ?? "";
  const payload =
    props.item.payload &&
    typeof props.item.payload === "object" &&
    !Array.isArray(props.item.payload)
      ? (props.item.payload as Record<string, unknown>)
      : undefined;
  const completed = props.item.status === "completed";
  const failed = props.item.status === "failed";
  const isWebTool =
    tool === "dramaip_web_search" || tool === "dramaip_read_web_page";
  const result = recordValue(payload?.result);
  const resultCount = Array.isArray(result?.results)
    ? result.results.length
    : undefined;
  const expandByDefault = !isWebTool || (!completed && !failed);
  return (
    <details
      open={expandByDefault}
      className="rounded-lg border border-line bg-surface-muted/70 px-3 py-2 text-xs"
    >
      <summary className="cursor-pointer font-medium text-ink">
        {completed ? "✓" : failed ? "!" : "●"} {assistantToolLabel(tool)}
      </summary>
      <div className="mt-2 space-y-2 border-l border-line pl-3 text-muted">
        <p>
          <span className="font-medium text-ink">调用目的：</span>
          {TOOL_PURPOSES[tool] ?? "获取完成本轮任务所需的权威只读资料"}
        </p>
        <p>
          <span className="font-medium text-ink">工具：</span>
          {tool || "DramaIP 只读工具"}
        </p>
        {isWebTool && !completed && !failed && (
          <p className="animate-pulse">
            {tool === "dramaip_web_search"
              ? "正在搜索公开网络…"
              : "正在读取网页…"}
          </p>
        )}
        {isWebTool && completed && (
          <p>
            {tool === "dramaip_web_search"
              ? `已找到 ${resultCount ?? 0} 条公开网页来源。`
              : "网页已安全读取，正文仅用于本次回答。"}
          </p>
        )}
        {isWebTool && failed && (
          <p className="text-danger">
            本次联网操作未完成；回答不应声称已经搜索或核实。
          </p>
        )}
        {!isWebTool && payload?.arguments !== undefined && (
          <ActivityValue label="输入" value={payload.arguments} />
        )}
        {!isWebTool && payload?.result !== undefined && (
          <ActivityValue label="结果摘要" value={payload.result} />
        )}
        {payload?.error !== undefined && (
          <p className="text-danger">
            <span className="font-medium">错误：</span>
            {String(payload.error)}
          </p>
        )}
        {!completed && !failed && payload?.result === undefined && (
          <p className="animate-pulse">正在等待工具返回…</p>
        )}
      </div>
    </details>
  );
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export type AssistantWebSource = {
  title: string;
  url: string;
  excerpt?: string;
  publishedAt?: string;
  retrievedAt?: string;
  provider?: string;
};

export function assistantWebSources(payload: unknown): AssistantWebSource[] {
  const wrapper = recordValue(payload);
  const result = recordValue(wrapper?.result);
  if (!Array.isArray(result?.results)) return [];
  return result.results.slice(0, 10).flatMap((value) => {
    const source = recordValue(value);
    if (
      typeof source?.title !== "string" ||
      typeof source.url !== "string" ||
      !source.url.startsWith("https://")
    )
      return [];
    return [
      {
        title: source.title,
        url: source.url,
        ...(typeof source.excerpt === "string"
          ? { excerpt: source.excerpt }
          : {}),
        ...(typeof source.publishedAt === "string"
          ? { publishedAt: source.publishedAt }
          : {}),
        ...(typeof source.retrievedAt === "string"
          ? { retrievedAt: source.retrievedAt }
          : {}),
        ...(typeof source.provider === "string"
          ? { provider: source.provider }
          : {}),
      },
    ];
  });
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "公开网页";
  }
}

function shortDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function AssistantWebSourceCards(props: {
  payload?: unknown;
  onOpen: (url: string) => void;
  verifiedUrls?: ReadonlySet<string>;
}) {
  const sources = assistantWebSources(props.payload);
  if (!sources.length) return null;
  return (
    <details
      className="group overflow-hidden rounded-xl border border-line bg-surface-muted/40"
      aria-label="公开网络来源"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 transition hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-medium text-ink">来源</span>
          <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-muted">
            {sources.length} 条
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          展开查看
          <span
            aria-hidden="true"
            className="transition-transform group-open:rotate-180"
          >
            ⌄
          </span>
        </span>
      </summary>
      <div className="grid gap-2 border-t border-line p-3 sm:grid-cols-2">
        {sources.map((source) => (
          <button
            key={`${source.provider ?? "web"}:${source.url}`}
            type="button"
            className="min-w-0 rounded-xl border border-line bg-surface-raised p-3 text-left transition hover:border-brand/50 hover:shadow-control"
            onClick={() => props.onOpen(source.url)}
          >
            <span className="block truncate text-xs font-medium text-brand-strong">
              {sourceDomain(source.url)}
              {source.provider ? ` · ${source.provider}` : ""}
            </span>
            <strong className="mt-1 block line-clamp-2 text-sm leading-5 text-ink">
              {source.title}
            </strong>
            {source.excerpt && (
              <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted">
                {source.excerpt}
              </span>
            )}
            <span className="mt-2 block text-xs text-muted">
              {props.verifiedUrls?.has(source.url)
                ? "已读取正文 · "
                : "仅搜索摘要 · "}
              {shortDate(source.publishedAt)
                ? `发布 ${shortDate(source.publishedAt)} · `
                : ""}
              检索 {shortDate(source.retrievedAt) ?? "刚刚"}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

export function AssistantWebAccessControl(props: {
  mode: "auto" | "off";
  disabled?: boolean;
  onChange: (mode: "auto" | "off") => void;
}) {
  const automatic = props.mode === "auto";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={automatic}
      disabled={props.disabled}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${automatic ? "border-brand/25 bg-brand-soft text-brand-strong" : "border-line bg-surface-muted text-muted"} disabled:cursor-not-allowed disabled:opacity-60`}
      onClick={() => props.onChange(automatic ? "off" : "auto")}
      title={
        props.disabled
          ? "本轮运行期间已锁定，完成后可修改"
          : automatic
            ? "由智能助手判断是否需要联网"
            : "本对话不会访问公开网络"
      }
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${automatic ? "bg-brand" : "bg-line-strong"}`}
      />
      联网搜索 · {automatic ? "自动" : "关闭"}
    </button>
  );
}

function ActivityValue(props: { label: string; value: unknown }) {
  const content =
    typeof props.value === "string"
      ? props.value
      : JSON.stringify(props.value, null, 2);
  return (
    <div>
      <p className="font-medium text-ink">{props.label}：</p>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-2 font-mono text-xs leading-5 text-muted">
        {content}
      </pre>
    </div>
  );
}

export function AssistantMessageContent(props: { content?: string }) {
  const content = props.content?.trim();
  if (!content) return null;
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith("```")) {
        code.push(lines[index]!);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre
          key={`code-${index}`}
          className="overflow-x-auto rounded-lg bg-studio-dark p-3 font-mono text-xs leading-5 text-white"
          data-language={language || undefined}
        >
          {code.join("\n")}
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(
        <p
          key={`heading-${index}`}
          className={
            level <= 2
              ? "pt-1 text-base font-semibold text-ink"
              : "pt-1 text-sm font-semibold text-ink"
          }
        >
          {inlineMarkdown(heading[2]!)}
        </p>,
      );
      index += 1;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={`rule-${index}`} className="border-line" />);
      index += 1;
      continue;
    }

    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      isTableDivider(lines[index + 1]!)
    ) {
      const header = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.includes("|")) {
        rows.push(tableCells(lines[index]!));
        index += 1;
      }
      blocks.push(
        <div
          key={`table-${index}`}
          className="overflow-x-auto rounded-lg border border-line"
        >
          <table className="w-full border-collapse text-left text-xs leading-5">
            <thead className="bg-surface-muted text-ink">
              <tr>
                {header.map((cell, cellIndex) => (
                  <th
                    key={cellIndex}
                    className="border-b border-line px-3 py-2 font-semibold"
                  >
                    {inlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="border-b border-line last:border-0"
                >
                  {header.map((_, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top">
                      {inlineMarkdown(row[cellIndex] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = /^\s*[-*+]\s+(.+)$/.exec(lines[index]!);
        if (!match) break;
        items.push(match[1]!);
        index += 1;
      }
      blocks.push(
        <ul key={`list-${index}`} className="ml-5 list-disc space-y-1">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = /^\s*\d+[.)]\s+(.+)$/.exec(lines[index]!);
        if (!match) break;
        items.push(match[1]!);
        index += 1;
      }
      blocks.push(
        <ol key={`ordered-${index}`} className="ml-5 list-decimal space-y-1">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) {
        quote.push(lines[index]!.replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={`quote-${index}`}
          className="border-l-2 border-brand pl-3 text-muted"
        >
          {inlineMarkdown(quote.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index]!.trim()) {
      const next = lines[index]!;
      if (startsMarkdownBlock(next, lines[index + 1])) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`} className="whitespace-pre-wrap">
        {inlineMarkdown(paragraph.join("\n"))}
      </p>,
    );
  }

  return <div className="space-y-3 break-words">{blocks}</div>;
}

function startsMarkdownBlock(line: string, next?: string): boolean {
  const value = line.trim();
  return (
    value.startsWith("```") ||
    /^#{1,4}\s+/.test(value) ||
    /^(?:-{3,}|\*{3,}|_{3,})$/.test(value) ||
    /^[-*+]\s+/.test(value) ||
    /^\d+[.)]\s+/.test(value) ||
    /^>\s?/.test(value) ||
    (line.includes("|") && Boolean(next && isTableDivider(next)))
  );
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function inlineMarkdown(value: string): ReactNode[] {
  const tokens = value.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g);
  return tokens.map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**"))
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("`") && token.endsWith("`"))
      return (
        <code
          key={index}
          className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    if (token.startsWith("*") && token.endsWith("*"))
      return <em key={index}>{token.slice(1, -1)}</em>;
    return <Fragment key={index}>{token}</Fragment>;
  });
}
