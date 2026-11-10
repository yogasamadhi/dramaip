import { useEffect, useRef, useState } from "react";
import { usePublishedEvents, type SystemRemote } from "./events.ts";
import css from "./Creation.module.css";
import {
  usePoll,
  value as valueOf,
  type AgentsRemote,
  type CreationWorkflow,
  type Translate,
} from "./remote.ts";
import { creationStreamPreview, elapsedSeconds } from "./stream.ts";

/** The running stages, each with the step of four it belongs to. */
const STAGES: Record<string, number | undefined> = {
  preparing: 0,
  generating: 1,
  checking: 2,
  revising: 2,
  rechecking: 2,
};
const STEPS = ["prepare", "generate", "check", "review"] as const;
type RunningStage =
  "preparing" | "generating" | "checking" | "revising" | "rechecking";

/** One saved item of a run: its kind, text and save time. */
interface RunItem {
  type: string;
  content?: string;
  updatedAt: string;
}

/**
 * The elapsed time, in seconds or minutes and seconds.
 * @param t - copy.
 * @param seconds - whole seconds.
 */
export function elapsedText(t: Translate, seconds: number): string {
  return seconds < 60
    ? t("progress.seconds", { seconds })
    : t("progress.minutes", {
        minutes: Math.floor(seconds / 60),
        seconds: seconds % 60,
      });
}

/** Props of {@link CreationProgress}. */
export interface CreationProgressProps {
  agents: AgentsRemote;
  system: SystemRemote;
  t: Translate;
  value: CreationWorkflow;
}

/**
 * Live feedback of a running or ended run: its stage, elapsed time, the four
 * steps and the text the model is returning, read from the run's saved items
 * and its published deltas, whichever is newer.
 */
export function CreationProgress({
  agents,
  system,
  t,
  value,
}: CreationProgressProps) {
  const step = STAGES[value.stage];
  const active = step !== undefined;
  const stage = value.stage as RunningStage;
  const [now, setNow] = useState(Date.now);
  const [live, setLive] = useState<{ content: string; at: string }>();
  const [activity, setActivity] = useState<{ content: string; at: string }>();
  const previewRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const items = usePoll(
    `${value.runId ?? ""}:${active ? "active" : "ended"}`,
    () => valueOf<RunItem[]>(agents.sessionsListItems(value.runId!)),
    {
      enabled: Boolean(value.runId),
      interval: active ? 2000 : undefined,
    },
  );
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  usePublishedEvents(system, (event) => {
    if (!event.payload || typeof event.payload !== "object") return;
    const payload = event.payload as Record<string, unknown>;
    if (!value.runId || payload.runId !== value.runId) return;
    const at = String(payload.occurredAt ?? event.occurredAt);
    if (
      event.type === "agents.assistant-item-delta.v1" &&
      typeof payload.content === "string"
    )
      setLive({ content: payload.content, at });
    if (
      event.type.startsWith("agents.assistant-item-") &&
      payload.type === "stage" &&
      typeof payload.content === "string"
    )
      setActivity({ content: payload.content, at });
  });
  const saved = items.data?.find((item) => item.type === "message");
  const raw =
    live && (!saved || live.at >= saved.updatedAt)
      ? live.content
      : (saved?.content ?? "");
  const savedActivity = items.data
    ?.filter((item) => item.type === "stage")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const latestActivity =
    activity && (!savedActivity || activity.at >= savedActivity.updatedAt)
      ? activity.content
      : savedActivity?.content;
  const checking = value.stage === "checking" || value.stage === "rechecking";
  const text =
    (!active ? value.output?.content : "") ||
    creationStreamPreview(raw, checking) ||
    (!active ? creationStreamPreview(raw, true) : "");
  useEffect(() => {
    if (follow.current && previewRef.current)
      previewRef.current.scrollTop = previewRef.current.scrollHeight;
  }, [text]);
  if (!active && !text) return null;
  return (
    <section aria-label={t("progress.aria")} className={css.raised}>
      <div className={css.row}>
        <strong role="status">
          {active ? t(`progress.stage.${stage}`) : t("progress.ended")}
        </strong>
        <span className={css.muted} aria-label={t("progress.elapsed.aria")}>
          {t("progress.elapsed", {
            time: elapsedText(
              t,
              elapsedSeconds(
                value.createdAt,
                active ? now : Date.parse(value.updatedAt),
              ),
            ),
          })}
        </span>
      </div>
      {active && (
        <ol aria-label={t("progress.steps.aria")} className={css.steps}>
          {STEPS.map((name, index) => (
            <li
              key={name}
              aria-current={index === step ? "step" : undefined}
              className={index === step ? css.currentStep : undefined}
            >
              {index < step! ? "✓ " : `${index + 1}. `}
              {t(`progress.step.${name}`)}
            </li>
          ))}
        </ol>
      )}
      {active && (
        <p className={css.muted} role="status">
          {raw
            ? checking
              ? t("progress.returning.check")
              : t("progress.returning.content")
            : t(`progress.waiting.${stage}`)}
        </p>
      )}
      {latestActivity && (
        <p className={css.small} role="status">
          {latestActivity}
        </p>
      )}
      {text && (
        <>
          <div className={css.row}>
            <span className={css.small}>
              {active
                ? checking
                  ? t("progress.preview.check")
                  : t("progress.preview.content")
                : t("progress.preview.ended")}
            </span>
            <span className={css.small}>
              {t("progress.length", { count: text.length })}
            </span>
          </div>
          <div
            ref={previewRef}
            role="region"
            aria-label={t("progress.preview.aria")}
            tabIndex={0}
            onScroll={(event) => {
              const node = event.currentTarget;
              follow.current =
                node.scrollHeight - node.scrollTop - node.clientHeight < 40;
            }}
            className={css.preview}
          >
            {text}
          </div>
          <p className={css.small}>
            {active ? t("progress.after.active") : t("progress.after.ended")}
          </p>
        </>
      )}
      {active && !raw && value.stage !== "preparing" && (
        <p className={css.small}>{t("progress.slow")}</p>
      )}
      {items.error && <p className={css.small}>{t("progress.itemsError")}</p>}
    </section>
  );
}
