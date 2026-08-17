import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import type { UiContribution } from "@dramaip/plugin-api";
import { Button, Card, Input, PageHeader } from "@dramaip/ui";
import { ErrorPanel, useStudioClient } from "@dramaip/ui-shared";

function SearchPage() {
  const client = useStudioClient();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const active = params.get("q")?.trim() ?? "";
  const results = useQuery({
    queryKey: ["search", active],
    queryFn: () =>
      client.request<{
        items: Array<{
          aggregateId: string;
          title: string;
          aggregateType: string;
          pluginId: string;
        }>;
      }>(`/api/v2/system/search?q=${encodeURIComponent(active)}`),
    enabled: Boolean(active),
  });
  return (
    <section className="narrow-page">
      <PageHeader
        eyebrow="全局检索"
        title="搜索创作资料"
        description="跨项目搜索人物、大纲、Story Bible 与章节正文。"
      />
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          setParams(query.trim() ? { q: query.trim() } : {});
        }}
      >
        <Input
          aria-label="搜索关键词"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="项目、人物、大纲、Story Bible、章节…"
        />
        <Button variant="primary">搜索</Button>
      </form>
      {results.error && <ErrorPanel error={results.error} />}
      <Card className="list-card p-0">
        {results.data?.items.map((item) => (
          <article
            className="list-row"
            key={`${item.aggregateType}:${item.aggregateId}`}
          >
            <div>
              <strong>{item.title}</strong>
              <small>
                {item.pluginId} · {item.aggregateType}
              </small>
            </div>
          </article>
        ))}
        {active && !results.isLoading && !results.data?.items.length ? (
          <div className="empty-state">没有找到匹配的创作资料。</div>
        ) : null}
      </Card>
    </section>
  );
}

function SystemSettingsPanel() {
  const client = useStudioClient();
  const bootstrap = useQuery({
    queryKey: ["system", "bootstrap"],
    queryFn: () =>
      client.request<{
        plugins: string[];
        capabilities: Record<string, boolean>;
      }>("/api/v2/system/bootstrap"),
  });
  const diagnostics = useQuery({
    queryKey: ["system", "diagnostics"],
    queryFn: () =>
      client.request<{ items: Array<{ component: string; status: string }> }>(
        "/api/v2/system/diagnostics",
      ),
  });
  const backups = useQuery({
    queryKey: ["system", "backups"],
    queryFn: () =>
      client.request<{
        items: Array<{ id: string; filename: string; size: number }>;
      }>("/api/v2/system/backups"),
  });
  const createBackup = useMutation({
    mutationFn: () =>
      client.request("/api/v2/system/backups", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: async () => backups.refetch(),
  });
  const restoreBackup = useMutation({
    mutationFn: (item: { id: string; filename: string }) =>
      client.request(`/api/v2/system/backups/${item.id}/actions/restore`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ confirmation: item.filename }),
      }),
    onSuccess: async () => {
      await backups.refetch();
      window.location.reload();
    },
  });
  return (
    <Card className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-brand-strong">
            SYSTEM
          </p>
          <h2 className="mt-1 text-lg font-semibold">诊断与备份</h2>
          <p className="mt-1 text-sm text-muted">
            {bootstrap.data?.plugins.length ?? 0} 个插件已装配，
            {diagnostics.data?.items.length ?? 0} 个事件消费者受监控。
          </p>
        </div>
        <Button
          variant="secondary"
          loading={createBackup.isPending}
          onClick={() => createBackup.mutate()}
        >
          立即备份
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg bg-surface-muted p-4 text-sm">
          <strong>能力策略</strong>
          {Object.entries(bootstrap.data?.capabilities ?? {}).map(
            ([name, enabled]) => (
              <div key={name} className="mt-2 flex justify-between text-muted">
                <span>{name}</span>
                <span>{enabled ? "开启" : "本地策略关闭"}</span>
              </div>
            ),
          )}
        </div>
        <div className="rounded-lg bg-surface-muted p-4 text-sm">
          <strong>最近备份</strong>
          {backups.data?.items.slice(0, 4).map((item) => (
            <div
              key={item.id}
              className="mt-2 flex justify-between gap-3 text-muted"
            >
              <span className="truncate">{item.filename}</span>
              <span>{(item.size / 1024 / 1024).toFixed(1)} MB</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={restoreBackup.isPending}
                onClick={() => {
                  if (window.confirm(`使用 ${item.filename} 恢复数据库？`))
                    restoreBackup.mutate(item);
                }}
              >
                恢复
              </Button>
            </div>
          ))}
          {!backups.data?.items.length && (
            <p className="mt-2 text-muted">尚无备份</p>
          )}
        </div>
      </div>
      {(bootstrap.error ||
        diagnostics.error ||
        backups.error ||
        createBackup.error ||
        restoreBackup.error) && (
        <ErrorPanel
          error={
            bootstrap.error ??
            diagnostics.error ??
            backups.error ??
            createBackup.error ??
            restoreBackup.error
          }
        />
      )}
    </Card>
  );
}

export const systemUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "system.search",
    pluginId: "system",
    path: "/search",
    title: "搜索",
    component: async () => ({ default: SearchPage }),
  },
  {
    kind: "navigation",
    id: "system.search.navigation",
    pluginId: "system",
    section: "settings",
    order: 10,
    label: "搜索",
    to: "/search",
  },
  {
    kind: "slot",
    id: "system.settings.section",
    pluginId: "system",
    slot: "settings.section",
    order: 10,
    component: async () => ({ default: SystemSettingsPanel }),
  },
];
