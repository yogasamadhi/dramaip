import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { UiContribution } from "@dramaip/plugin-api";
import { Button, Card, PageHeader, Select } from "@dramaip/ui";
import { ErrorPanel, useStudioClient } from "@dramaip/ui-shared";

interface Project {
  id: string;
  name: string;
}

interface Chapter {
  id: string;
  title: string;
  content: string;
  version: number;
}

interface StoryBibleSettings {
  projectId: string;
  autoSuggest: boolean;
  version: number;
}

interface ChangeSet {
  id: string;
  rationale: string;
  status: string;
  version: number;
  items: readonly { id: string }[];
}

interface QualityRecord {
  id: string;
  title: string;
  status: string;
  data: Record<string, unknown>;
  version: number;
}

const diagnosticKinds = [
  ["新鲜度", "freshness"],
  ["反套路", "anti-cliche"],
  ["质量门禁", "quality-gate"],
  ["受众模拟", "audience"],
  ["叙事曲线", "narrative-curve"],
] as const;

function CreativeQualityPage() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [memoryChapterId, setMemoryChapterId] = useState("");
  const [analysisChapterId, setAnalysisChapterId] = useState("");
  const [diagnosticChapterId, setDiagnosticChapterId] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<string[]>([
    "freshness",
    "quality-gate",
    "audience",
    "narrative-curve",
  ]);
  const [notice, setNotice] = useState("");

  const projects = useQuery({
    queryKey: ["creative-quality", "projects"],
    queryFn: () =>
      client.request<{ items: Project[] }>("/api/v2/workspace/projects"),
  });
  const activeProjectId = projectId || projects.data?.items[0]?.id || "";
  const chapters = useQuery({
    queryKey: ["creative-quality", "chapters", activeProjectId],
    queryFn: () =>
      client.request<{ items: Chapter[] }>(
        `/api/v2/writing/projects/${activeProjectId}/chapters`,
      ),
    enabled: Boolean(activeProjectId),
  });
  const settings = useQuery({
    queryKey: ["creative-quality", "story-bible-settings", activeProjectId],
    queryFn: () =>
      client.request<StoryBibleSettings>(
        `/api/v2/knowledge/projects/${activeProjectId}/story-bible/settings`,
      ),
    enabled: Boolean(activeProjectId),
  });
  const changeSets = useQuery({
    queryKey: ["creative-quality", "change-sets", activeProjectId],
    queryFn: () =>
      client.request<{ items: ChangeSet[] }>(
        `/api/v2/knowledge/projects/${activeProjectId}/story-bible/change-sets`,
      ),
    enabled: Boolean(activeProjectId),
  });
  const diagnostics = useQuery({
    queryKey: ["creative-quality", "diagnostics", activeProjectId],
    queryFn: () =>
      client.request<{ items: QualityRecord[] }>(
        `/api/v2/creative-quality/diagnostics?projectId=${activeProjectId}`,
      ),
    enabled: Boolean(activeProjectId),
  });

  useEffect(() => {
    setMemoryChapterId("");
    setAnalysisChapterId("");
    setDiagnosticChapterId("");
  }, [activeProjectId]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["creative-quality", "change-sets", activeProjectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["creative-quality", "diagnostics", activeProjectId],
      }),
    ]);
  };

  const updateSettings = useMutation({
    mutationFn: (autoSuggest: boolean) =>
      client.request<StoryBibleSettings>(
        `/api/v2/knowledge/projects/${activeProjectId}/story-bible/settings`,
        {
          method: "PUT",
          headers: { "if-match": `"v${settings.data?.version ?? 1}"` },
          body: JSON.stringify({ autoSuggest }),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["creative-quality", "story-bible-settings", activeProjectId],
      });
    },
  });

  const createMemoryDraft = useMutation({
    mutationFn: async () => {
      const chapter = chapters.data?.items.find(
        (item) => item.id === memoryChapterId,
      );
      if (!chapter) throw new Error("请先选择包含正文的章节。");
      return client.request("/api/v2/knowledge/change-sets", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          projectId: activeProjectId,
          chapterId: chapter.id,
          rationale: `根据「${chapter.title}」生成章节记忆更新`,
          changes: [
            {
              targetKind: "story-bible",
              operation: "create",
              title: `${chapter.title} · 章节记忆`,
              patch: {
                world: chapter.content.slice(0, 600),
                rules: [],
                themes: [],
                events: [],
                foreshadowing: [],
              },
            },
          ],
        }),
      });
    },
    onSuccess: async () => {
      setNotice("已生成待确认草案；采用前不会修改任何权威资料。");
      await refresh();
    },
  });

  const createAnalysis = useMutation({
    mutationFn: async () => {
      const chapter = chapters.data?.items.find(
        (item) => item.id === analysisChapterId,
      );
      if (!chapter) throw new Error("请先选择已写入正文的章节。");
      return client.request<QualityRecord>(
        "/api/v2/creative-quality/analyses",
        {
          method: "POST",
          body: JSON.stringify({
            projectId: activeProjectId,
            title: `${chapter.title} · 自动分析`,
            data: (() => {
              const words = chapter.content
                .trim()
                .split(/\s+/)
                .filter(Boolean).length;
              const paragraphs = chapter.content
                .split(/\n{2,}/)
                .filter((item) => item.trim()).length;
              const pacing = Math.min(
                100,
                Math.round((paragraphs / Math.max(1, words / 120)) * 50),
              );
              const highlight = Math.min(
                100,
                Math.round(Math.min(1, words / 800) * 100),
              );
              const feasibility = chapter.content.length > 0 ? 100 : 0;
              return {
                targetId: chapter.id,
                dimensions: { pacing, highlight, feasibility },
                narrative: `基于 ${words} 个词元和 ${paragraphs} 个段落计算；请结合正文继续审阅。`,
              };
            })(),
          }),
        },
      );
    },
    onSuccess: () => setNotice("章节分析已保存为可编辑的本地资料。"),
  });

  const createDiagnostic = useMutation({
    mutationFn: () =>
      client.request<QualityRecord>("/api/v2/creative-quality/diagnostics", {
        method: "POST",
        body: JSON.stringify({
          projectId: activeProjectId,
          title: "创意诊断",
          data: {
            targetId: diagnosticChapterId || activeProjectId,
            issues: selectedKinds.map((kind) => ({
              severity: "info",
              code: kind,
              message: "等待本地规则审阅",
            })),
          },
        }),
      }),
    onSuccess: async () => {
      setNotice("创意诊断已保存，可继续逐项确认问题与建议。");
      await refresh();
    },
  });

  const changeSetAction = useMutation({
    mutationFn: ({ item, verb }: { item: ChangeSet; verb: "apply" | "undo" }) =>
      client.request(
        `/api/v2/knowledge/change-sets/${item.id}/actions/${verb}`,
        {
          method: "POST",
          headers: {
            "if-match": `"v${item.version}"`,
            "idempotency-key": crypto.randomUUID(),
          },
          body:
            verb === "apply"
              ? JSON.stringify({
                  selectedItemIds: item.items.map((entry) => entry.id),
                })
              : undefined,
        },
      ),
    onSuccess: refresh,
  });

  const projectOptions = useMemo(
    () =>
      (projects.data?.items ?? []).map((project) => ({
        value: project.id,
        label: project.name,
      })),
    [projects.data],
  );
  const chapterOptions = useMemo(
    () =>
      (chapters.data?.items ?? []).map((chapter) => ({
        value: chapter.id,
        label: chapter.title,
      })),
    [chapters.data],
  );
  const failure =
    projects.error ??
    chapters.error ??
    settings.error ??
    changeSets.error ??
    diagnostics.error ??
    updateSettings.error ??
    createMemoryDraft.error ??
    createAnalysis.error ??
    createDiagnostic.error ??
    changeSetAction.error;

  return (
    <section className="page-stack creative-workspace">
      <PageHeader
        eyebrow="小说与故事开发"
        title="创作工作区"
        description="把故事圣经、章节分析、人物关系和创意诊断集中在同一个上下文中。"
        actions={<span className="creative-badge">智能创作</span>}
      />

      <Card className="creative-panel story-memory-panel">
        <div className="creative-panel-heading">
          <div>
            <p>故事圣经</p>
            <h2>可审查的章节记忆更新</h2>
            <small>
              基于已保存的章节正文生成摘要草案。采用前不会写入资料；采用后只创建可追溯的章节记忆，正文更新会使旧草案标记为待复核。
            </small>
          </div>
          <label className="creative-toggle">
            <input
              type="checkbox"
              checked={settings.data?.autoSuggest ?? false}
              disabled={!activeProjectId || updateSettings.isPending}
              onChange={(event) => updateSettings.mutate(event.target.checked)}
            />
            保存正文后自动建议
          </label>
        </div>
        <div className="creative-action-grid memory-grid">
          <label>
            项目
            <Select
              aria-label="章节记忆项目"
              value={activeProjectId}
              options={projectOptions}
              placeholder="选择项目"
              onValueChange={setProjectId}
            />
          </label>
          <label>
            章节
            <Select
              aria-label="章节记忆章节"
              value={memoryChapterId}
              options={chapterOptions}
              placeholder="选择包含正文的章节"
              onValueChange={setMemoryChapterId}
            />
          </label>
          <Button
            variant="primary"
            disabled={!memoryChapterId}
            loading={createMemoryDraft.isPending}
            onClick={() => createMemoryDraft.mutate()}
          >
            生成待确认草案
          </Button>
        </div>
        <div className="creative-records">
          {changeSets.data?.items.map((item) => (
            <article key={item.id}>
              <span>{item.rationale || "Story Bible 变更草案"}</span>
              <div>
                {item.status === "queued" ? (
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() =>
                      changeSetAction.mutate({ item, verb: "apply" })
                    }
                  >
                    选择采用
                  </Button>
                ) : null}
                {item.status === "applied" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      changeSetAction.mutate({ item, verb: "undo" })
                    }
                  >
                    撤销采用
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
          {!changeSets.data?.items.length ? (
            <p>尚无变更草案。选择一个已写入正文的章节后生成。</p>
          ) : null}
        </div>
      </Card>

      <Card className="creative-panel chapter-analysis-panel">
        <div className="creative-panel-heading">
          <div>
            <h3>章节自动分析</h3>
            <small>
              基于已保存正文提取节拍、高光、可制作性和章节评估，结果均为可编辑的本地资料。
            </small>
          </div>
        </div>
        <div className="creative-action-grid analysis-grid">
          <label>
            项目
            <Select
              aria-label="章节分析项目"
              value={activeProjectId}
              options={projectOptions}
              placeholder="选择项目"
              onValueChange={setProjectId}
            />
          </label>
          <label>
            章节
            <Select
              aria-label="章节分析章节"
              value={analysisChapterId}
              options={chapterOptions}
              placeholder="选择已写入正文的章节"
              onValueChange={setAnalysisChapterId}
            />
          </label>
          <Button
            variant="primary"
            disabled={!analysisChapterId}
            loading={createAnalysis.isPending}
            onClick={() => createAnalysis.mutate()}
          >
            执行章节分析
          </Button>
        </div>
      </Card>

      <Card className="creative-panel diagnostic-panel">
        <div className="creative-panel-heading">
          <div>
            <p>创意质量</p>
            <h2>可审阅的创意诊断</h2>
            <small>
              本地规则基于已保存资料生成新鲜度、反套路、质量门禁、受众模拟与叙事曲线。它们只是辅助判断，不会自动改写小说、剧本或分镜。
            </small>
          </div>
        </div>
        <div className="creative-action-grid diagnostic-grid">
          <label>
            项目
            <Select
              aria-label="创意诊断项目"
              value={activeProjectId}
              options={projectOptions}
              placeholder="选择项目"
              onValueChange={setProjectId}
            />
          </label>
          <label>
            诊断目标
            <Select
              aria-label="创意诊断目标"
              value={diagnosticChapterId}
              options={chapterOptions}
              placeholder="整个项目"
              onValueChange={setDiagnosticChapterId}
            />
          </label>
          <Button
            variant="primary"
            disabled={!activeProjectId || !selectedKinds.length}
            loading={createDiagnostic.isPending}
            onClick={() => createDiagnostic.mutate()}
          >
            生成创意诊断
          </Button>
        </div>
        <div className="diagnostic-kinds">
          {diagnosticKinds.map(([label, value]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={selectedKinds.includes(value)}
                onChange={() =>
                  setSelectedKinds((items) =>
                    items.includes(value)
                      ? items.filter((item) => item !== value)
                      : [...items, value],
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
        <div className="creative-records">
          {diagnostics.data?.items.map((item) => (
            <article key={item.id}>
              <span>{item.title}</span>
              <small>
                {item.status} · v{item.version}
              </small>
            </article>
          ))}
          {!diagnostics.data?.items.length ? <p>尚无诊断报告。</p> : null}
        </div>
      </Card>

      {notice ? <p className="creative-notice">{notice}</p> : null}
      {failure ? <ErrorPanel error={failure} /> : null}
    </section>
  );
}

export const creativeQualityUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "creative-quality.workspace",
    pluginId: "creative-quality",
    path: "/create",
    title: "创作与诊断",
    component: async () => ({ default: CreativeQualityPage }),
  },
];
