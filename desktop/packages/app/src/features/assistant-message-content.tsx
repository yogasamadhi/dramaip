import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
} from "react";

const FOLLOW_LATEST_TOLERANCE = 8;

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

export function useAssistantAutoScroll(
  contentVersion: unknown,
  resetKey?: unknown,
): {
  scrollRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
} {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const previousResetKeyRef = useRef(resetKey);

  const onScroll = useCallback<UIEventHandler<HTMLDivElement>>((event) => {
    const end = endRef.current;
    if (end) {
      const containerBounds = event.currentTarget.getBoundingClientRect();
      const endBounds = end.getBoundingClientRect();
      followLatestRef.current =
        Math.abs(endBounds.bottom - containerBounds.bottom) <=
        FOLLOW_LATEST_TOLERANCE;
      return;
    }
    followLatestRef.current = isAssistantTimelineAtLatest(event.currentTarget);
  }, []);

  useLayoutEffect(() => {
    if (previousResetKeyRef.current !== resetKey) {
      previousResetKeyRef.current = resetKey;
      followLatestRef.current = true;
    }
    if (!followLatestRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container || !followLatestRef.current) return;
      const end = endRef.current;
      if (end) {
        const containerBounds = container.getBoundingClientRect();
        const endBounds = end.getBoundingClientRect();
        container.scrollTop += endBounds.bottom - containerBounds.bottom;
      } else {
        container.scrollTop = container.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [contentVersion, resetKey]);

  return { scrollRef, endRef, onScroll };
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
  return (
    <details
      open
      className="rounded-lg border border-line bg-surface-muted/70 px-3 py-2 text-xs"
    >
      <summary className="cursor-pointer font-medium text-ink">
        {completed ? "✓" : "●"} {assistantToolLabel(tool)}
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
        {payload?.arguments !== undefined && (
          <ActivityValue label="输入" value={payload.arguments} />
        )}
        {payload?.result !== undefined && (
          <ActivityValue label="结果摘要" value={payload.result} />
        )}
        {payload?.error !== undefined && (
          <p className="text-danger">
            <span className="font-medium">错误：</span>
            {String(payload.error)}
          </p>
        )}
        {!completed && payload?.result === undefined && (
          <p className="animate-pulse">正在等待工具返回…</p>
        )}
      </div>
    </details>
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
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-2 font-mono text-[11px] leading-5 text-muted">
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
