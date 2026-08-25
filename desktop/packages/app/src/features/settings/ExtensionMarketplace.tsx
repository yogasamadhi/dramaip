import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, InlineNotice, Input } from "@dramaip/ui-shared";
import { useState } from "react";
import { useStudioClient } from "../../runtime-connection";

type InstalledExtension = {
  pluginId: string;
  version?: string;
  state: "active" | "degraded" | "disabled" | "quarantined";
  manifest?: { name?: string; permissions?: string[] };
};

type Catalog = {
  registryId: string;
  extensions: Array<{
    id: string;
    name: string;
    description?: string;
    versions: Array<{ version: string }>;
  }>;
};

type Preview = {
  previewId: string;
  pluginId: string;
  version: string;
  permissions: string[];
  permissionExpansion: string[];
  publisherChange?: boolean;
};

export default function ExtensionMarketplace() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const [registryUrl, setRegistryUrl] = useState("");
  const [registryId, setRegistryId] = useState("official.dramaip");
  const [keyId, setKeyId] = useState("");
  const [rootPublicKey, setRootPublicKey] = useState("");
  const [catalog, setCatalog] = useState<Catalog>();
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [notice, setNotice] = useState<string>();
  const installed = useQuery({
    queryKey: ["extensions", "installed"],
    queryFn: () =>
      client.extensions.installed() as Promise<InstalledExtension[]>,
  });
  const refreshCatalog = useMutation({
    mutationFn: () =>
      client.extensions.catalog({
        registryId,
        url: registryUrl,
        keyId,
        rootPublicKey,
      }) as Promise<Catalog>,
    onSuccess: (value) => {
      setCatalog(value);
      setNotice("Registry 签名验证通过，目录缓存已更新。");
    },
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : String(error)),
  });
  const previewInstall = useMutation({
    mutationFn: (pluginId: string) =>
      client.extensions.installPreview({
        registryId,
        pluginId,
      }) as Promise<Preview>,
    onSuccess: setPreview,
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : String(error)),
  });
  const commit = useMutation({
    mutationFn: () =>
      client.extensions.installCommit(
        {
          previewId: preview!.previewId,
          approvedPermissions: preview!.permissions,
          approvedPublisherChange: preview!.publisherChange === true,
          approvedScopes: Object.fromEntries(
            preview!.permissions
              .filter((permission) =>
                /^(projects|documents|assets)\.|^ai\.invoke$/u.test(permission),
              )
              .map((permission) => [permission, { allProjects: true }]),
          ),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setPreview(undefined);
      setNotice("扩展已在独立沙箱中完成健康检查并启用。");
      await queryClient.invalidateQueries({ queryKey: ["extensions"] });
    },
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : String(error)),
  });
  const lifecycle = useMutation({
    mutationFn: async (input: {
      pluginId: string;
      action: "disable" | "enable" | "retry" | "rollback" | "uninstall";
      data?: "delete" | "export" | "keep";
    }) => {
      if (input.action === "disable")
        return client.extensions.disable(input.pluginId);
      if (input.action === "enable")
        return client.extensions.enable(input.pluginId);
      if (input.action === "retry")
        return client.extensions.retry(input.pluginId);
      if (input.action === "rollback")
        return client.extensions.rollback(input.pluginId, crypto.randomUUID());
      return client.extensions.uninstall(
        input.pluginId,
        input.data ?? "keep",
        crypto.randomUUID(),
      );
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["extensions"] }),
    onError: (error) =>
      setNotice(error instanceof Error ? error.message : String(error)),
  });

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div>
        <p className="studio-eyebrow">Extension Platform</p>
        <h2 className="mt-1 text-xl font-semibold">扩展与 Marketplace</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          仅安装由受信 Registry 和发布者 Ed25519 签名的扩展。扩展运行在独立
          QuickJS 进程中，不能访问 Node、文件路径或凭据明文。
        </p>
      </div>

      <div className="mt-4 grid gap-3 rounded-lg border border-line bg-surface-muted p-4 lg:grid-cols-2">
        <Input
          value={registryUrl}
          onChange={(event) => setRegistryUrl(event.target.value)}
          placeholder="HTTPS 扩展目录地址"
        />
        <Input
          value={registryId}
          onChange={(event) => setRegistryId(event.target.value)}
          placeholder="扩展目录标识"
        />
        <Input
          value={keyId}
          onChange={(event) => setKeyId(event.target.value)}
          placeholder="根签名密钥标识"
        />
        <textarea
          className="min-h-24 rounded-md border border-line bg-surface px-3 py-2 text-xs"
          value={rootPublicKey}
          onChange={(event) => setRootPublicKey(event.target.value)}
          placeholder="扩展目录 Ed25519 公钥（PEM）"
        />
        <Button
          variant="primary"
          disabled={
            !registryUrl || !keyId || !rootPublicKey || refreshCatalog.isPending
          }
          onClick={() => refreshCatalog.mutate()}
        >
          {refreshCatalog.isPending ? "正在验证…" : "验证并刷新目录"}
        </Button>
      </div>

      {notice ? <InlineNotice className="mt-4">{notice}</InlineNotice> : null}

      {catalog ? (
        <div className="mt-5">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索扩展名称或 ID"
          />
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {catalog.extensions
              .filter((extension) =>
                `${extension.id} ${extension.name} ${extension.description ?? ""}`
                  .toLocaleLowerCase()
                  .includes(search.trim().toLocaleLowerCase()),
              )
              .map((extension) => (
                <article
                  key={extension.id}
                  className="rounded-lg border border-line p-4"
                >
                  <h3 className="font-semibold">{extension.name}</h3>
                  <p className="mt-1 text-xs text-muted">
                    {extension.id} · {extension.versions[0]?.version}
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    {extension.description ?? "该发布者未提供说明。"}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    onClick={() => previewInstall.mutate(extension.id)}
                  >
                    权限预览
                  </Button>
                </article>
              ))}
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="mt-5 rounded-lg border border-brand bg-brand-soft p-4">
          <h3 className="font-semibold">
            确认安装 {preview.pluginId} {preview.version}
          </h3>
          <ul className="mt-2 list-inside list-disc text-sm text-muted">
            {preview.permissions.map((permission) => (
              <li key={permission}>
                {permission}
                {preview.permissionExpansion.includes(permission)
                  ? "（新增）"
                  : ""}
              </li>
            ))}
          </ul>
          {preview.publisherChange ? (
            <InlineNotice className="mt-3" tone="danger">
              发布者或签名密钥发生变化；继续将明确重新确认信任关系。
            </InlineNotice>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              disabled={commit.isPending}
              onClick={() => commit.mutate()}
            >
              {commit.isPending ? "正在隔离安装…" : "确认权限并安装"}
            </Button>
            <Button variant="ghost" onClick={() => setPreview(undefined)}>
              取消
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {(installed.data ?? []).map((extension) => (
          <article
            key={extension.pluginId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-4"
          >
            <div>
              <h3 className="font-semibold">
                {extension.manifest?.name ?? extension.pluginId}
              </h3>
              <p className="text-xs text-muted">
                {extension.version ?? "未知版本"} · {extension.state}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {extension.state === "active" ? (
                <Button
                  size="sm"
                  onClick={() =>
                    lifecycle.mutate({
                      pluginId: extension.pluginId,
                      action: "disable",
                    })
                  }
                >
                  停用
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    lifecycle.mutate({
                      pluginId: extension.pluginId,
                      action: "enable",
                    })
                  }
                >
                  启用
                </Button>
              )}
              <Button
                size="sm"
                onClick={() =>
                  lifecycle.mutate({
                    pluginId: extension.pluginId,
                    action: "retry",
                  })
                }
              >
                恢复隔离
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  lifecycle.mutate({
                    pluginId: extension.pluginId,
                    action: "rollback",
                  })
                }
              >
                回滚
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  lifecycle.mutate({
                    pluginId: extension.pluginId,
                    action: "uninstall",
                    data: "keep",
                  })
                }
              >
                卸载并保留数据
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  lifecycle.mutate({
                    pluginId: extension.pluginId,
                    action: "uninstall",
                    data: "export",
                  })
                }
              >
                导出后卸载
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  lifecycle.mutate({
                    pluginId: extension.pluginId,
                    action: "uninstall",
                    data: "delete",
                  })
                }
              >
                卸载并删除数据
              </Button>
            </div>
          </article>
        ))}
        {!installed.isLoading && !(installed.data ?? []).length ? (
          <EmptyState
            title="尚未安装扩展"
            description="刷新受信 Registry 后可预览权限并安装。"
          />
        ) : null}
      </div>
    </section>
  );
}
