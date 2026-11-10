import clsx from "clsx";
import type { Translate } from "../task-config/copy.ts";
import css from "./Assistant.module.css";
import {
  recordValue,
  type AssistantItem,
  type WebAccessMode,
} from "./types.ts";

/** The read-only tools the assistant names in its activity. */
const TOOLS = [
  "dramaip_get_project",
  "dramaip_get_chapter",
  "dramaip_list_chapters",
  "dramaip_list_characters",
  "dramaip_search_story_bible",
  "dramaip_analyze_continuity",
  "dramaip_search_project",
  "dramaip_get_adaptation",
  "dramaip_list_episodes",
  "dramaip_get_script",
  "dramaip_list_scenes",
  "dramaip_list_shots",
  "dramaip_list_asset_metadata",
  "dramaip_curl",
] as const;

type Tool = (typeof TOOLS)[number];

function knownTool(value: string | undefined): Tool | undefined {
  return TOOLS.find((tool) => tool === value);
}

/**
 * A tool's name in words; an unknown tool reads as a project read.
 * @param t - the copy.
 * @param value - the tool id.
 */
export function toolLabel(t: Translate, value: string | undefined): string {
  const tool = knownTool(value);
  return tool ? t(`assistant.tool.${tool}`) : t("assistant.tool.default");
}

