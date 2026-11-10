import clsx from "clsx";
import { useEffect, useState } from "react";
import type { PilotPlansListResult } from "@dramaip/automation-automation/types";
import { Button } from "@dramaip/infra-ui-primitives";
import type { ChaptersListResult } from "@dramaip/writing-writing/types";
import type { ToolProps } from "./PersonalTheaterTool.tsx";
import { messageOf, value } from "./remote.ts";
import css from "./Tools.module.css";

type Plan = PilotPlansListResult[number];
type PlanAction = "confirm-source" | "return-source" | "cancel" | "resume";

const COVERAGE = ["episodes", "scripts", "scenes", "shots", "assets"] as const;

/** Where the chapter editor remembers the last chapter of a project. */
const lastChapterKey = (projectId: string) =>
  `dramaip-novel-last-chapter:${projectId}`;

function rememberedChapter(projectId: string): string | null {
  try {
    return globalThis.localStorage?.getItem(lastChapterKey(projectId)) ?? null;
  } catch {
    return null;
  }
}

/**
 * The page the plan's one next step opens, in the app's hash router, or
 * none while the source waits for confirmation.
 */
export function pilotNextStep(plan: Plan): string | undefined {
  const context = new URLSearchParams({
    projectId: plan.projectId,
    ...(plan.adaptationId ? { adaptationId: plan.adaptationId } : {}),
    ...(plan.episodeIds[0] ? { episodeId: plan.episodeIds[0] } : {}),
  }).toString();
  switch (plan.stage) {
    case "script":
      return `/adapt?${context}&stage=scripts`;
    case "scenes":
      return `/adapt?${context}&stage=scenes`;
    case "shots":
      return `/adapt?${context}&stage=shots`;
    case "assets":
      return `/produce?${context}&stage=visual-assets`;
    case "review":
      return `/review?${context}&stage=quality`;
    case "confirm-source":
      return undefined;
  }
}

/**
 * The resumable 1–3 episode pilot of one project: choose its source
 * chapters and episode count, then confirm, return, cancel or resume the
 * plan, see its coverage and generate each pilot episode in the legacy
 * episode workbench.
 */
