import type {
  InspirationProjectPreview,
  ProjectMode,
} from "@dramaip/contracts/product";
import { BareButton, Button, Input } from "@dramaip/infra-ui-primitives";
import { useQueryClient } from "../../query";
import { IconArrowRightOutlineRegular as ArrowRight } from "@dramaip/infra-ui-primitives";
import { useState } from "react";
import { useNavigate } from "../../router";
import { message, useStudio } from "../../studio-shared";
import {
  projectInputFromBrief,
  projectModeBrief,
  projectModeConfigFromDraft,
} from "../../project-intake";
import {
  initializeProjectMaterials,
  ProjectInitializationError,
} from "../../project-creation-coordinator";
import { createCreationDraft, useStudioSession } from "../../studio-session";
import { NovelStoryPresetPicker } from "../novel/NovelStoryPresetPicker";
import {
  novelStoryPreset,
  projectInputFromStoryPreset,
  type NovelStoryPresetId,
} from "../novel/story-presets";
import styles from "./inspiration-conversion.module.css";
import { copyText } from "../../copy";
import { clsx } from "clsx";

const PROJECT_MODES: readonly {
  id: ProjectMode;
  label: string;
  outcome: string;
}[] = [
  { id: "series_longform", label: "系列长篇", outcome: "第一章与长篇故事骨架" },
  { id: "single_season", label: "单季短剧", outcome: "母稿、人物、季纲与首集" },
  {
    id: "personal_theater",
    label: "我的 AI 小剧场",
    outcome: "第一集故事与人物授权",
  },
  {
    id: "creator_channel",
    label: "博主内容工作室",
    outcome: "主题与持续内容工作台",
  },
];

function usesPreset(mode: ProjectMode | undefined) {
  return mode === "series_longform" || mode === "single_season";
}

/**
 * The project conversion of an inspiration conversation: the creation
 * mode, name and story preset, the final write preview, and the commit that
 * creates the project from the adopted cards and initializes its materials.
 * The agents client's inspiration space lays it out under the cards in its
 * `agents.inspiration-conversion` slot; it stays here with project creation
 * until the workspace views move (P6).
 */
