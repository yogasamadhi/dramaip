import clsx from "clsx";
import { useEffect, useState } from "react";
import type {} from "@dramaip/automation-automation-client/client/contract";
import { Button, Input } from "@dramaip/infra-ui-primitives";
import type { ProjectsGetResult } from "@dramaip/workspace-workspace/types";
import type { ToolProps } from "./PersonalTheaterTool.tsx";
import { messageOf, value } from "./remote.ts";
import css from "./Tools.module.css";

/** What the content studio counts for one project. */
interface Channel {
  profiles: readonly string[];
  ideas: number;
  topics: number;
  riskDomain: "general" | "finance" | "health" | "legal";
}

const riskDomainOf = (project: ProjectsGetResult) =>
  project.modeConfig.mode === "creator_channel"
    ? (project.modeConfig.riskDomain ?? "general")
    : "general";

/**
 * The content studio of a creator channel project: its positioning, topic
 * library and public research topics, each added by hand, and the creation
 * workbench for its content. Nothing is published and no platform account is
 * kept.
 */
export function CreatorChannelTool(props: ToolProps) {
  const { projectId, workspace, writing, knowledge, t } = props;
  const [channel, setChannel] = useState<Channel>();
  const [readError, setReadError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [profileTitle, setProfileTitle] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [researchTitle, setResearchTitle] = useState("");
  const [notice, setNotice] = useState<{ text: string; failed: boolean }>();
  useEffect(() => {
    let live = true;
    void Promise.all([
      value(workspace.projectsGet(projectId)),
      value(writing.creatorProfileList()),
      value(writing.creatorIdeaList()),
      value(knowledge.researchTopicsList(projectId, undefined)),
    ]).then(
      ([project, profiles, ideas, topics]) => {
        if (!live) return;
        // The lists answer every project's records; keep this project's.
        const own = <T extends { projectId: string }>(items: readonly T[]) =>
          items.filter((item) => item.projectId === projectId);
        setChannel({
          profiles: own(profiles.items).map((item) => item.title),
          ideas: own(ideas.items).length,
          topics: own(topics.items).length,
          riskDomain: riskDomainOf(project),
        });
        setReadError(undefined);
      },
      (cause: unknown) => live && setReadError(messageOf(cause)),
    );
    return () => {
      live = false;
    };
  }, [workspace, writing, knowledge, projectId, revision]);
  const refresh = () => setRevision((current) => current + 1);
  const fail = (cause: unknown) =>
    setNotice({ text: messageOf(cause), failed: true });
  const add = async (kind: "profile" | "idea") => {
    const title = (kind === "profile" ? profileTitle : ideaTitle).trim();
    if (!title) return;
    try {
      const input = { projectId, title, payload: {} };
      await value(
        kind === "profile"
          ? writing.creatorProfileCreate(input, undefined, undefined)
          : writing.creatorIdeaCreate(input, undefined, undefined),
      );
      if (kind === "profile") setProfileTitle("");
      else setIdeaTitle("");
      refresh();
    } catch (cause) {
      fail(cause);
    }
  };
  const research = async () => {
    const rawUrl = researchTitle.trim();
    if (!rawUrl) return;
    try {
      const url = URL.canParse(rawUrl) ? new URL(rawUrl) : undefined;
      if (
        !url ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.toString().length > 500
      )
        throw new Error(t("channel.research.invalidUrl"));
      const riskDomain =
        channel?.riskDomain ??
        riskDomainOf(await value(workspace.projectsGet(projectId)));
      const topic = await value(
        knowledge.researchTopicsCreate(
          projectId,
          { title: url.hostname, query: url.toString(), riskDomain },
          undefined,
          undefined,
        ),
      );
      await value(
        knowledge.researchSearch(
          topic.id,
          { query: url.toString() },
          undefined,
          undefined,
        ),
      );
      setResearchTitle("");
      setNotice({
        text: t("channel.research.saved"),
        failed: false,
      });
      refresh();
    } catch (cause) {
      fail(cause);
    }
  };
  return (
    <section className={css.tool}>
      {props.renderFactorySlot("automation.creation-workbench", {
        projectId,
        operation: "creator-content",
        defaultInstruction: t("channel.workbench"),
        onApplied: refresh,
      })}
      <p className={css.boundary}>{t("channel.boundary")}</p>
      <div className={clsx(css.form, css.inline)}>
        <Input
          aria-label={t("channel.profile")}
          placeholder={t("channel.profile")}
          value={profileTitle}
          onChange={(event) => setProfileTitle(event.target.value)}
        />
        <Button variant="primary" onClick={() => void add("profile")}>
          {t("channel.profile.save")}
        </Button>
      </div>
      <div className={clsx(css.form, css.inline)}>
        <Input
          aria-label={t("channel.idea")}
          placeholder={t("channel.idea")}
          value={ideaTitle}
          onChange={(event) => setIdeaTitle(event.target.value)}
        />
        <Button variant="primary" onClick={() => void add("idea")}>
          {t("channel.idea.save")}
        </Button>
      </div>
      <div className={clsx(css.form, css.inline)}>
        <Input
          aria-label={t("channel.research")}
          type="url"
          placeholder={t("channel.research")}
          value={researchTitle}
          onChange={(event) => setResearchTitle(event.target.value)}
        />
        <Button variant="outline" onClick={() => void research()}>
          {t("channel.research.start")}
        </Button>
      </div>
      {notice && (
        <p
          role={notice.failed ? "alert" : "status"}
          className={notice.failed ? css.danger : css.notice}
        >
          {notice.text}
        </p>
      )}
      {readError && (
        <p role="alert" className={css.danger}>
          {readError}
        </p>
      )}
      <div className={css.stats}>
        <article className={css.stat}>
          <p className={clsx(css.muted, css.small)}>{t("channel.profiles")}</p>
          <p className={css.name}>
            {channel?.profiles.join("、") || t("channel.profiles.empty")}
          </p>
        </article>
        <article className={css.stat}>
          <p className={clsx(css.muted, css.small)}>{t("channel.ideas")}</p>
          <p className={css.name}>
            {t("channel.ideas.count", { count: channel?.ideas ?? 0 })}
          </p>
        </article>
        <article className={css.stat}>
          <p className={clsx(css.muted, css.small)}>{t("channel.topics")}</p>
          <p className={css.name}>
            {t("channel.topics.count", { count: channel?.topics ?? 0 })}
          </p>
        </article>
      </div>
    </section>
  );
}
