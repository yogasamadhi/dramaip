import type {
  Chapter,
  ProductionGraph,
  Project,
  Task,
} from "@dramaip/contracts/product";
import { isDirectScriptProject } from "./project-intake";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { NovelCockpitEvidence } from "./novel-cockpit-evidence";
import type { AdaptationCockpitEvidence } from "./adaptation-cockpit-evidence";
import { deriveAdaptationCockpit } from "./adaptation-cockpit";
import type { DirectScriptCockpitEvidence } from "./direct-script-cockpit-evidence";
import { deriveDirectScriptCockpit } from "./direct-script-cockpit";

export type ProjectCockpitStatus =
  | "needs-input"
  | "needs-attention"
  | "working"
  | "needs-human"
  | "ready-for-review"
  | "delivered";

export type ProjectCockpitAction = {
  label: string;
  description: string;
  to: string;
};

export type ProjectCockpit = {
  status: ProjectCockpitStatus;
  statusLabel: string;
  primaryAction: ProjectCockpitAction;
  blockers: string[];
  recentResult: string;
  coverage: Array<{ label: string; current: number; required?: number }>;
  gates?: Array<{
    id: string;
    label: string;
    status:
      "ready" | "pending" | "needs-human" | "working" | "stale" | "unverified";
    statusLabel: string;
    detail: string;
    to: string;
  }>;
};

type CockpitInput = {
  project: Project;
  chapters: Chapter[];
  graph: ProductionGraph;
  tasks: Task[];
  novel?: NovelCockpitEvidence;
  adaptation?: AdaptationCockpitEvidence;
  direct?: DirectScriptCockpitEvidence;
};

export function usesNovelWorkflow(
  project: Project,
  graph: ProductionGraph,
): boolean {
  return project.mode === "series_longform" && !firstId(graph, "adaptations");
}

export function usesAdaptationWorkflow(
  project: Project,
  graph: ProductionGraph,
): boolean {
  return (
    !isDirectScriptProject(project) &&
    (project.mode === "single_season" ||
      (project.mode === "series_longform" &&
        !usesNovelWorkflow(project, graph)))
  );
}