export function InspirationConversion(props: {
  conversationId: string;
  conversationTitle: string | undefined;
  cards: readonly { id: string; content: string; adopted: boolean }[];
  notify(message: string): void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const session = useStudioSession();
  const navigate = useNavigate();
  const { cards, conversationId, notify } = props;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ProjectMode | undefined>(
    session.creationDraft?.projectMode,
  );
  const [title, setTitle] = useState(session.creationDraft?.brief.title ?? "");
  const [presetId, setPresetId] = useState<NovelStoryPresetId | undefined>(
    () =>
      novelStoryPreset(
        session.creationDraft?.storyPresetId as NovelStoryPresetId,
      )
        ? (session.creationDraft?.storyPresetId as NovelStoryPresetId)
        : undefined,
  );
  const [preview, setPreview] = useState<InspirationProjectPreview>();
  const [converting, setConverting] = useState(false);

  const brief = () => {
    if (!mode) return undefined;
    const adoptedIdea = cards
      .filter((card) => card.adopted)
      .map((card) => card.content.trim())
      .filter(Boolean)
      .join("\n");
    const next = projectModeBrief(
      mode,
      "inspiration",
      session.creationDraft?.brief,
    );
    next.title = title.trim();
    if (!next.idea.trim()) next.idea = adoptedIdea;
    return next;
  };

  const persist = (
    nextMode: ProjectMode,
    nextTitle = title,
    nextPreset = presetId,
  ) => {
    const current =
      session.creationDraft ??
      createCreationDraft("inspiration", nextMode, "inspiration");
    const nextBrief = projectModeBrief(nextMode, "inspiration", current.brief);
    nextBrief.title = nextTitle;
    session.saveCreationDraft({
      ...current,
      projectMode: nextMode,
      creationSource: "inspiration",
      brief: nextBrief,
      storyPresetId: nextPreset,
      origin: "inspiration",
      updatedAt: new Date().toISOString(),
    });
  };

  const createPreview = async () => {
    if (!mode || !title.trim()) return;
    const draft = brief();
    if (!draft) return;
    const modeConfig = projectModeConfigFromDraft(
      mode,
      "inspiration",
      draft,
      draft.idea || draft.title,
    );
    if (!modeConfig) {
      notify("请补充当前模式所需的主题或规模设置。");
      return;
    }
    const preset = usesPreset(mode) ? novelStoryPreset(presetId) : undefined;
    setConverting(true);
    try {
      const next = await client.inspiration.createProjectPreview({
        conversationId,
        project: preset
          ? projectInputFromStoryPreset(draft, preset, modeConfig)
          : projectInputFromBrief(draft, modeConfig),
        cardIds: cards.filter((card) => card.adopted).map((card) => card.id),
      });
      setPreview(next);
      persist(mode, title, presetId);
    } catch (cause) {
      notify(message(cause));
    } finally {
      setConverting(false);
    }
  };

  const commit = async () => {
    if (!preview || !mode) return;
    setConverting(true);
    let committedProjectId: string | undefined;
    let committedDraft = session.creationDraft;
    let failedSteps = committedDraft?.initializationSteps ?? [];
    try {
      const result = await client.inspiration.commitProjectPreview(preview.id);
      committedProjectId = result.project.id;
      committedDraft =
        committedDraft ??
        createCreationDraft("inspiration", mode, "inspiration");
      session.saveCreationDraft(
        {
          ...committedDraft,
          projectMode: mode,
          createdProjectId: committedProjectId,
          initializationSteps: [
            {
              key: "project",
              status: "completed",
              message: "项目记录与已采用卡片已创建",
            },
          ],
          updatedAt: new Date().toISOString(),
        },
        true,
      );
      const draft = brief();
      const preset = usesPreset(mode) ? novelStoryPreset(presetId) : undefined;
      if (!draft) throw new Error("创作草稿缺少模式初始化资料");
      const initialized = await initializeProjectMaterials(client, {
        project: result.project,
        brief: draft,
        preset,
      }).catch((cause: unknown) => {
        if (cause instanceof ProjectInitializationError)
          failedSteps = cause.steps;
        throw cause;
      });
      if (initialized.chapterId)
        window.localStorage.setItem(
          `dramaip-novel-last-chapter:${result.project.id}`,
          initialized.chapterId,
        );
      session.clearCreationDraft();
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      notify(
        `项目已创建，复制 ${result.cardsCopied} 张已采用卡片；原灵感对话仍保留。`,
      );
      navigate(`/projects/${result.project.id}`);
    } catch (cause) {
      if (committedProjectId && committedDraft) {
        session.saveCreationDraft(
          {
            ...committedDraft,
            createdProjectId: committedProjectId,
            initializationSteps: [
              {
                key: "project",
                status: "completed",
                message: "项目记录与已采用卡片已创建",
              },
              ...failedSteps,
            ],
            updatedAt: new Date().toISOString(),
          },
          true,
        );
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
        notify(
          `${message(cause)} 项目与已采用卡片均已安全保留，可在项目首页继续补齐初始化材料。`,
        );
        navigate("/");
      } else {
        setPreview(undefined);
        notify(
          `${message(cause)} 项目转换预览可能已过期；创作草稿和已采用卡片均已保留，请重新预览。`,
        );
      }
    } finally {
      setConverting(false);
    }
  };

  return (
    <>
      {open && (
        <section
          aria-label={copyText("app/features/agents/inspiration-conversion.1")}
          className={styles.c1}
        >
          <div>
            <p className={styles.c2}>
              {copyText("app/features/agents/inspiration-conversion.2")}
            </p>
            <p className={styles.c3}>
              {copyText("app/features/agents/inspiration-conversion.3")}
            </p>
          </div>
          <div className={styles.c4}>
            {PROJECT_MODES.map((entry) => (
              <BareButton
                key={entry.id}
                type="button"
                aria-pressed={mode === entry.id}
                className={clsx(
                  styles.c5,
                  mode === entry.id ? styles.k1 : styles.k2,
                )}
                onClick={() => {
                  const keep = usesPreset(entry.id) ? presetId : undefined;
                  setMode(entry.id);
                  setPreview(undefined);
                  setPresetId(keep);
                  persist(entry.id, title, keep);
                }}
              >
                <span className={styles.c6}>{entry.label}</span>
                <span className={styles.c7}>{entry.outcome}</span>
              </BareButton>
            ))}
          </div>
          <label className={styles.c8}>
            {copyText("app/features/agents/inspiration-conversion.4")}
            <Input
              value={title}
              placeholder={props.conversationTitle ?? "新创作项目"}
              onChange={(event) => {
                setTitle(event.target.value);
                setPreview(undefined);
                if (mode) persist(mode, event.target.value, presetId);
              }}
            />
          </label>
          {mode && usesPreset(mode) && (
            <NovelStoryPresetPicker
              selectedId={presetId}
              mode={mode}
              compact
              onSelect={(id) => {
                setPresetId(id);
                setPreview(undefined);
                persist(mode, title, id);
              }}
              onClear={() => {
                setPresetId(undefined);
                setPreview(undefined);
                persist(mode, title, undefined);
              }}
            />
          )}
          {preview ? (
            <div className={styles.c9}>
              <p className={styles.c10}>
                {copyText("app/features/agents/inspiration-conversion.5")}
              </p>
              <p className={styles.c11}>
                {copyText("app/features/agents/inspiration-conversion.6")}
                {preview.project.title}” ·
                {PROJECT_MODES.find(
                  (entry) => entry.id === preview.project.mode,
                )?.label ?? "创作项目"}
                {copyText("app/features/agents/inspiration-conversion.7")}
                {preview.cards.length}
                {copyText("app/features/agents/inspiration-conversion.8")}
                {presetId
                  ? ` · 使用${novelStoryPreset(presetId)?.label ?? "所选"}预设`
                  : ""}
              </p>
              <p className={styles.c12}>
                {copyText("app/features/agents/inspiration-conversion.9")}
              </p>
              <div className={styles.c13}>
                <Button
                  size="sm"
                  disabled={converting}
                  onClick={() => void commit()}
                >
                  {converting ? "正在创建…" : "确认创建项目"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={converting}
                  onClick={() => setPreview(undefined)}
                >
                  {copyText("app/features/agents/inspiration-conversion.10")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className={styles.c14}
              size="sm"
              disabled={converting || !mode || !title.trim()}
              onClick={() => void createPreview()}
            >
              {converting ? "正在生成预览…" : "生成最终预览"}
            </Button>
          )}
        </section>
      )}
      <Button
        className={styles.c14}
        variant="secondary"
        onClick={() => {
          const opening = !open;
          setOpen(opening);
          setPreview(undefined);
          if (opening && !title.trim())
            setTitle(
              session.creationDraft?.brief.title ||
                props.conversationTitle ||
                "",
            );
        }}
      >
        <ArrowRight aria-hidden="true" className={styles.c15} />
        {open ? "收起项目预览" : "预览并转为项目"}
      </Button>
    </>
  );
}
