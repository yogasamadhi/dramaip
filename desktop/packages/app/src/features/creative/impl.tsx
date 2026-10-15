import { CreationWorkbench } from "../creation-workbench";
import { NarrativePlanningWorkbench } from "../novel/NarrativePlanningWorkbench";
import { StoryIntelligencePanel } from "./StoryIntelligencePanel";
import { BareButton } from "@dramaip/ui-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { WorkspaceIntro, message, useStudio } from "../../studio-shared";
import { useStudioSession } from "../../studio-session";
import {
  CreativeDiagnosticsPanel,
  PluginResourceWorkspace,
  StoryBibleChangeSetPanel,
} from "../studio-widgets";
export function CreativeWorkspace() {
  const location = useLocation();
  const requestedChangeSetId = new URLSearchParams(location.search).get(
    "changeSetId",
  );
  const session = useStudioSession();
  const projectId =
    new URLSearchParams(location.search).get("projectId") ??
    session.activeProjectId;
  return (
    <div className="space-y-5">
      <WorkspaceIntro
        title="创作分析"
        description="故事圣经、章节分析、人物关系和创意诊断集中在一处。"
      />
      {projectId && (
        <NarrativePlanningWorkbench
          projectId={projectId}
          operation="knowledge-plan"
        />
      )}
      <details
        key={requestedChangeSetId ?? "all-changes"}
        open={requestedChangeSetId ? true : undefined}
        className="rounded-lg border border-line p-4"
      >
        <summary className="cursor-pointer text-sm">已有变更提案</summary>
        <StoryBibleChangeSetPanel projectId={projectId} />
      </details>
      <ChapterAnalysisPanel projectId={projectId} />
      <CreativeDiagnosticsPanel projectId={projectId} />
      <StoryIntelligencePanel
        key={projectId ?? "no-project"}
        projectId={projectId}
      />
      <details className="rounded-lg border border-line p-4">
        <summary className="cursor-pointer text-sm">资料管理与人工补充</summary>
        <PluginResourceWorkspace
          owner="writing"
          title="人物与故事结构"
          domains={["characters", "outlines", "story-arcs"]}
          projectId={projectId}
        />
        <PluginResourceWorkspace
          owner="knowledge"
          title="故事知识与连续性"
          domains={[
            "story",
            "memory",
            "chapter-memories",
            "character-states",
            "visual-profiles",
            "visual-settings",
            "story-events",
            "foreshadowings",
          ]}
          projectId={projectId}
        />
        <PluginResourceWorkspace
          owner="automation"
          title="创作自动化"
          domains={[
            "project-skills",
            "agent-schemes",
            "inspirations",
            "templates",
          ]}
          projectId={projectId}
        />
        <PluginResourceWorkspace
          owner="creative-quality"
          title="创意质量"
          domains={[
            "analysis",
            "beats",
            "highlights",
            "feasibility",
            "trends",
            "evaluations",
          ]}
          projectId={projectId}
        />
      </details>
    </div>
  );
}

export function ChapterAnalysisPanel(props: { projectId?: string } = {}) {
  const client = useStudio();
  const session = useStudioSession();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState(props.projectId ?? "");
  const [chapterId, setChapterId] = useState("");
  const [notice, setNotice] = useState<string>();
  const { data: chapters = [] } = useQuery({
    queryKey: ["analysis-chapters", projectId],
    queryFn: () => client.chapters.list(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (props.projectId && projectId !== props.projectId) {
      setProjectId(props.projectId);
      setChapterId("");
    }
  }, [projectId, props.projectId]);
  useEffect(() => {
    if (chapterId && !chapters.some((chapter) => chapter.id === chapterId))
      setChapterId("");
  }, [chapterId, chapters]);
  const run = async () => {
    if (!chapterId) return;
    setNotice(undefined);
    try {
      const result = await client.analysis.runChapter(chapterId);
      setNotice(
        `已生成 ${result.records.length} 项章节分析，可在下方对应资料区查看。`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["resource"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div>
        <h2 className="font-semibold">章节检查与修订</h2>
        <p className="mt-1 text-sm text-muted">
          基于已保存正文提取节拍、高光、可制作性和章节评估，结果均为可编辑的本地资料。
        </p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="grid gap-1 text-sm">
          项目
          <select
            className="rounded-lg border border-line px-3 py-2"
            value={projectId}
            onChange={(event) => {
              const nextProjectId = event.target.value;
              setProjectId(nextProjectId);
              if (nextProjectId) session.selectProject(nextProjectId);
              setChapterId("");
            }}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          章节
          <select
            className="rounded-lg border border-line px-3 py-2"
            disabled={!projectId}
            value={chapterId}
            onChange={(event) => setChapterId(event.target.value)}
          >
            <option value="">选择已写入正文的章节</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <BareButton
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!chapterId}
            onClick={() => void run()}
          >
            本地规则检查
          </BareButton>
        </div>
      </div>
      {projectId && chapterId && (
        <div className="mt-4">
          <CreationWorkbench
            projectId={projectId}
            targetId={chapterId}
            baseVersion={
              chapters.find((item) => item.id === chapterId)?.version
            }
            operation="chapter"
            defaultInstruction="分析本章人物动机、连续性、节奏和表达，提出有证据的局部修订，保留原作方向，生成候选并检查。"
          />
        </div>
      )}
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}