export function deriveProjectCockpit(input: CockpitInput): ProjectCockpit {
  const { project, chapters, graph } = input;
  const tasks = input.tasks.filter((task) => task.projectId === project.id);
  const failedTasks = tasks.filter((task) =>
    ["failed", "interrupted"].includes(task.status),
  );
  const activeTasks = tasks.filter((task) =>
    ["queued", "running"].includes(task.status),
  );
  const novelOnly = usesNovelWorkflow(project, graph);
  if (isDirectScriptProject(project))
    return deriveDirectScriptCockpit(project, input.direct);
  if (novelOnly) return deriveNovelCockpit(input);
  if (usesAdaptationWorkflow(project, graph))
    return deriveAdaptationCockpit(project, input.adaptation);
  const coverage = novelOnly
    ? [
        { label: "章节", current: chapters.length },
        {
          label: "已保存正文",
          current: chapters.filter((chapter) => chapter.content?.trim()).length,
        },
      ]
    : [
        { label: "章节", current: chapters.length },
        { label: "改编方案", current: count(graph, "adaptations") },
        { label: "分集", current: graph.coverage.episodes },
        { label: "剧本", current: graph.coverage.scripts },
        { label: "场景", current: graph.coverage.scenes },
        { label: "分镜", current: graph.coverage.shots },
        { label: "视觉资产", current: graph.coverage.assets },
        {
          label: "已采用静帧",
          current: graph.coverage.adoptedStills,
          required: graph.coverage.shots,
        },
      ];
  const context = query({ projectId: project.id });
  const adaptationId = graph.nodes.some(
    (node) =>
      node.kind === "adaptations" && node.id === project.currentAdaptationId,
  )
    ? project.currentAdaptationId
    : firstId(graph, "adaptations");
  const childId = (kind: string, parentId: string | undefined) =>
    graph.nodes.find(
      (node) =>
        node.kind === kind &&
        graph.edges.some(
          (edge) => edge.sourceId === parentId && edge.targetId === node.id,
        ),
    )?.id;
  const episodeId =
    childId("episodes", adaptationId) ??
    (graph.edges.length ? undefined : firstId(graph, "episodes"));
  const scriptId = childId("scripts", episodeId);
  const shotId = firstId(graph, "shots");
  const withAdaptation = query({ projectId: project.id, adaptationId });
  const withEpisode = query({
    projectId: project.id,
    adaptationId,
    episodeId,
    scriptId,
    context: scriptId ? "inherited" : undefined,
  });
  const withShot = query({
    projectId: project.id,
    adaptationId,
    episodeId,
    shotId,
  });

  if (failedTasks.length)
    return cockpit(
      "needs-attention",
      "有任务需要处理",
      {
        label: "处理失败任务",
        description: "先查看失败原因或按可用方式重试，避免把失败结果当作完成。",
        to: `/tasks?${context}`,
      },
      [`${failedTasks.length} 个任务失败、取消或中断。`],
      coverage,
      recentTaskOrNode(tasks, graph),
    );
  if (activeTasks.length)
    return cockpit(
      "working",
      "正在处理",
      {
        label: "查看进行中的任务",
        description: "等待真实任务结果；完成前不会自动采用或推进阶段。",
        to: `/tasks?${context}`,
      },
      [`${activeTasks.length} 个任务仍在队列中或执行中。`],
      coverage,
      recentTaskOrNode(tasks, graph),
    );
  if (!chapters.length && !graph.coverage.scripts)
    return cockpit(
      "needs-input",
      "准备 AI 创作",
      {
        label:
          project.mode === "series_longform"
            ? "AI 生成第一章"
            : "完善 AI 创作方案",
        description:
          project.mode === "series_longform"
            ? "提供本章目标，由 AI 生成、检查并提出待审阅候选。"
            : "提供方向并确认来源，由 AI 生成可审阅方案。",
        to:
          project.mode === "series_longform"
            ? `/projects/${project.id}`
            : project.mode === "single_season"
              ? `/adapt?${context}`
              : `/projects/${project.id}/tools/${project.mode === "creator_channel" ? "creator-channel" : "personal-theater"}`,
      },
      ["尚未保存章节或剧本正文。"],
      coverage,
      `项目「${project.title}」已创建，等待可信内容输入。`,
    );
  if (!adaptationId && project.mode === "series_longform")
    return cockpit(
      "needs-input",
      "继续创作母本",
      {
        label: "继续 AI 创作",
        description:
          "继续本章或下一章，审阅采用后维护连续性记忆；也可以导出小说稿件，不要求改编或媒体制作。",
        to: `/projects/${project.id}`,
      },
      [],
      coverage,
      chapters.at(-1)
        ? `最近章节：${chapters.at(-1)!.title}（已保存；候选仍需明确采用）`
        : "等待小说创作结果。",
    );
  if (!adaptationId)
    return cockpit(
      "needs-input",
      "准备改编",
      {
        label: "AI 生成改编方案",
        description: "基于已保存的正文建立改编方案，再进入分集和剧本链路。",
        to: `/adapt?${context}&stage=adaptations`,
      },
      ["已保存内容，但尚未建立改编方案。"],
      coverage,
      recentTaskOrNode(tasks, graph),
    );
  if (!episodeId)
    return cockpit(
      "needs-input",
      "准备分集",
      {
        label: "AI 生成第一集",
        description:
          "在当前改编方案下建立分集，后续剧本会自动保留这个项目上下文。",
        to: `/adapt?${withAdaptation}&stage=episodes`,
      },
      ["已有改编方案，但尚未建立分集。"],
      coverage,
      recentTaskOrNode(tasks, graph),
    );
  if (!graph.coverage.scripts)
    return cockpit(
      "needs-input",
      "等待剧本",
      {
        label: "核对本集兼容创作",
        description:
          "此旧目录使用 episode 兼容生成；独立正式开发入口与历史记录分别保留。",
        to: `/adapt?${withEpisode}&stage=scripts&compatibility=episode`,
      },
      ["当前分集尚未保存剧本。"],
      coverage,
      recentTaskOrNode(tasks, graph),
    );
  if (!graph.coverage.scenes || !graph.coverage.shots)
    return cockpit(
      "needs-input",
      "等待分镜拆分",
      {
        label:
          project.modeConfig?.mode === "single_season" &&
          project.modeConfig.entryPath === "script" &&
          scriptId
            ? "检查已有剧本"
            : "AI 完善场景和分镜",
        description:
          "核对当前剧本与连续性，再按需建立场景和镜头；不会要求重写为小说。",
        to: `/adapt?${withEpisode}&stage=${project.modeConfig?.mode === "single_season" && project.modeConfig.entryPath === "script" && scriptId ? "scripts" : "scenes"}`,
      },
      [
        !graph.coverage.scenes
          ? "当前剧本尚未拆分场景。"
          : "当前场景尚未建立分镜。",
      ],
      coverage,
      recentTaskOrNode(tasks, graph),
    );
  if (!graph.coverage.assets)
    return cockpit(
      "needs-input",
      "准备视觉资产",
      {
        label: "整理视觉资产",
        description:
          "为当前项目建立角色、场景或道具资产，再进入静帧和视频制作。",
        to: `/produce?${withShot}&stage=visual-assets`,
      },
      ["已有分镜，但缺少可追溯的视觉资产。"],
      coverage,
      recentTaskOrNode(tasks, graph),
    );
  if (
    !graph.coverage.stills ||
    graph.coverage.adoptedStills < graph.coverage.shots
  )
    return cockpit(
      "needs-human",
      "等待人工确认静帧",
      {
        label:
          graph.coverage.adoptedStills > 0 ? "继续确认静帧" : "确认首个静帧",
        description:
          "先查看并采用静帧候选；未采用的视觉方向不能进入后续高成本制作。",
        to: `/produce?${withShot}&stage=shot-stills`,
      },
      [
        graph.coverage.stills
          ? `已采用 ${graph.coverage.adoptedStills}/${graph.coverage.shots} 个镜头静帧。`
          : "尚未创建静帧候选。",
      ],
      coverage,
      recentTaskOrNode(tasks, graph),
    );
  if (
    graph.nodes.some(
      (node) => node.kind === "delivery" && node.status === "已交付",
    )
  )
    return cockpit(
      "delivered",
      "已交付",
      {
        label: "查看交付记录",
        description:
          "打开当前项目的审核与交付记录；不要把预检或文件存在误认为真实交付。",
        to: `/review?${withEpisode}&stage=delivery`,
      },
      [],
      coverage,
      recentTaskOrNode(tasks, graph),
    );
  return cockpit(
    "ready-for-review",
    "准备审核交付",
    {
      label: "进入审核交付",
      description:
        "静帧已采用；下一步在当前项目上下文中完成质量、合规和审片检查。",
      to: `/review?${withEpisode}&stage=quality`,
    },
    [],
    coverage,
    recentTaskOrNode(tasks, graph),
  );
}

