import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { UiContribution } from "@dramaip/plugin-api";
import { Button, Card, Input, PageHeader, Tabs } from "@dramaip/ui";
import { EmptyPanel, ErrorPanel, useStudioClient } from "@dramaip/ui-shared";

interface Project {
  id: string;
  name: string;
}
interface Resource {
  id: string;
  title: string;
  status: string;
  version: number;
  data: Record<string, unknown>;
}

function AutomationWorkspace() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [tab, setTab] = useState("tasks");
  const [title, setTitle] = useState("");
  const projects = useQuery({
    queryKey: ["automation", "projects"],
    queryFn: () =>
      client.request<{ items: Project[] }>("/api/v2/workspace/projects"),
  });
  const activeProject = projectId || projects.data?.items[0]?.id || "";
  const resources = useQuery({
    queryKey: ["automation", tab, activeProject],
    queryFn: () =>
      client.request<{ items: Resource[] }>(
        `/api/v2/automation/${tab}?projectId=${activeProject}`,
      ),
    enabled: Boolean(activeProject),
  });
  const create = useMutation({
    mutationFn: () =>
      client.request(`/api/v2/automation/${tab}`, {
        method: "POST",
        headers:
          ["tasks", "workflows", "templates"].includes(tab) && tab === "tasks"
            ? { "idempotency-key": crypto.randomUUID() }
            : undefined,
        body: JSON.stringify({
          projectId: activeProject,
          title: title.trim(),
          data:
            tab === "tasks"
              ? { state: "queued", progress: 0 }
              : tab === "workflows"
                ? { steps: [], enabled: true }
                : { category: "小说创作", prompt: title.trim(), variables: [] },
        }),
      }),
    onSuccess: async () => {
      setTitle("");
      await queryClient.invalidateQueries({
        queryKey: ["automation", tab, activeProject],
      });
    },
  });
  const run = useMutation({
    mutationFn: (resource: Resource) =>
      client.request(`/api/v2/automation/${tab}/${resource.id}/actions/run`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ projectId: activeProject, input: {} }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["automation", "tasks", activeProject],
      });
    },
  });
  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="AUTOMATION"
        title="任务与工作流"
        description="运行任务、工作流和模板；每次执行都有持久化状态、幂等键和可追踪结果。"
        actions={
          <select
            aria-label="选择项目"
            value={activeProject}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">选择项目</option>
            {projects.data?.items.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <Tabs.List>
          {(
            [
              ["tasks", "任务"],
              ["workflows", "工作流"],
              ["templates", "模板"],
            ] as const
          ).map(([value, label]) => (
            <Tabs.Trigger key={value} value={value}>
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Card className="mt-4 flex gap-3">
          <Input
            aria-label="名称"
            value={title}
            placeholder={
              tab === "tasks"
                ? "任务名称"
                : tab === "workflows"
                  ? "工作流名称"
                  : "模板名称"
            }
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button
            variant="primary"
            disabled={!activeProject || !title.trim()}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            新建
          </Button>
        </Card>
        {(resources.error || create.error || run.error) && (
          <ErrorPanel error={resources.error ?? create.error ?? run.error} />
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {resources.data?.items.map((resource) => (
            <Card key={resource.id}>
              <small className="text-muted">
                {resource.status} · v{resource.version}
              </small>
              <h2 className="mt-2 text-lg font-semibold">{resource.title}</h2>
              <pre className="mt-2 max-h-36 overflow-auto text-xs text-muted">
                {JSON.stringify(resource.data, null, 2)}
              </pre>
              {tab !== "tasks" && (
                <Button
                  className="mt-3"
                  onClick={() => run.mutate(resource)}
                  loading={run.isPending}
                >
                  运行
                </Button>
              )}
            </Card>
          ))}
          {!resources.data?.items.length && (
            <EmptyPanel>
              当前项目尚无
              {tab === "tasks"
                ? "任务"
                : tab === "workflows"
                  ? "工作流"
                  : "模板"}
              。
            </EmptyPanel>
          )}
        </div>
      </Tabs>
    </section>
  );
}

export const automationUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "automation.workspace",
    pluginId: "automation",
    path: "/automation",
    title: "任务与工作流",
    component: async () => ({ default: AutomationWorkspace }),
  },
  {
    kind: "navigation",
    id: "automation.navigation",
    pluginId: "automation",
    section: "settings",
    order: 30,
    label: "任务与工作流",
    to: "/automation",
  },
];
