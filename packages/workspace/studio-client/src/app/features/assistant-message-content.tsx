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
import styles from "./assistant-message-content.module.css";
import { copyText } from "../copy";
import { clsx } from "clsx";

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
  scrollRef: RefObject<HTMLDivElement>;
  endRef: RefObject<HTMLDivElement>;
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
  dramaip_curl: "curl 访问公开网络",
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
  dramaip_curl: "通过 curl 直接读取公开网页或 API",
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
      className={styles.c1}
      aria-label={copyText("app/features/assistant-message-content.1")}
    >
      <p className={styles.c2}>{failed ? "工作过程 · 处理失败" : "工作过程"}</p>
      <div className={styles.c3}>
        {stages.map((stage) => (
          <p key={stage.id} className={styles.c4}>
            <span
              className={clsx(
                styles.c5,
                stage.status === "failed"
                  ? styles.k1
                  : props.active && stage.id === stages.at(-1)?.id
                    ? styles.k2
                    : styles.k3,
              )}
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
  const isWebTool = tool === "dramaip_curl";
  const expandByDefault = !isWebTool || (!completed && !failed);
  return (
    <details open={expandByDefault} className={styles.c6}>
      <summary className={styles.c7}>
        {completed ? "✓" : failed ? "!" : "●"} {assistantToolLabel(tool)}
      </summary>
      <div className={styles.c8}>
        <p>
          <span className={styles.c2}>
            {copyText("app/features/assistant-message-content.2")}
          </span>
          {TOOL_PURPOSES[tool] ?? "获取完成本轮任务所需的权威只读资料"}
        </p>
        <p>
          <span className={styles.c2}>
            {copyText("app/features/assistant-message-content.3")}
          </span>
          {tool || "DramaIP 只读工具"}
        </p>
        {isWebTool && !completed && !failed && (
          <p className={styles.c9}>
            {copyText("app/features/assistant-message-content.curlReading")}
          </p>
        )}
        {isWebTool && completed && (
          <p>{copyText("app/features/assistant-message-content.pageRead")}</p>
        )}
        {isWebTool && failed && (
          <p className={styles.c10}>
            {copyText("app/features/assistant-message-content.4")}
          </p>
        )}
        {!isWebTool && payload?.arguments !== undefined && (
          <ActivityValue label="输入" value={payload.arguments} />
        )}
        {!isWebTool && payload?.result !== undefined && (
          <ActivityValue label="结果摘要" value={payload.result} />
        )}
        {payload?.error !== undefined && (
          <p className={styles.c10}>
            <span className={styles.c11}>
              {copyText("app/features/assistant-message-content.5")}
            </span>
            {String(payload.error)}
          </p>
        )}
        {!completed && !failed && payload?.result === undefined && (
          <p className={styles.c9}>
            {copyText("app/features/assistant-message-content.6")}
          </p>
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
  const sources = Array.isArray(result?.results)
    ? result.results
    : result?.url
      ? [result]
      : [];
  return sources.slice(0, 10).flatMap((value) => {
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
      className={styles.c12}
      aria-label={copyText("app/features/assistant-message-content.7")}
    >
      <summary className={styles.c13}>
        <span className={styles.c14}>
          <span className={styles.c15}>
            {copyText("app/features/assistant-message-content.8")}
          </span>
          <span className={styles.c16}>
            {sources.length}
            {copyText("app/features/assistant-message-content.9")}
          </span>
        </span>
        <span className={styles.c17}>
          {copyText("app/features/assistant-message-content.10")}
          <span aria-hidden="true" className={styles.c18}>
            ⌄
          </span>
        </span>
      </summary>
      <div className={styles.c19}>
        {sources.map((source) => (
          <button
            key={`${source.provider ?? "web"}:${source.url}`}
            type="button"
            className={styles.c20}
            onClick={() => props.onOpen(source.url)}
          >
            <span className={styles.c21}>
              {sourceDomain(source.url)}
              {source.provider ? ` · ${source.provider}` : ""}
            </span>
            <strong className={styles.c22}>{source.title}</strong>
            {source.excerpt && (
              <span className={styles.c23}>{source.excerpt}</span>
            )}
            <span className={styles.c24}>
              {props.verifiedUrls?.has(source.url)
                ? "已读取正文 · "
                : "仅搜索摘要 · "}
              {shortDate(source.publishedAt)
                ? `发布 ${shortDate(source.publishedAt)} · `
                : ""}
              {copyText("app/features/assistant-message-content.11")}
              {shortDate(source.retrievedAt) ?? "刚刚"}
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
      className={clsx(
        styles.c25,
        automatic ? styles.k4 : styles.k5,
        styles.c26,
      )}
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
        className={clsx(styles.c27, automatic ? styles.k6 : styles.k3)}
      />
      {copyText("app/features/assistant-message-content.12")}
      {automatic ? "自动" : "关闭"}
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
      <p className={styles.c2}>{props.label}：</p>
      <pre className={styles.c28}>{content}</pre>
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
          className={styles.c29}
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
          className={level <= 2 ? styles.c30 : styles.c31}
        >
          {inlineMarkdown(heading[2]!)}
        </p>,
      );
      index += 1;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={`rule-${index}`} className={styles.c32} />);
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
        <div key={`table-${index}`} className={styles.c33}>
          <table className={styles.c34}>
            <thead className={styles.c35}>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex} className={styles.c36}>
                    {inlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className={styles.c37}>
                  {header.map((_, cellIndex) => (
                    <td key={cellIndex} className={styles.c38}>
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
        <ul key={`list-${index}`} className={styles.c39}>
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
        <ol key={`ordered-${index}`} className={styles.c40}>
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
        <blockquote key={`quote-${index}`} className={styles.c41}>
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
      <p key={`paragraph-${index}`} className={styles.c42}>
        {inlineMarkdown(paragraph.join("\n"))}
      </p>,
    );
  }

  return <div className={styles.c43}>{blocks}</div>;
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
        <code key={index} className={styles.c44}>
          {token.slice(1, -1)}
        </code>
      );
    if (token.startsWith("*") && token.endsWith("*"))
      return <em key={index}>{token.slice(1, -1)}</em>;
    return <Fragment key={index}>{token}</Fragment>;
  });
}
