import type { StudioClient } from "@dramaip/client";
import type { Project } from "@dramaip/contracts/product";
import type { ProductionBriefDraft } from "./project-intake";
import type { CreationInitializationStep } from "./studio-session";
import {
  initializeSingleSeasonMaterials,
  initializeStoryPresetMaterials,
  type NovelStoryPreset,
} from "./features/novel/story-presets";

export type ProjectInitializationResult = {
  chapterId?: string;
  steps: CreationInitializationStep[];
};

export class ProjectInitializationError extends Error {
  constructor(
    message: string,
    readonly steps: CreationInitializationStep[],
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProjectInitializationError";
  }
}

export function projectInitializationPlan(project: Project): string[] {
  const common =
    project.mode === "series_longform"
      ? ["series-materials"]
      : project.mode === "single_season"
        ? ["season-materials"]
        : project.mode === "personal_theater"
          ? ["theater-opening"]
          : ["creator-workspace"];
  return common;
}

export async function initializeProjectMaterials(
  client: StudioClient,
  input: {
    project: Project;
    brief: ProductionBriefDraft;
    preset?: NovelStoryPreset;
    scriptDraft?: string;
  },
): Promise<ProjectInitializationResult> {
  const steps: CreationInitializationStep[] = [];
  let chapterId: string | undefined;
  const run = async (key: string, operation: () => Promise<void>) => {
    steps.push({ key, status: "pending" });
    try {
      await operation();
      steps[steps.length - 1] = { key, status: "completed" };
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      steps[steps.length - 1] = { key, status: "failed", message: detail };
      throw new ProjectInitializationError(detail, [...steps], cause);
    }
  };
  const projectId = input.project.id;
  if (input.project.mode === "single_season") {
    await run("season-materials", async () => {
      const chapter = await initializeSingleSeasonMaterials(client, projectId, {
        idea: input.brief.idea,
        targetEpisodeCount:
          input.project.modeConfig.mode === "single_season"
            ? (input.project.modeConfig.targetEpisodeCount ?? 80)
            : 80,
        preset: input.preset,
      });
      chapterId = chapter.id;
    });
  } else if (input.project.mode === "series_longform") {
    await run("series-materials", async () => {
      if (input.preset) {
        const chapter = await initializeStoryPresetMaterials(
          client,
          projectId,
          input.preset,
          input.brief.idea,
        );
        chapterId = chapter.id;
        return;
      }
      const chapters = await client.chapters.list(projectId);
      const chapter =
        chapters.find((item) => item.title === "第 1 章") ??
        (await client.chapters.create({
          projectId,
          title: "第 1 章",
          summary: input.brief.idea,
          content: "",
        }));
      chapterId = chapter.id;
    });
  } else if (input.project.mode === "personal_theater") {
    await run("theater-opening", async () => {
      const chapters = await client.chapters.list(projectId);
      const chapter =
        chapters.find((item) => item.title === "第 1 集故事") ??
        (await client.chapters.create({
          projectId,
          title: "第 1 集故事",
          summary: input.brief.idea,
          content: "",
        }));
      chapterId = chapter.id;
    });
  } else {
    // The creator-channel profile owns its topic and content-workbench
    // structure. Project creation has already installed that profile; this
    // auditable no-op keeps every entry on the same initialization plan.
    steps.push({ key: "creator-workspace", status: "completed" });
  }
  const scriptDraft = input.scriptDraft?.trim();
  if (scriptDraft) {
    await run("script-draft", async () => {
      const title =
        input.project.mode === "personal_theater"
          ? "第 1 集故事草稿"
          : "第 1 集剧本草稿";
      const chapters = await client.chapters.list(projectId);
      const existing = chapters.find((item) => item.title === title);
      if (existing) {
        chapterId = existing.id;
        return;
      }
      const chapter = await client.chapters.create({
        projectId,
        title,
        summary:
          input.project.mode === "personal_theater"
            ? "从首页自由描述创建的个人小剧场故事，待完成人物授权后制作。"
            : "从首页直接粘贴的剧本草稿，待后续拆分为场景与分镜。",
        content: scriptDraft,
      });
      chapterId = chapter.id;
    });
  }
  return { chapterId, steps };
}
