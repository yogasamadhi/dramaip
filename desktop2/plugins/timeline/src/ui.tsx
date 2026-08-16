import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import type { UiContribution } from "@dramaip/plugin-api";
import { Button, Card, Input, PageHeader, Select } from "@dramaip/ui";
import { EmptyPanel, ErrorPanel, useStudioClient } from "@dramaip/ui-shared";

interface Project {
  id: string;
  name: string;
}
interface Timeline {
  id: string;
  title: string;
  status: string;
  version: number;
  data: {
    durationMs: number;
    frameRate: number;
    canonical: boolean;
    locked: boolean;
    clips: Array<{
      id: string;
      assetId: string;
      track: number;
      startMs: number;
      durationMs: number;
      offsetMs: number;
    }>;
  };
}

function TimelineWorkspace() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("正片时间线");
  const [preflight, setPreflight] = useState<{
    ready: boolean;
    errors: string[];
    warnings: string[];
  }>();
  const projects = useQuery({
    queryKey: ["workspace", "projects"],
    queryFn: () =>
      client.request<{ items: Project[] }>("/api/v2/workspace/projects"),
  });
  const activeProject = projectId || projects.data?.items[0]?.id || "";
  const timelines = useQuery({
    queryKey: ["timeline", activeProject],
    queryFn: () =>
      client.request<{ items: Timeline[] }>(
        `/api/v2/timeline/timelines?projectId=${activeProject}`,
      ),
    enabled: Boolean(activeProject),
  });
  const create = useMutation({
    mutationFn: () =>
      client.request("/api/v2/timeline/timelines", {
        method: "POST",
        body: JSON.stringify({
          projectId: activeProject,
          title,
          data: {
            durationMs: 0,
            frameRate: 25,
            clips: [],
            canonical: !timelines.data?.items.length,
            locked: false,
          },
        }),
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["timeline", activeProject] }),
  });
  const historyAction = useMutation({
    mutationFn: (input: {
      id: string;
      version: number;
      verb: "undo" | "redo";
    }) =>
      client.request(
        `/api/v2/timeline/timelines/${input.id}/actions/${input.verb}`,
        {
          method: "POST",
          headers: {
            "if-match": `"v${input.version}"`,
            "idempotency-key": crypto.randomUUID(),
          },
        },
      ),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["timeline", activeProject] }),
  });
  const exportTimeline = useMutation({
    mutationFn: async (timeline: Timeline) => {
      const target = await window.dramaip.files.saveTarget({
        suggestedName: `${timeline.title}.fcpxml`,
        extensions: ["fcpxml"],
      });
      if (!target) return;
      await client.request(
        `/api/v2/timeline/timelines/${timeline.id}/actions/export`,
        {
          method: "POST",
          headers: {
            "if-match": `"v${timeline.version}"`,
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            format: "fcpxml",
            capability: target.capability,
          }),
        },
      );
      await window.dramaip.files.reveal(target.revealCapability);
    },
  });
  const runPreflight = useMutation({
    mutationFn: (id: string) =>
      client.request<{ ready: boolean; errors: string[]; warnings: string[] }>(
        `/api/v2/timeline/timelines/${id}/preflight`,
      ),
    onSuccess: setPreflight,
  });
  const current =
    timelines.data?.items.find((item) => item.data.canonical) ??
    timelines.data?.items[0];
  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="TIMELINE"
        title="多轨时间线"
        description="视频、对白、音乐与环境音轨统一编辑；每条命令可撤销，人工锁在重启后仍然有效。"
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
          <Link to="/produce">制作结构</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/produce/media">资产与导演看板</Link>
        </Button>
        <Button asChild variant="subtle">
          <Link to="/produce/timeline">时间线</Link>
        </Button>
      </nav>
      {!current ? (
        <Card>
          <h2 className="text-lg font-semibold">建立 canonical timeline</h2>
          <div className="mt-4 flex gap-3">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Button
              variant="primary"
              disabled={!activeProject || !title.trim()}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              创建时间线
            </Button>
          </div>
          {create.error && <ErrorPanel error={create.error} />}
        </Card>
      ) : (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <small className="text-muted">
                CANONICAL · v{current.version}
              </small>
              <h2 className="text-xl font-semibold">{current.title}</h2>
            </div>
            <div className="flex gap-2">
              <Button
                loading={historyAction.isPending}
                onClick={() =>
                  historyAction.mutate({
                    id: current.id,
                    version: current.version,
                    verb: "undo",
                  })
                }
              >
                撤销
              </Button>
              <Button
                loading={historyAction.isPending}
                onClick={() =>
                  historyAction.mutate({
                    id: current.id,
                    version: current.version,
                    verb: "redo",
                  })
                }
              >
                重做
              </Button>
              <Button
                variant="subtle"
                loading={runPreflight.isPending}
                onClick={() => runPreflight.mutate(current.id)}
              >
                预检
              </Button>
              <Button
                variant="primary"
                loading={exportTimeline.isPending}
                onClick={() => exportTimeline.mutate(current)}
              >
                导出
              </Button>
            </div>
          </Card>
          {preflight && (
            <Card
              className={preflight.ready ? "border-success" : "border-warning"}
            >
              <strong>{preflight.ready ? "预检通过" : "预检尚未通过"}</strong>
              <p className="mt-2 text-sm text-muted">
                {[...preflight.errors, ...preflight.warnings].join("；") ||
                  "资产、时长与权利状态均可交付。"}
              </p>
            </Card>
          )}
          <Card className="overflow-x-auto p-0">
            <div className="min-w-[900px]">
              {["视频", "对白", "音乐", "环境音"].map((label, track) => (
                <div
                  key={label}
                  className="grid min-h-20 grid-cols-[100px_1fr] border-b border-line last:border-0"
                >
                  <div className="border-r border-line bg-surface-muted p-3 text-sm font-medium">
                    {label}
                  </div>
                  <div className="relative m-2 rounded-md bg-canvas">
                    {current.data.clips
                      .filter((clip) => clip.track === track)
                      .map((clip) => (
                        <div
                          key={clip.id}
                          className="absolute inset-y-2 rounded-md border border-brand/30 bg-brand-soft px-2 py-1 text-xs text-brand-strong"
                          style={{
                            left: `${Math.min(90, (clip.startMs / Math.max(current.data.durationMs, 1)) * 100)}%`,
                            width: `${Math.max(4, (clip.durationMs / Math.max(current.data.durationMs, 1)) * 100)}%`,
                          }}
                        >
                          片段 {clip.id.slice(0, 6)}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          {!current.data.clips.length && (
            <EmptyPanel>
              从资产中心选择视频与音轨，组装第一版时间线。
            </EmptyPanel>
          )}
          {(historyAction.error ||
            exportTimeline.error ||
            runPreflight.error) && (
            <ErrorPanel
              error={
                historyAction.error ??
                exportTimeline.error ??
                runPreflight.error
              }
            />
          )}
        </>
      )}
    </section>
  );
}

export const timelineUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "timeline.workspace",
    pluginId: "timeline",
    path: "/produce/timeline",
    title: "时间线",
    component: async () => ({ default: TimelineWorkspace }),
  },
];