/** The stages a run reported, the last one pulsing while it is active. */
export function StageSummary({
  t,
  items,
  active,
}: {
  t: Translate;
  items: readonly AssistantItem[];
  active: boolean;
}) {
  const stages = items.filter((item) => item.type === "stage" && item.content);
  if (!stages.length) return null;
  const failed = stages.some((item) => item.status === "failed");
  const last = stages.at(-1)?.id;
  return (
    <section className={css.stages} aria-label={t("assistant.stages.aria")}>
      <p className={css.stagesTitle}>
        {failed ? t("assistant.stages.failed") : t("assistant.stages")}
      </p>
      <div className={css.stageList}>
        {stages.map((stage) => (
          <p key={stage.id} className={css.stage}>
            <span
              className={clsx(
                css.dot,
                stage.status === "failed"
                  ? css.dotFailed
                  : active && stage.id === last
                    ? css.dotActive
                    : undefined,
              )}
            />
            <span>{stage.content}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

function ActivityValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className={css.activityLabel}>{label}</p>
      <pre className={css.activityValue}>
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/** One tool call: why it ran, what it read and what came back. */
export function ToolActivity({
  t,
  item,
}: {
  t: Translate;
  item: Pick<AssistantItem, "status" | "content" | "payload">;
}) {
  const tool = item.content ?? "";
  const known = knownTool(tool);
  const payload = recordValue(item.payload);
  const completed = item.status === "completed";
  const failed = item.status === "failed";
  const web = tool === "dramaip_curl";
  const settled = completed || failed;
  return (
    <details open={!web || !settled} className={css.activity}>
      <summary className={css.activitySummary}>
        {completed ? "✓" : failed ? "!" : "●"} {toolLabel(t, tool)}
      </summary>
      <div className={css.activityBody}>
        <p>
          <span className={css.activityLabel}>
            {t("assistant.activity.purpose")}
          </span>
          {known
            ? t(`assistant.purpose.${known}`)
            : t("assistant.purpose.default")}
        </p>
        <p>
          <span className={css.activityLabel}>
            {t("assistant.activity.tool")}
          </span>
          {tool || t("assistant.activity.tool.default")}
        </p>
        {web && !settled && (
          <p className={css.pulse}>{t("assistant.activity.reading")}</p>
        )}
        {web && completed && <p>{t("assistant.activity.read")}</p>}
        {web && failed && (
          <p className={css.danger}>{t("assistant.activity.webFailed")}</p>
        )}
        {!web && payload?.arguments !== undefined && (
          <ActivityValue
            label={t("assistant.activity.input")}
            value={payload.arguments}
          />
        )}
        {!web && payload?.result !== undefined && (
          <ActivityValue
            label={t("assistant.activity.result")}
            value={payload.result}
          />
        )}
        {payload?.error !== undefined && (
          <p className={css.danger}>
            <span className={css.activityLabel}>
              {t("assistant.activity.error")}
            </span>
            {String(payload.error)}
          </p>
        )}
        {!settled && payload?.result === undefined && (
          <p className={css.pulse}>{t("assistant.activity.waiting")}</p>
        )}
      </div>
    </details>
  );
}

/** One public web source a search returned. */
export interface WebSource {
  title: string;
  url: string;
  excerpt?: string | undefined;
  publishedAt?: string | undefined;
  retrievedAt?: string | undefined;
  provider?: string | undefined;
}

/**
 * The first ten https sources of a web search result.
 * @param payload - the tool result's payload.
 */
export function webSources(payload: unknown): WebSource[] {
  const result = recordValue(recordValue(payload)?.result);
  const sources = Array.isArray(result?.results)
    ? result.results
    : result?.url
      ? [result]
      : [];
  const text = (value: unknown) =>
    typeof value === "string" ? value : undefined;
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
        excerpt: text(source.excerpt),
        publishedAt: text(source.publishedAt),
        retrievedAt: text(source.retrievedAt),
        provider: text(source.provider),
      },
    ];
  });
}

function shortDate(t: Translate, value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat(t("date.locale"), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** The sources a web search found, collapsed until opened. */
export function WebSourceCards({
  t,
  payload,
  verifiedUrls,
  onOpen,
}: {
  t: Translate;
  payload: unknown;
  verifiedUrls: ReadonlySet<string>;
  onOpen: (url: string) => void;
}) {
  const sources = webSources(payload);
  if (!sources.length) return null;
  const domain = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return t("assistant.sources.domain");
    }
  };
  return (
    <details className={css.sources} aria-label={t("assistant.sources.aria")}>
      <summary className={css.sourcesSummary}>
        <span className={css.row}>
          <span className={css.sourcesTitle}>{t("assistant.sources")}</span>
          <span className={css.pill}>
            {t("assistant.sources.count", { count: sources.length })}
          </span>
        </span>
        <span className={css.row}>
          {t("assistant.sources.expand")}
          <span aria-hidden="true" className={css.chevron}>
            {"⌄"}
          </span>
        </span>
      </summary>
      <div className={css.sourceGrid}>
        {sources.map((source) => {
          const published = shortDate(t, source.publishedAt);
          return (
            <button
              key={`${source.provider ?? "web"}:${source.url}`}
              type="button"
              className={css.source}
              onClick={() => onOpen(source.url)}
            >
              <span className={css.sourceDomain}>
                {[domain(source.url), source.provider]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <strong className={css.sourceTitle}>{source.title}</strong>
              {source.excerpt && (
                <span className={css.sourceExcerpt}>{source.excerpt}</span>
              )}
              <span className={css.sourceMeta}>
                {[
                  verifiedUrls.has(source.url)
                    ? t("assistant.sources.verified")
                    : t("assistant.sources.summary"),
                  published &&
                    t("assistant.sources.published", { date: published }),
                  t("assistant.sources.retrieved", {
                    date:
                      shortDate(t, source.retrievedAt) ??
                      t("assistant.sources.now"),
                  }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

/** The switch that lets a conversation search the public web. */
export function WebAccessSwitch({
  t,
  mode,
  disabled,
  onChange,
}: {
  t: Translate;
  mode: WebAccessMode;
  disabled: boolean;
  onChange: (mode: WebAccessMode) => void;
}) {
  const automatic = mode === "auto";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={automatic}
      disabled={disabled}
      className={clsx(css.webSwitch, automatic && css.webSwitchOn)}
      onClick={() => onChange(automatic ? "off" : "auto")}
      title={
        disabled
          ? t("assistant.web.title.locked")
          : automatic
            ? t("assistant.web.title.auto")
            : t("assistant.web.title.off")
      }
    >
      <span
        aria-hidden="true"
        className={clsx(css.dot, automatic && css.dotActiveStill)}
      />
      {t("assistant.web", {
        state: automatic ? t("assistant.web.auto") : t("assistant.web.off"),
      })}
    </button>
  );
}
