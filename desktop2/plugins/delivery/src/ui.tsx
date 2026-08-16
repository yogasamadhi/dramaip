import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import type { UiContribution } from "@dramaip/plugin-api";
import { Button, Card, Input, PageHeader, Select, Tabs } from "@dramaip/ui";
import { EmptyPanel, ErrorPanel, useStudioClient } from "@dramaip/ui-shared";

interface Project {
  id: string;
  name: string;
}
interface DeliveryRecord {
  id: string;
  title: string;
  status: string;
  version: number;
  data: Record<string, unknown>;
}

const sections = [
  {
    path: "creative-versions",
    label: "创意版本",
    data: () => ({
      sourceType: "timeline",
      sourceId: "canonical",
      label: "本地版本",
      checksum: crypto.randomUUID(),
      frozenAt: new Date().toISOString(),
    }),
  },
  {
    path: "platform-specs",
    label: "平台预检",
    data: () => ({
      platform: "通用竖屏",
      aspectRatio: "9:16",
      codec: "H.264",
      maxDurationMs: 180000,
      metadata: {},
    }),
  },
  {
    path: "archives",
    label: "归档",
    data: () => ({
      versionId: crypto.randomUUID(),
      assetIds: [],
      checksum: crypto.randomUUID(),
    }),
  },
  {
    path: "exports",
    label: "交付导出",
    data: () => ({
      versionId: crypto.randomUUID(),
      platformSpecId: crypto.randomUUID(),
    }),
  },
  {
    path: "cloud-review-syncs",
    label: "云审片预览",
    data: () => ({
      reviewPackageId: crypto.randomUUID(),
      provider: "disabled",
    }),
  },
] as const;

function DeliveryWorkspace() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [path, setPath] = useState<string>(sections[0].path);
  const [title, setTitle] = useState("");
  const projects = useQuery({
    queryKey: ["workspace", "projects"],
    queryFn: () =>
      client.request<{ items: Project[] }>("/api/v2/workspace/projects"),
  });
  const activeProject = projectId || projects.data?.items[0]?.id || "";
  const active = sections.find((item) => item.path === path) ?? sections[0];
  const records = useQuery({
    queryKey: ["delivery", path, activeProject],
    queryFn: () =>
      client.request<{ items: DeliveryRecord[] }>(
        `/api/v2/delivery/${path}?projectId=${activeProject}`,
      ),
    enabled: Boolean(activeProject),
  });
  const create = useMutation({
    mutationFn: () =>
      client.request(`/api/v2/delivery/${path}`, {
        method: "POST",
        headers: ["archives", "exports", "cloud-review-syncs"].includes(path)
          ? { "idempotency-key": crypto.randomUUID() }
          : undefined,
        body: JSON.stringify({
          projectId: activeProject,
          title: title.trim(),
          data: active.data(),
        }),
      }),
    onSuccess: async () => {
      setTitle("");
      await queryClient.invalidateQueries({
        queryKey: ["delivery", path, activeProject],
      });
    },
  });
  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="DELIVERY"
        title="交付与归档"
        description="冻结创意版本，执行平台预检，生成本地交付清单并保存可验证归档。"
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
      <nav className="flex gap-2">
        <Button asChild variant="ghost">
          <Link to="/review">审片与决策</Link>
        </Button>
        <Button asChild variant="subtle">
          <Link to="/review/delivery">交付与归档</Link>
        </Button>
      </nav>
      <Tabs value={path} onValueChange={setPath}>
        <Tabs.List>
          {sections.map((item) => (
            <Tabs.Trigger key={item.path} value={item.path}>
              {item.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Card className="mt-4">
          <div className="flex items-end gap-3">
            <label className="flex-1 text-sm font-medium">
              新建{active.label}
              <Input
                className="mt-1.5"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <Button
              variant="primary"
              disabled={!activeProject || !title.trim()}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              创建
            </Button>
          </div>
          {path === "cloud-review-syncs" && (
            <p className="mt-3 rounded-md bg-surface-muted p-3 text-sm text-muted">
              云审片 publish / sync / delete
              网络动作未启用；这里只保存连接配置和发布预览。
            </p>
          )}
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
              <p className="mt-2 line-clamp-5 text-sm leading-6 text-muted">
                {JSON.stringify(record.data)}
              </p>
            </Card>
          ))}
          {!records.data?.items.length && (
            <EmptyPanel>尚未创建{active.label}记录。</EmptyPanel>
          )}
        </div>
      </Tabs>
    </section>
  );
}

export const deliveryUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "delivery.workspace",
    pluginId: "delivery",
    path: "/review/delivery",
    title: "交付与归档",
    component: async () => ({ default: DeliveryWorkspace }),
  },
];
