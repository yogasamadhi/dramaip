import type { ReactNode } from "react";
import type { Translate } from "../task-config/copy.ts";
import { StageSummary, ToolActivity, WebSourceCards } from "./Activity.tsx";
import css from "./Assistant.module.css";
import { MessageContent } from "./MessageContent.tsx";
import { recordValue, type AssistantDetail } from "./types.ts";

const ACTIVE = ["queued", "running"];

/**
 * The turns of an assistant conversation: each user message, how it was
 * routed, the run's stages, tool calls, answers and the web sources it read.
 * A turn routed to a creation workflow shows the run card `renderRun` gives;
 * the inspiration space never routes to one, since it binds no project.
 */
export function AssistantTimeline({
  t,
  detail,
  surface,
  renderRun,
  onOpenUrl,
}: {
  t: Translate;
  detail: AssistantDetail | undefined;
  surface: "global" | "inspiration";
  renderRun?: ((workflowId: string) => ReactNode) | undefined;
  onOpenUrl: (url: string) => void;
}) {
  const inspiration = surface === "inspiration";
  if (!detail?.turns.length)
    return (
      <div className={css.empty}>
        {inspiration
          ? t("assistant.empty.inspiration")
          : t("assistant.empty.global")}
      </div>
    );
  return (
    <div
      className={css.timeline}
      aria-label={
        inspiration
          ? t("assistant.timeline.inspiration")
          : t("assistant.timeline.global")
      }
    >
      {detail.turns.map((turn) => {
        const run = detail.runs.find((item) => item.id === turn.runId);
        const items = run
          ? detail.items.filter((item) => item.runId === run.id)
          : [];
        const active = Boolean(run && ACTIVE.includes(run.status));
        const verifiedUrls = new Set(
          items.flatMap((item) => {
            if (item.type !== "tool_result" || item.content !== "dramaip_curl")
              return [];
            const url = recordValue(recordValue(item.payload)?.result)?.url;
            return typeof url === "string" ? [url] : [];
          }),
        );
        const meta = [
          inspiration
            ? t("assistant.turn.inspiration")
            : turn.projectId
              ? t("assistant.turn.project")
              : t("assistant.turn.general"),
          turn.chapterId &&
            t("assistant.turn.chapter", { id: turn.chapterId.slice(0, 8) }),
          turn.routingInputTokens !== undefined &&
            t("assistant.turn.routing", {
              count: turn.routingInputTokens + (turn.routingOutputTokens ?? 0),
            }),
        ].filter(Boolean);
        return (
          <article key={turn.id} className={css.turn}>
            <div className={css.user}>
              <p className={css.pre}>{turn.userMessage}</p>
              <p className={css.userMeta}>{meta.join(" · ")}</p>
            </div>
            {turn.route?.workflowId && renderRun?.(turn.route.workflowId)}
            {turn.route?.kind === "clarify" && (
              <p className={css.clarify}>{turn.route.clarification}</p>
            )}
            {turn.status === "routing" && !run && (
              <p className={css.routing}>
                <span className={css.routingDot} />
                {t("assistant.routing")}
              </p>
            )}
            <StageSummary t={t} items={items} active={active} />
            {items
              .filter((item) => item.type === "tool_call")
              .map((item) => (
                <ToolActivity key={item.id} t={t} item={item} />
              ))}
            {items
              .filter((item) =>
                ["message", "structured_output", "error"].includes(item.type),
              )
              .map((item) => (
                <div key={item.id} className={css.answer}>
                  <MessageContent content={item.content} />
                  {item.status === "streaming" && (
                    <span className={css.caret} />
                  )}
                </div>
              ))}
            {items
              .filter((item) => item.type === "tool_result")
              .map((item) => (
                <WebSourceCards
                  key={item.id}
                  t={t}
                  payload={item.payload}
                  verifiedUrls={verifiedUrls}
                  onOpen={onOpenUrl}
                />
              ))}
            {active && !items.length && (
              <p className={css.small}>{t("assistant.connecting")}</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
