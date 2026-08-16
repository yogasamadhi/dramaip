import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { UiContribution } from "@dramaip/plugin-api";
import {
  Button,
  Card,
  Input,
  PageHeader,
  Select,
  Tabs,
  Textarea,
} from "@dramaip/ui";
import { EmptyPanel, ErrorPanel, useStudioClient } from "@dramaip/ui-shared";

interface Project {
  id: string;
  name: string;
}
interface InsightRecord {
  id: string;
  title: string;
  status: string;
  version: number;
  data: Record<string, unknown>;
}

const sections = [
  { path: "feedback", label: "反馈导入" },
  { path: "clusters", label: "评论聚类" },
  { path: "production-graphs", label: "生产图" },
  { path: "impact-analyses", label: "影响分析" },
  { path: "generation-ledger", label: "生成账本" },
] as const;

function valueFor(path: string, body: string) {
  if (path === "feedback")
    return { source: "本地导入", body, receivedAt: new Date().toISOString() };
  if (path === "clusters")
    return {
      feedbackIds: [],
      label: body || "待聚类",
      summary: "",
      confidence: 0,
    };
  if (path === "production-graphs") return { nodes: [], edges: [] };
  if (path === "impact-analyses")
    return {
      changeSetId: "local",
      impactedIds: [],
      risk: "low",
      explanation: body,
    };
  return {
    provider: "local",
    model: "manual",
    inputTokens: 0,
    outputTokens: 0,
    costMicros: 0,
    runId: crypto.randomUUID(),
  };
}

function InsightsWorkspace() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [path, setPath] = useState("feedback");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const projects = useQuery({
    queryKey: ["workspace", "projects"],
    queryFn: () =>
      client.request<{ items: Project[] }>("/api/v2/workspace/projects"),
  });
  const activeProject = projectId || projects.data?.items[0]?.id || "";
  const records = useQuery({
    queryKey: ["insights", path, activeProject],
    queryFn: () =>
      client.request<{ items: InsightRecord[] }>(
        `/api/v2/insights/${path}?projectId=${activeProject}`,
      ),
    enabled: Boolean(activeProject),
  });
  const create = useMutation({
    mutationFn: () =>
      client.request(`/api/v2/insights/${path}`, {
        method: "POST",
        body: JSON.stringify({
          projectId: activeProject,
          title: title.trim(),
          data: valueFor(path, body),
        }),
      }),
    onSuccess: async () => {
      setTitle("");
      setBody("");
      await queryClient.invalidateQueries({
        queryKey: ["insights", path, activeProject],
      });
    },
  });
  const activeLabel = sections.find((item) => item.path === path)?.label;
  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="INSIGHTS"
        title="数据洞察"
        description="导入指标和评论，聚类反馈，生成修订任务，并从生产依赖图评估改动影响与成本。"
        actions={
          <Select
            aria-label="选择项目"
            value={activeProject}
            options={(projects.data?.items ?? []).map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            onValueChange={setProjectId}
          />
        }
      />
      <Tabs value={path} onValueChange={setPath}>
        <Tabs.List>
          {sections.map((item) => (
            <Tabs.Trigger key={item.path} value={item.path}>
              {item.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Card className="mt-4 grid gap-3">
          <Input
            value={title}
            placeholder={`${activeLabel}名称`}
            onChange={(event) => setTitle(event.target.value)}
          />
          {(path === "feedback" || path === "impact-analyses") && (
            <Textarea
              value={body}
              placeholder={
                path === "feedback" ? "粘贴评论或指标说明" : "描述待评估的改动"
              }
              onChange={(event) => setBody(event.target.value)}
            />
          )}
          <Button
            className="justify-self-start"
            variant="primary"
            disabled={!activeProject || !title.trim()}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            保存并分析
          </Button>
        </Card>
        {(records.error || create.error) && (
          <ErrorPanel error={records.error ?? create.error} />
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {records.data?.items.map((record) => (
            <Card key={record.id}>
              <small className="text-muted">
                {record.status} · v{record.version}
              </small>
              <h2 className="mt-2 text-lg font-semibold">{record.title}</h2>
              <p className="mt-2 line-clamp-6 text-sm leading-6 text-muted">
                {JSON.stringify(record.data)}
              </p>
            </Card>
          ))}
          {!records.data?.items.length && (
            <EmptyPanel>当前项目还没有{activeLabel}数据。</EmptyPanel>
          )}
        </div>
      </Tabs>
    </section>
  );
}

export const insightsUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "insights.workspace",
    pluginId: "insights",
    path: "/insights",
    title: "数据洞察",
    component: async () => ({ default: InsightsWorkspace }),
  },
  {
    kind: "navigation",
    id: "insights.navigation",
    pluginId: "insights",
    section: "settings",
    order: 5,
    label: "数据洞察",
    to: "/insights",
  },
];
