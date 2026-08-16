import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import type { UiContribution } from "@dramaip/plugin-api";
import { Button, Card, PageHeader, Select, Tabs } from "@dramaip/ui";
import { EmptyPanel, ErrorPanel, useStudioClient } from "@dramaip/ui-shared";

interface Project {
  id: string;
  name: string;
}
interface Asset {
  id: string;
  title: string;
  status: string;
  version: number;
  data: {
    mediaType: string;
    mimeType: string;
    byteSize: number;
    checksum: string;
    rightsStatus: string;
    adoptionStatus: string;
  };
}

function MediaWorkspace() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [section, setSection] = useState("assets");
  const projects = useQuery({
    queryKey: ["workspace", "projects"],
    queryFn: () =>
      client.request<{ items: Project[] }>("/api/v2/workspace/projects"),
  });
  const activeProject = projectId || projects.data?.items[0]?.id || "";
  const assets = useQuery({
    queryKey: ["media", "assets", activeProject],
    queryFn: () =>
      client.request<{ items: Asset[] }>(
        `/api/v2/media/assets?projectId=${activeProject}`,
      ),
    enabled: Boolean(activeProject),
  });
  const importAssets = useMutation({
    mutationFn: async () => {
      const selected = await window.dramaip.files.selectMany({
        extensions: [
          "png",
          "jpg",
          "jpeg",
          "webp",
          "mp4",
          "mov",
          "webm",
          "wav",
          "mp3",
          "m4a",
        ],
      });
      for (const file of selected) {
        await client.request("/api/v2/media/assets/actions/import", {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            projectId: activeProject,
            capability: file.capability,
            title: file.name,
            rightsConfirmed: true,
          }),
        });
      }
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: ["media", "assets", activeProject],
      }),
  });
  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="ASSET CENTER"
        title="资产中心与导演看板"
        description="统一管理本地视觉、静帧、音色、音轨与动态分镜；权利确认和采用状态全程可追溯。"
        actions={
          <>
            <Select
              aria-label="选择项目"
              value={activeProject}
              options={(projects.data?.items ?? []).map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              onValueChange={setProjectId}
            />
            <Button
              variant="primary"
              disabled={!activeProject}
              loading={importAssets.isPending}
              onClick={() => importAssets.mutate()}
            >
              导入本地资产
            </Button>
          </>
        }
      />
      <nav className="flex gap-2">
        <Button asChild variant="ghost">
          <Link to="/produce">制作结构</Link>
        </Button>
        <Button asChild variant="subtle">
          <Link to="/produce/media">资产与导演看板</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/produce/timeline">时间线</Link>
        </Button>
      </nav>
      <Tabs value={section} onValueChange={setSection}>
        <Tabs.List>
          <Tabs.Trigger value="assets">统一资产</Tabs.Trigger>
          <Tabs.Trigger value="director">导演看板</Tabs.Trigger>
          <Tabs.Trigger value="stills">静帧 Gate</Tabs.Trigger>
          <Tabs.Trigger value="audio">音色与音轨</Tabs.Trigger>
          <Tabs.Trigger value="generation">生成预检</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content
          value="assets"
          className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {assets.data?.items.map((asset) => (
            <Card key={asset.id}>
              <div className="aspect-video overflow-hidden rounded-lg bg-surface-muted">
                <div className="grid h-full place-items-center text-sm text-muted">
                  {asset.data.mediaType.toUpperCase()} · 本地受控预览
                </div>
              </div>
              <h2 className="mt-3 text-base font-semibold">{asset.title}</h2>
              <p className="mt-1 text-xs text-muted">
                {asset.data.mimeType} ·{" "}
                {(asset.data.byteSize / 1024 / 1024).toFixed(2)} MB
              </p>
              <p className="mt-1 text-xs text-muted">
                权利 {asset.data.rightsStatus} · {asset.data.adoptionStatus} · v
                {asset.version}
              </p>
            </Card>
          ))}
          {!assets.data?.items.length && (
            <EmptyPanel>导入本地图片、视频或音频建立资产库。</EmptyPanel>
          )}
        </Tabs.Content>
        {section !== "assets" && (
          <Tabs.Content value={section} className="mt-4">
            <Card>
              <h2 className="text-lg font-semibold">
                {section === "director"
                  ? "导演看板与视觉版本"
                  : section === "stills"
                    ? "静帧采用与锁定"
                    : section === "audio"
                      ? "音色、音轨和动态分镜"
                      : "媒体生成预检"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                本地素材管理可用。远程图片、TTS
                与视频提交依据当前能力策略关闭，系统不会生成假媒体。
              </p>
              {section === "generation" && (
                <div className="mt-4 rounded-lg border border-line bg-surface-muted p-4 text-sm text-muted">
                  远程执行未启用 · 可查看
                  Provider、提示词、预计费用和安全检查，但“提交生成”会返回
                  EXTERNAL_EXECUTION_DISABLED。
                </div>
              )}
            </Card>
          </Tabs.Content>
        )}
      </Tabs>
      {importAssets.error && <ErrorPanel error={importAssets.error} />}
    </section>
  );
}

export const mediaUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "media.workspace",
    pluginId: "media",
    path: "/produce/media",
    title: "资产中心",
    component: async () => ({ default: MediaWorkspace }),
  },
];
