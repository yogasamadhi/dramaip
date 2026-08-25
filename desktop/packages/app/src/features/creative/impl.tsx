import { BareButton } from "@dramaip/ui-shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WorkspaceIntro, message, useStudio } from "../../studio-shared";
import {
  CreativeDiagnosticsPanel,
  PluginResourceWorkspace,
  StoryBibleChangeSetPanel,
} from "../studio-widgets";
export function CreativeWorkspace() {
  return (
    <div className="space-y-5">
      <WorkspaceIntro
        eyebrow="小说与故事开发"
        title="创作工作区"
        description="把故事圣经、章节分析、人物关系和创意诊断集中在同一个上下文中。"
        badge="智能创作"
      />
      <StoryBibleChangeSetPanel />
      <ChapterAnalysisPanel />
      <CreativeDiagnosticsPanel />
      <PluginResourceWorkspace
        owner="writing"
        title="人物与故事结构"
        domains={["characters", "outlines", "story-arcs"]}
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
      />
    </div>
  );
}

export function ChapterAnalysisPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [notice, setNotice] = useState<string>();
  const { data: chapters = [] } = useQuery({
    queryKey: ["analysis-chapters", projectId],
    queryFn: () => client.chapters.list(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
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
        <h2 className="font-semibold">章节自动分析</h2>
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
              setProjectId(event.target.value);
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
            执行章节分析
          </BareButton>
        </div>
      </div>
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
    </section>
  );
}