export function PilotTool(props: ToolProps) {
  const { projectId, automation, writing, t } = props;
  const [plans, setPlans] = useState<PilotPlansListResult>([]);
  const [chapters, setChapters] = useState<ChaptersListResult>([]);
  const [revision, setRevision] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [episodeCount, setEpisodeCount] = useState(1);
  const [pilotEpisodeId, setPilotEpisodeId] = useState("");
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all([
      value(automation.pilotPlansList(projectId)),
      value(writing.chaptersList(projectId)),
    ]).then(
      ([nextPlans, nextChapters]) => {
        if (!live) return;
        setPlans(nextPlans);
        setChapters(nextChapters);
      },
      (cause: unknown) => live && setNotice(messageOf(cause)),
    );
    return () => {
      live = false;
    };
  }, [automation, writing, projectId, revision]);
  useEffect(() => {
    setSelectedIds((current) => {
      const valid = current.filter((id) =>
        chapters.some((chapter) => chapter.id === id),
      );
      if (valid.length) return valid;
      const remembered = rememberedChapter(projectId);
      const preferred = chapters.find((chapter) => chapter.id === remembered);
      return (preferred ? [preferred] : chapters.slice(0, 1)).map(
        (chapter) => chapter.id,
      );
    });
  }, [chapters, projectId]);
  const active = plans.find((plan) => plan.status !== "canceled") ?? plans[0];
  const refresh = () => setRevision((current) => current + 1);
  const toggle = (id: string) => {
    if (selectedIds.includes(id))
      return setSelectedIds(selectedIds.filter((item) => item !== id));
    if (selectedIds.length >= 3) return setNotice(t("pilot.tooMany"));
    setSelectedIds([...selectedIds, id]);
  };
  const create = async () => {
    if (!selectedIds.length || episodeCount > selectedIds.length)
      return setNotice(t("pilot.invalid"));
    setWorking(true);
    try {
      await value(
        automation.pilotPlansCreate(
          { projectId, chapterIds: selectedIds, episodeCount },
          undefined,
          undefined,
        ),
      );
      setNotice(t("pilot.created"));
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setWorking(false);
      refresh();
    }
  };
  const act = async (plan: Plan, action: PlanAction) => {
    setWorking(true);
    try {
      await value(
        automation.pilotPlansAction(plan.id, { action }, undefined, undefined),
      );
      setNotice(t(`pilot.done.${action}`));
    } catch (cause) {
      setNotice(messageOf(cause));
    } finally {
      setWorking(false);
      refresh();
    }
  };
  const next = active && pilotNextStep(active);
  const episodeId =
    active && active.episodeIds.includes(pilotEpisodeId)
      ? pilotEpisodeId
      : active?.episodeIds[0];
  return (
    <section aria-label={t("pilot.label")} className={css.panel}>
      <div className={css.head}>
        <div>
          <p className={css.muted}>{t("pilot.eyebrow")}</p>
          <h2 className={css.title}>{t("pilot.title")}</h2>
          <p className={css.muted}>{t("pilot.description")}</p>
        </div>
        <span className={css.badge}>{t("pilot.limit")}</span>
      </div>
      {notice && (
        <p role="status" className={css.notice}>
          {notice}
        </p>
      )}
      {!active && (
        <div className={css.box}>
          <p className={css.name}>{t("pilot.sources")}</p>
          <p className={css.muted}>{t("pilot.sources.hint")}</p>
          {chapters.slice(0, 12).map((chapter) => (
            <label key={chapter.id} className={css.check}>
              <input
                type="checkbox"
                checked={selectedIds.includes(chapter.id)}
                onChange={() => toggle(chapter.id)}
              />
              <span>{t("pilot.source", { title: chapter.title })}</span>
            </label>
          ))}
          {!chapters.length && (
            <p className={css.warning}>{t("pilot.sources.empty")}</p>
          )}
          <label className={css.field}>
            {t("pilot.count")}
            <select
              className={css.select}
              value={episodeCount}
              onChange={(event) => setEpisodeCount(Number(event.target.value))}
            >
              {[1, 2, 3].map((count) => (
                <option
                  key={count}
                  value={count}
                  disabled={count > selectedIds.length}
                >
                  {t("pilot.count.option", { count })}
                </option>
              ))}
            </select>
          </label>
          <div>
            <Button
              variant="primary"
              disabled={working || !chapters.length}
              onClick={() => void create()}
            >
              {t("pilot.create")}
            </Button>
          </div>
        </div>
      )}
      {active && (
        <div className={css.box}>
          <div className={css.head}>
            <div>
              <p className={css.name}>
                {t("pilot.stage", {
                  stage: t(`pilot.stage.${active.stage}`),
                })}
              </p>
              <p className={css.muted}>
                {t("pilot.summary", {
                  count: active.episodeCount,
                  source: t(
                    active.sourceConfirmed
                      ? "pilot.source.confirmed"
                      : "pilot.source.pending",
                  ),
                })}
              </p>
              {active.blocker && (
                <p className={css.warning}>{active.blocker}</p>
              )}
            </div>
            <div className={css.row}>
              {active.stage === "confirm-source" &&
                active.status !== "canceled" && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={working}
                    onClick={() => void act(active, "confirm-source")}
                  >
                    {t("pilot.confirm")}
                  </Button>
                )}
              {(active.status === "canceled" || active.status === "stale") && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={working}
                  onClick={() => void act(active, "resume")}
                >
                  {t(
                    active.status === "canceled"
                      ? "pilot.resume"
                      : "pilot.restart",
                  )}
                </Button>
              )}
              {next && (
                <a className={css.link} href={`#${next}`}>
                  {t("pilot.next")}
                </a>
              )}
              {active.status !== "canceled" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={working}
                    onClick={() => void act(active, "return-source")}
                  >
                    {t("pilot.return")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={css.danger}
                    disabled={working}
                    onClick={() => void act(active, "cancel")}
                  >
                    {t("pilot.cancel")}
                  </Button>
                </>
              )}
            </div>
          </div>
          {active.sourceConfirmed && episodeId && (
            <div className={css.list}>
              {active.episodeIds.length > 1 && (
                <label className={css.row}>
                  {t("pilot.episode")}
                  <select
                    className={css.select}
                    value={episodeId}
                    onChange={(event) => setPilotEpisodeId(event.target.value)}
                  >
                    {active.episodeIds.map((id, index) => (
                      <option key={id} value={id}>
                        {t("pilot.episode.option", { index: index + 1 })}
                      </option>
                    ))}
                  </select>
                  <span className={css.muted}>{t("pilot.episode.hint")}</span>
                </label>
              )}
              <details
                aria-label={t("legacyEpisode.label")}
                className={css.legacy}
              >
                <summary>{t("legacyEpisode.summary")}</summary>
                <p className={css.muted}>{t("legacyEpisode.note")}</p>
                {props.renderFactorySlot("automation.creation-record", {
                  projectId,
                  targetId: episodeId,
                  domain: "episodes",
                  sourceIds: active.chapterIds,
                  operation: "episode",
                  defaultInstruction: t("pilot.workbench"),
                })}
              </details>
            </div>
          )}
          <dl className={css.coverage}>
            {COVERAGE.map((key) => (
              <div key={key} className={css.cell}>
                <dt className={clsx(css.muted, css.small)}>
                  {t(`pilot.coverage.${key}`)}
                </dt>
                <dd className={css.value}>{active.coverage[key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
