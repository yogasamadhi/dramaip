import type { Chapter, ProductionGraph, Project, Task } from "@sdns/schema";

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
};

type CockpitInput = {
  project: Project;
  chapters: Chapter[];
  graph: ProductionGraph;
  tasks: Task[];
};

export function deriveProjectCockpit(input: CockpitInput): ProjectCockpit {
  const { project, chapters, graph } = input;
  const tasks = input.tasks.filter((task) => task.projectId === project.id);
  const failedTasks = tasks.filter((task) =>
    ["failed", "canceled", "interrupted"].includes(task.status),
  );
  const activeTasks = tasks.filter((task) =>
    ["queued", "running"].includes(task.status),
  );
  const coverage = [
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
      required: graph.coverage.stills,
    },
  ];
  const context = query({ projectId: project.id });
  const adaptationId = firstId(graph, "adaptations");
  const episodeId = firstId(graph, "episodes");
  const shotId = firstId(graph, "shots");
  const withAdaptation = query({ projectId: project.id, adaptationId });
  const withEpisode = query({
    projectId: project.id,
    adaptationId,
    episodeId,
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
  if (!chapters.length)
    return cockpit(
      "needs-input",
      "等待内容输入",
      {
        label: "导入已授权原著",
        description: "先选择本地文件并核对预览与使用权；确认前不会写入章节。",
        to: `/projects/${project.id}?intake=source`,
      },
      ["尚未保存章节或剧本正文。"],
      coverage,
      `项目「${project.title}」已创建，等待可信内容输入。`,
    );
  if (!adaptationId)
    return cockpit(
      "needs-input",
      "准备改编",
      {
        label: "创建改编方案",
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
        label: "创建第一集",
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
        label: "编写首集剧本",
        description: "先在当前分集下保存剧本，再继续拆分场景和镜头。",
        to: `/adapt?${withEpisode}&stage=scripts`,
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
        label: "拆分场景和分镜",
        description: "使用当前剧本继续建立场景和镜头，避免跳过制作依据。",
        to: `/adapt?${withEpisode}&stage=scenes`,
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
  if (!graph.coverage.stills || !graph.coverage.adoptedStills)
    return cockpit(
      "needs-human",
      "等待人工确认静帧",
      {
        label: "确认首个静帧",
        description:
          "先查看并采用静帧候选；未采用的视觉方向不能进入后续高成本制作。",
        to: `/produce?${withShot}&stage=shot-stills`,
      },
      [
        graph.coverage.stills
          ? "已有静帧候选，尚未人工采用。"
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
