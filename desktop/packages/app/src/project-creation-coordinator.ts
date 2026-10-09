import type { StudioClient } from "@dramaip/client";
import type { Project } from "@dramaip/contracts/product";
import {
  isDirectScriptProject,
  type ProductionBriefDraft,
} from "./project-intake";
import type { CreationInitializationStep } from "./studio-session";
import {
  initializeSingleSeasonMaterials,
  initializeStoryPresetMaterials,
  type NovelStoryPreset,
} from "./features/novel/story-presets";

export type ProjectInitializationResult = {
  chapterId?: string;
  scriptContext?: ScriptWorkspaceContext;
  steps: CreationInitializationStep[];
};

export type ScriptWorkspaceContext = {
  projectId: string;
  adaptationId: string;
  episodeId: string;
  scriptId: string;
};

export function scriptWorkspacePath(context: ScriptWorkspaceContext): string {
  return `/adapt?${new URLSearchParams({ ...context, stage: "scripts", context: "inherited" })}`;
}

/** Restore in the Production owner's episode order, not cross-parent script order. */
export async function existingScriptContext(
  client: StudioClient,
  project: Project,
): Promise<ScriptWorkspaceContext | undefined> {
  const [adaptations, episodes, scripts] = await Promise.all([
    client.resources.list("adaptations", project.id),
    client.resources.list("episodes", project.id),
    client.resources.list("scripts", project.id),
  ]);
  for (const episode of episodes) {
    const adaptation = adaptations.find((item) => item.id === episode.parentId);
    const script = scripts.find(
      (item) => item.parentId === episode.id && item.projectId === project.id,
    );
    if (
      script &&
      adaptation &&
      [script, episode, adaptation].every(
        (item) => item.projectId === project.id,
      ) &&
      (!project.currentAdaptationId ||
        adaptation.id === project.currentAdaptationId)
    )
      return {
        projectId: project.id,
        adaptationId: adaptation.id,
        episodeId: episode.id,
        scriptId: script.id,
      };
  }
  return undefined;
}

const SCRIPT_INTAKE_MARKER = "existing-script-v1";
const ORIGINAL_SCRIPT_MARKER = "original-script-v1";

function scriptPayload(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function initializeExistingScript(
  client: StudioClient,
  project: Project,
  scriptDraft?: string,
  rightsConfirmed = false,
): Promise<ScriptWorkspaceContext> {
  const draft = scriptDraft?.trim();
  const existing = await existingScriptContext(client, project);
  if (existing) {
    const script = await client.resources.get("scripts", existing.scriptId);
    if (
      draft &&
      scriptPayload(script.payload)["初始化来源"] === SCRIPT_INTAKE_MARKER &&
      String(scriptPayload(script.payload)["剧本内容"] ?? "").trim() !== draft
    )
      throw new Error(
        "已保存剧本与当前草稿不同，请先检查已保存版本；不会自动覆盖。",
      );
    await client.productionStructure.selectCurrentAdaptation(project.id, {
      adaptationId: existing.adaptationId,
    });
    return existing;
  }
  if (!draft)
    throw new Error("尚未找到已导入的分集剧本，请重新确认剧本文件或粘贴内容。");
  if (!rightsConfirmed)
    throw new Error(
      "请先确认当前粘贴剧本的使用权；已保存资料与草稿均保持不变。",
    );
  return createScriptWorkspace(client, project, {
    marker: SCRIPT_INTAKE_MARKER,
    directoryTitle: "已有剧本·分集目录",
    direction: "已有剧本整理（非改编诊断或季纲）",
    scriptPayload: { 剧本内容: draft, 来源类型: "作者粘贴", 权利确认: true },
  });
}

async function initializeOriginalScript(
  client: StudioClient,
  project: Project,
): Promise<ScriptWorkspaceContext> {
  const existing = await existingScriptContext(client, project);
  if (existing) {
    await client.productionStructure.selectCurrentAdaptation(project.id, {
      adaptationId: existing.adaptationId,
    });
    return existing;
  }
  return createScriptWorkspace(client, project, {
    marker: ORIGINAL_SCRIPT_MARKER,
    directoryTitle: "原创剧本·分集目录",
    direction: "从创意开发剧本（非改编诊断或已采用季纲）",
    // This is an editable, empty draft, not a generated or adopted result.
    // The actual author-supplied brief remains in Workspace's project version.
    scriptPayload: { 剧本内容: "", 来源类型: "原创开发" },
  });
}

async function createScriptWorkspace(
  client: StudioClient,
  project: Project,
  input: {
    marker: string;
    directoryTitle: string;
    direction: string;
    scriptPayload: Record<string, unknown>;
  },
): Promise<ScriptWorkspaceContext> {
  // Real Production-owned containers; never label them adopted plans or novels.
  const adaptations = await client.resources.list("adaptations", project.id);
  const adaptation =
    adaptations.find(
      (item) => scriptPayload(item.payload)["初始化来源"] === input.marker,
    ) ??
    (await client.resources.create("adaptations", {
      projectId: project.id,
      title: input.directoryTitle,
      payload: {
        初始化来源: input.marker,
        改编方向: input.direction,
      },
    }));
  const episodes = await client.resources.list(
    "episodes",
    project.id,
    adaptation.id,
  );
  const episode =
    episodes.find(
      (item) => scriptPayload(item.payload)["初始化来源"] === input.marker,
    ) ??
    (await client.resources.create("episodes", {
      projectId: project.id,
      parentId: adaptation.id,
      title: "第 1 集",
      payload: { 初始化来源: input.marker, 集数: 1 },
    }));
  const script = await client.resources.create("scripts", {
    projectId: project.id,
    parentId: episode.id,
    title: "第 1 集剧本",
    payload: {
      初始化来源: input.marker,
      ...input.scriptPayload,
    },
  });
  await client.productionStructure.selectCurrentAdaptation(project.id, {
    adaptationId: adaptation.id,
  });
  return {
    projectId: project.id,
    adaptationId: adaptation.id,
    episodeId: episode.id,
    scriptId: script.id,
  };
}

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
  if (isDirectScriptProject(project))
    return [
      project.modeConfig.mode === "single_season" &&
      project.modeConfig.entryPath === "inspiration"
        ? "original-script-materials"
        : "script-materials",
    ];
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
    scriptRightsConfirmed?: boolean;
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
  if (
    input.project.modeConfig.mode === "single_season" &&
    input.project.modeConfig.entryPath === "inspiration"
  ) {
    let scriptContext: ScriptWorkspaceContext | undefined;
    await run("original-script-materials", async () => {
      scriptContext = await initializeOriginalScript(client, input.project);
    });
    return { scriptContext, steps };
  }
  if (
    input.project.modeConfig.mode === "single_season" &&
    input.project.modeConfig.entryPath === "script"
  ) {
    let scriptContext: ScriptWorkspaceContext | undefined;
    await run("script-materials", async () => {
      scriptContext = await initializeExistingScript(
        client,
        input.project,
        input.scriptDraft,
        input.scriptRightsConfirmed,
      );
    });
    return { scriptContext, steps };
  }
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
        (input.brief.creationSource === "source-import"
          ? chapters.at(-1)
          : undefined) ??
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