function deriveNovelCockpit(input: CockpitInput): ProjectCockpit {
  const { project, novel } = input;
  const chapters = input.chapters
    .filter((chapter) => chapter.projectId === project.id)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const saved = chapters.filter((chapter) => chapter.content?.trim());
  const adopted = saved.filter((chapter) =>
    novel?.adoptions.some(
      (record) =>
        record.chapterId === chapter.id && record.version === chapter.version,
    ),
  );
  const hasOldAdoption = saved.some(
    (chapter) =>
      !adopted.some((item) => item.id === chapter.id) &&
      novel?.adoptions.some(
        (record) =>
          record.chapterId === chapter.id && record.version !== chapter.version,
      ),
  );
  const workflows = (novel?.workflows ?? [])
    .filter(
      (workflow) =>
        workflow.input.projectId === project.id &&
        [
          "chapter",
          "characters",
          "book-outline",
          "chapter-outline",
          "story-arc",
          "chapter-memory",
          "knowledge-plan",
        ].includes(workflow.input.operation),
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
  const latest = workflows.filter(
    (workflow, index) =>
      workflows.findIndex(
        (item) =>
          item.input.operation === workflow.input.operation &&
          item.input.targetId === workflow.input.targetId,
      ) === index,
  );
  const synced = saved.filter((chapter) =>
    novel?.memories.some((record) => {
      if (record.projectId !== project.id) return false;
      if (
        !record.payload ||
        typeof record.payload !== "object" ||
        Array.isArray(record.payload)
      )
        return false;
      const payload = record.payload as Record<string, unknown>;
      if (
        payload.sourceChapterId !== chapter.id ||
        payload.sourceVersion !== chapter.version ||
        typeof payload.evidence !== "string" ||
        !payload.evidence.trim() ||
        !chapter.content.includes(payload.evidence)
      )
        return false;
      return workflows.some(
        (workflow) =>
          workflow.id === payload.sourceWorkflowId &&
          workflow.input.operation === "chapter-memory" &&
          workflow.stage === "applied" &&
          workflow.input.targetId === chapter.id &&
          workflow.input.baseVersion === chapter.version,
      );
    }),
  );
  const pending = workflows.find(
    (workflow) => workflow.stage === "awaiting-review",
  );
  const running = workflows.find((workflow) =>
    ["preparing", "generating", "checking", "revising", "rechecking"].includes(
      workflow.stage,
    ),
  );
  const target =
    chapters.find(
      (chapter) => chapter.id === (pending ?? running)?.input.targetId,
    ) ?? chapters.at(-1);
  const chapterPath = (chapterId?: string, section = "chapters") =>
    `/projects/${project.id}?${query({ section, chapterId })}`;
  // A chapter/editor link cannot select an old run: its ordinary workbench
  // loads the latest operation. Use the exact owner-bound review surface;
  // returning to author editing remains an independent, non-mutating action.
  const pathFor = (workflow: (typeof workflows)[number]) =>
    `/tasks?${query({ projectId: project.id, taskId: workflow.taskId, workflowId: workflow.id })}`;
  const failureAcknowledged = (workflow: CreationWorkflow): boolean =>
    input.tasks.some((task) => {
      if (
        task.id !== workflow.taskId ||
        task.projectId !== project.id ||
        task.attentionStatus !== "acknowledged" ||
        !["failed", "interrupted"].includes(task.status)
      )
        return false;
      const result =
        task.result &&
        typeof task.result === "object" &&
        !Array.isArray(task.result)
          ? (task.result as Record<string, unknown>)
          : {};
      return (
        result.creationWorkflowId === undefined ||
        result.creationWorkflowId === workflow.id
      );
    });
  const pendingConflict =
    pending &&
    ((pending.input.targetId &&
      !chapters.some((chapter) => chapter.id === pending.input.targetId)) ||
      pending.sources.some((source) =>
        source.kind === "chapter"
          ? !chapters.some(
              (chapter) =>
                chapter.id === source.id && chapter.version === source.version,
            )
          : source.kind === "project" &&
            (source.id !== project.id || source.version !== project.version),
      ));
  const coverage: ProjectCockpit["coverage"] = [
    { label: "章节", current: chapters.length },
    { label: "已保存正文", current: saved.length },
    ...(novel
      ? [
          { label: "当前版本 AI 采用", current: adopted.length },
          { label: "当前版本事实记忆", current: synced.length },
        ]
      : []),
  ];
  const manuscript = novel?.manuscripts
    ?.filter((item) => item.manifest.projectId === project.id)
    .slice()
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )[0];
  const manuscriptCurrent =
    manuscript &&
    manuscript.sourceState === "current" &&
    manuscript.manifest.projectVersion === project.version &&
    manuscript.manifest.chapters.every((source) =>
      chapters.some(
        (chapter) =>
          chapter.id === source.id &&
          chapter.version === source.version &&
          chapter.orderIndex === source.orderIndex,
      ),
    ) &&
    (manuscript.manifest.scope !== "whole-project" ||
      (chapters.length === manuscript.manifest.chapters.length &&
        chapters.every(
          (chapter, index) =>
            chapter.id === manuscript.manifest.chapters[index]?.id,
        )));
  const manuscriptSaved =
    manuscriptCurrent &&
    manuscript.status === "saved" &&
    manuscript.rights?.confirmed === true &&
    manuscript.receipt?.artifactRef &&
    manuscript.receipt.sha256 === manuscript.manifest.contentSha256 &&
    manuscript.receipt.byteSize === manuscript.manifest.byteSize &&
    manuscript.receipt.savedAt;
  const gates: NonNullable<ProjectCockpit["gates"]> = [
    {
      id: "novel-adoption",
      label: "正文与章节采用",
      status: !novel
        ? "unverified"
        : pendingConflict
          ? "stale"
          : pending
            ? "needs-human"
            : !saved.length
              ? "pending"
              : hasOldAdoption
                ? "stale"
                : "ready",
      statusLabel: !novel
        ? "正在核验"
        : pendingConflict
          ? "候选来源已变化"
          : pending
            ? "候选待明确采用"
            : !saved.length
              ? "等待正文"
              : hasOldAdoption
                ? "采用后有新版本"
                : adopted.length === saved.length
                  ? "当前正文已采用"
                  : "作者稿已保存",
      detail: !novel
        ? "正在读取 Writing 正式采用记录；保存或任务成功不等于 AI 采用。"
        : `${saved.length} 章已保存；其中 ${adopted.length} 章当前版本有正式 AI 采用记录。作者原稿可独立继续与导出，不强制 AI 改写。${target ? ` 当前章节：${target.title}，v${target.version}。` : ""}`,
      to: pending ? pathFor(pending) : chapterPath(target?.id),
    },
    {
      id: "novel-memory",
      label: "连续性事实记忆",
      status: !novel
        ? "unverified"
        : synced.length && synced.length === saved.length
          ? "ready"
          : running?.input.operation === "chapter-memory"
            ? "working"
            : pending?.input.operation === "chapter-memory"
              ? "needs-human"
              : "pending",
      statusLabel: !novel
        ? "正在核验"
        : synced.length && synced.length === saved.length
          ? "当前版本已同步"
          : "尚有未同步章节",
      detail: !novel
        ? "正在核对记忆的来源版本、工作流与正文证据。"
        : `${synced.length}/${saved.length} 章有对应当前正文版本的事实记忆；旧版本、缺证据或已删除的记忆不算同步。不代表已通过文学质量评测。`,
      to:
        pending?.input.operation === "chapter-memory"
          ? pathFor(pending)
          : running?.input.operation === "chapter-memory"
            ? pathFor(running)
            : chapterPath(
                saved.find(
                  (chapter) => !synced.some((item) => item.id === chapter.id),
                )?.id ?? target?.id,
              ),
    },
    {
      id: "novel-manuscript",
      label: "稿件与投稿导出",
      status: !manuscript
        ? "unverified"
        : !manuscriptCurrent
          ? "stale"
          : manuscriptSaved
            ? "ready"
            : manuscript.status === "awaiting-confirmation"
              ? "needs-human"
              : manuscript.status === "saving"
                ? "working"
                : "pending",
      statusLabel: !manuscript
        ? "尚无核验保存回执"
        : !manuscriptCurrent
          ? "已导出来源有新版本"
          : manuscriptSaved
            ? manuscript.manifest.scope === "whole-project"
              ? "完整稿件已核验保存"
              : "所选范围已核验保存"
            : manuscript.status === "awaiting-confirmation"
              ? "范围与权利待确认"
              : manuscript.status === "saving"
                ? "保存结果待确定"
                : manuscript.status === "canceled"
                  ? "已取消保存"
                  : "保存结果未核验",
      detail: manuscript
        ? `${manuscript.manifest.chapters.length}/${chapters.length} 章，${manuscript.manifest.scope === "whole-project" ? "完整范围" : "仅所选范围，不代表全稿"}；清单固定章节版本与文件摘要。${manuscriptSaved ? "作者已确认范围/权利，Host 实际写入摘要与字节数匹配。回执证明当时保存成功，不监控外部文件后续变化。" : "预览、旧版本、取消或缺失回执不算当前成功交付。"}不要求改编、分镜或媒体。`
        : "在输入输出中生成投稿稿件预览，明确确认章节范围与导出权利；Host 核验实际写入文件后才记录成功交付。旧兼容导出不制造正式回执。不要求改编、分镜或媒体。",
      to: manuscript
        ? `${chapterPath(target?.id)}&manuscriptId=${manuscript.id}`
        : chapterPath(target?.id),
    },
  ];
  const result = (
    status: ProjectCockpitStatus,
    statusLabel: string,
    action: ProjectCockpitAction,
    blockers: string[],
    recentResult: string,
  ): ProjectCockpit => ({
    status,
    statusLabel,
    primaryAction: action,
    blockers,
    recentResult,
    coverage,
    gates,
  });
  // Candidates are the result awaiting an author's decision, not a completed
  // task that can be hidden behind unrelated historical failures.
  if (pending)
    return result(
      pendingConflict ? "needs-attention" : "needs-human",
      pendingConflict ? "小说候选来源已变化" : "有小说候选待采用",
      {
        label: pendingConflict
          ? "核对过期小说候选"
          : pending.input.operation === "chapter-memory"
            ? "审阅事实记忆"
            : "审阅小说候选",
        description:
          "返回原任务的指定运行，比较原稿与候选后明确采用或放弃；不会自动覆盖正文。",
        to: pathFor(pending),
      },
      pendingConflict
        ? [
            "候选引用的章节或项目版本已变化；请返回原对象核对来源，不能直接覆盖当前正文。",
          ]
        : pending.error
          ? [pending.error]
          : [],
      `待确认：${pending.output?.title || pending.input.instruction}`,
    );
  if (running)
    return result(
      "working",
      "正在生成与检查",
      {
        label: "查看当前小说创作",
        description: "返回原任务的指定运行查看进度；完成后仍需明确采用。",
        to: pathFor(running),
      },
      [],
      `正在处理：${running.input.instruction}`,
    );
  if (
    manuscript &&
    ["awaiting-confirmation", "saving"].includes(manuscript.status)
  )
    return result(
      !manuscriptCurrent
        ? "needs-attention"
        : manuscript.status === "saving"
          ? "working"
          : "needs-human",
      !manuscriptCurrent
        ? "稿件来源已变化"
        : manuscript.status === "saving"
          ? "稿件保存结果待确定"
          : "稿件范围与权利待确认",
      {
        label: "核对稿件交付",
        description:
          "返回这份稿件的实际清单与保存状态；预览不等于保存成功，不自动重做保存。",
        to: `${chapterPath(target?.id)}&manuscriptId=${manuscript.id}`,
      },
      manuscriptCurrent ? [] : manuscript.sourceIssues,
      `稿件：${manuscript.manifest.fileName}`,
    );
  const failure = latest.find(
    (workflow) =>
      ["failed", "interrupted"].includes(workflow.stage) &&
      !failureAcknowledged(workflow),
  );
  if (failure)
    return result(
      "needs-attention",
      "小说创作需要处理",
      {
        label: "处理小说创作失败",
        description: "回到原对象核对失败原因并按需重试，已有稿件不受影响。",
        to: pathFor(failure),
      },
      [failure.error ?? "创作运行失败或中断。"],
      "已有正文与采用记录保留。",
    );
  const task = input.tasks.find(
    (item) =>
      item.projectId === project.id &&
      (["queued", "running"].includes(item.status) ||
        (["failed", "interrupted"].includes(item.status) &&
          item.attentionStatus !== "acknowledged")),
  );
  if (task)
    return result(
      ["queued", "running"].includes(task.status)
        ? "working"
        : "needs-attention",
      "有项目任务需要查看",
      {
        label: "查看项目任务",
        description: "任务状态不代替章节采用、记忆同步或稿件保存结果。",
        to: `/tasks?${query({ projectId: project.id, taskId: task.id })}`,
      },
      [task.title],
      "小说稿件和正式记录保留。",
    );
  const currentAdopted = adopted.find((chapter) => chapter.id === target?.id);
  if (currentAdopted) {
    const currentSynced = synced.some((chapter) => chapter.id === target?.id);
    return result(
      currentSynced ? "ready-for-review" : "needs-input",
      currentSynced ? "可以继续下一章" : "核对本章连续性",
      {
        label: currentSynced ? "继续下一章" : "核对本章事实记忆",
        description: currentSynced
          ? "当前章节已明确采用且事实记忆对应当前版本；可续写下一章，也可按目标导出稿件。不要求改编或媒体制作。"
          : "当前章节已有正式采用记录，但事实记忆未核验为当前版本；回到本章核对或重试记忆，仍可维护作者稿。",
        to: chapterPath(target?.id),
      },
      [],
      `最近章节：${target!.title}（正式采用 v${target!.version}）`,
    );
  }
  return result(
    "needs-input",
    chapters.length ? "继续创作母本" : "准备 AI 创作",
    {
      label: chapters.length ? "继续 AI 创作" : "AI 生成第一章",
      description:
        "继续作者稿或生成本章候选，审阅后明确采用；也可以导出小说稿件，不要求改编或媒体制作。",
      to:
        chapters.length && novel
          ? chapterPath(target?.id)
          : `/projects/${project.id}`,
    },
    [],
    target
      ? `最近章节：${target.title}（${novel ? `已保存 v${target.version}，未核验为当前 AI 采用` : "已保存；正式采用状态正在核验"}）`
      : "项目已创建，等待小说规划与章节正文。",
  );
}

function cockpit(
  status: ProjectCockpitStatus,
  statusLabel: string,
  primaryAction: ProjectCockpitAction,
  blockers: string[],
  coverage: ProjectCockpit["coverage"],
  recentResult: string,
): ProjectCockpit {
  return {
    status,
    statusLabel,
    primaryAction,
    blockers,
    coverage,
    recentResult,
  };
}

function count(graph: ProductionGraph, kind: string): number {
  return graph.nodes.filter((node) => node.kind === kind).length;
}

function firstId(graph: ProductionGraph, kind: string): string | undefined {
  return graph.nodes.find((node) => node.kind === kind)?.id;
}

function query(values: Record<string, string | undefined>): string {
  return new URLSearchParams(
    Object.entries(values).flatMap(([key, value]) =>
      value ? [[key, value]] : [],
    ),
  ).toString();
}

function recentTaskOrNode(tasks: Task[], graph: ProductionGraph): string {
  const completed = tasks.find((task) => task.status === "succeeded");
  if (completed) return `最近完成：${completed.title}`;
  const node = graph.nodes.at(-1);
  return node
    ? `最近资料：${node.title}（${node.status}）`
    : "尚未产生可确认的生产结果。";
}
