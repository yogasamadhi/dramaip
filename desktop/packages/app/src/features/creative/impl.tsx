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
      <StoryIntelligencePanel />
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

function StoryIntelligencePanel() {
  const client = useStudio();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [notice, setNotice] = useState<string>();
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  const { data: graph, refetch } = useQuery({
    queryKey: ["story-intelligence", projectId],
    queryFn: () => client.storyIntelligence.graph(projectId),
    enabled: Boolean(projectId),
  });
  const { data: risks = [] } = useQuery({
    queryKey: ["originality-risks", projectId],
    queryFn: () => client.storyIntelligence.originalityRisks(projectId),
    enabled: Boolean(projectId),
  });

  const addNode = async () => {
    if (!projectId) return;
    const title = window.prompt("人物、事件、秘密或规则名称")?.trim();
    if (!title) return;
    const kind = (window.prompt(
      "类型：character / event / secret / rule / location / organization / resource / relationship / inspiration",
      "event",
    ) ?? "event") as
      | "character"
      | "event"
      | "secret"
      | "rule"
      | "location"
      | "organization"
      | "resource"
      | "relationship"
      | "inspiration";
    await client.storyIntelligence.createNode(projectId, {
      kind,
      title,
      summary: window.prompt("简要说明", "") ?? "",
      sourceType: "manual",
      sourceId: crypto.randomUUID(),
      sourceVersion: 0,
      confirmed: true,
    });
    await refetch();
  };

  const simulate = async () => {
    if (!projectId || !hypothesis.trim()) return;
    setRunning(true);
    setNotice(undefined);
    try {
      const twin = await client.storyIntelligence.buildTwin(projectId);
      const result = await client.storyIntelligence.createSimulation(
        projectId,
        { snapshotId: twin.id, hypothesis: hypothesis.trim() },
      );
      setNotice(
        `已创建只读推演：${result.deterministicFindings.join("；")} 未确认前不会修改故事圣经。`,
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">IP 数字孪生与因果模拟</h2>
          <p className="mt-1 text-sm text-muted">
            由已确认知识构建只读快照，分开显示确定性冲突和模型推断；模拟不会直接改写项目。
          </p>
        </div>
        <BareButton
          className="rounded-lg border border-line px-3 py-2 text-sm"
          disabled={!projectId}
          onClick={() => void addNode()}
        >
          添加知识节点
        </BareButton>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[260px_minmax(0,1fr)_auto]">
        <select
          className="rounded-lg border border-line px-3 py-2 text-sm"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">选择项目</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
        <input
          className="rounded-lg border border-line px-3 py-2 text-sm"
          value={hypothesis}
          onChange={(event) => setHypothesis(event.target.value)}
          placeholder="例如：如果反派在第三章就知道主角的秘密……"
        />
        <BareButton
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!projectId || !hypothesis.trim() || running}
          onClick={() => void simulate()}
        >
          {running ? "推演中…" : "创建推演"}
        </BareButton>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Stat label="知识节点" value={graph?.nodes.length ?? 0} />
        <Stat label="因果关系" value={graph?.edges.length ?? 0} />
        <Stat label="认知状态" value={graph?.audienceStates.length ?? 0} />
        <Stat label="原创性复核" value={risks.length} />
      </div>
      {notice && (
        <p className="mt-3 rounded-lg bg-brand-soft p-3 text-sm text-brand">
          {notice}
        </p>
      )}
      {risks.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <strong>原创性账本只提供复核线索，不构成侵权或法律结论。</strong>
          {risks.slice(0, 3).map((risk) => (
            <p key={risk.id} className="mt-1 text-muted">
              {risk.reason}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat(props: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-subtle p-3 text-sm">
      <span className="block text-xs text-muted">{props.label}</span>
      <strong className="text-lg">{props.value}</strong>
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
