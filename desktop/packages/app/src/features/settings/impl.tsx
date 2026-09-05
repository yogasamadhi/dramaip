import type {
  AgentEngineKind,
  AgentExperimentEngineKind,
  DomainEntity,
} from "@dramaip/contracts/product";
import {
  MODEL_PROVIDER_CATALOG,
  MODEL_PROVIDER_CATALOG_RELEASE,
  MODEL_PROVIDER_CATALOG_UPDATED_AT,
  modelProviderPreset,
  recommendedProviderModel,
  type ModelProviderPresetId,
} from "@dramaip/contracts/product";
import {
  BareButton,
  Button,
  LoadingState,
  confirmDialog,
} from "@dramaip/ui-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ThemeSettings } from "../../app-shell";
import { WorkspaceIntro, message, useStudio } from "../../studio-shared";
import { safeLocalRoute, useStudioSession } from "../../studio-session";
import { recordPayload } from "../studio-widgets";
import {
  recommendedCodexConnectionProtocol,
  type CodexConnectionProtocol,
} from "./codex-connection-protocol";
export const ExtensionMarketplace = lazy(
  () => import("./ExtensionMarketplace"),
);
const DeclarativeExtensionUi = lazy(
  () => import("../extensions/DeclarativeExtensionUi"),
);

export function BackupPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: backups = [], error } = useQuery({
    queryKey: ["backups"],
    queryFn: client.backups.list,
  });
  const create = useMutation({
    mutationFn: client.backups.create,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });
  const restore = useMutation({
    mutationFn: client.backups.restore,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
  const size = (bytes: number) =>
    bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} 千字节`
      : `${(bytes / (1024 * 1024)).toFixed(1)} 兆字节`;
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">本地备份</h2>
          <p className="mt-1 text-sm text-muted">
            备份由本地服务直接创建，恢复时会替换当前新版数据库并刷新界面数据。
          </p>
        </div>
        <BareButton
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "正在创建…" : "创建备份"}
        </BareButton>
      </div>
      {(error || create.error || restore.error) && (
        <p className="mt-3 text-sm text-red-600">
          {message(error ?? create.error ?? restore.error)}
        </p>
      )}
      <div className="mt-4 space-y-2">
        {backups.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3"
          >
            <div>
              <p className="font-medium">{item.name}</p>
              <p className="mt-1 text-xs text-muted">
                {new Intl.DateTimeFormat("zh-CN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(item.createdAt))}
                {" · "}
                {size(item.size)}
              </p>
            </div>
            <BareButton
              className="rounded-md border border-line px-2 py-1 text-xs text-brand disabled:opacity-50"
              disabled={restore.isPending}
              onClick={async () => {
                if (
                  await confirmDialog(
                    "恢复备份会替换当前新版数据。确定继续吗？",
                  )
                )
                  restore.mutate(item.id);
              }}
            >
              {restore.isPending ? "恢复中…" : "恢复此备份"}
            </BareButton>
          </div>
        ))}
        {!backups.length && (
          <p className="text-sm text-muted">
            暂无备份。建议在重大改动前创建备份。
          </p>
        )}
      </div>
    </section>
  );
}

export function DiagnosticPanel() {
  const client = useStudio();
  const [credentialStorageAvailable, setCredentialStorageAvailable] =
    useState<boolean>();
  const [report, setReport] =
    useState<Awaited<ReturnType<typeof client.support.diagnostics>>>();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    void client.host
      .getCredentialStorageStatus()
      .then((status) => setCredentialStorageAvailable(status.available))
      .catch(() => setCredentialStorageAvailable(false));
  }, []);
  const collect = async () => {
    setWorking(true);
    setNotice(undefined);
    try {
      setReport(await client.support.diagnostics());
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  const exportReport = async () => {
    if (!report) return;
    setWorking(true);
    try {
      const result = await client.host.saveTextFile({
        suggestedName: "尽意-DramaIP-诊断信息.json",
        content: JSON.stringify(report, null, 2),
      });
      setNotice(result.saved ? "诊断信息已导出。" : "已取消导出。");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">诊断与安全</h2>
          <p className="mt-1 text-sm text-muted">
            诊断信息只包含本地服务和数据库计数，不包含正文、密钥或文件绝对路径。
          </p>
        </div>
        <div className="flex gap-2">
          {report && (
            <BareButton
              className="rounded-lg border border-line px-3 py-2 text-sm text-brand disabled:opacity-50"
              disabled={working}
              onClick={() => void exportReport()}
            >
              导出诊断信息
            </BareButton>
          )}
          <BareButton
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={working}
            onClick={() => void collect()}
          >
            {working ? "正在收集…" : "收集诊断信息"}
          </BareButton>
        </div>
      </div>
      <p className="mt-3 text-sm">
        本地凭据库：
        {credentialStorageAvailable === undefined
          ? "正在检查…"
          : credentialStorageAvailable
            ? "可用，数据保存在应用数据目录，不访问系统钥匙串。"
            : "不可用，请检查应用数据目录的写入权限。"}
      </p>
      {report && (
        <dl className="mt-3 grid gap-2 rounded-lg bg-canvas p-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">项目</dt>
            <dd>{report.database.projectCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">章节</dt>
            <dd>{report.database.chapterCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">任务</dt>
            <dd>{report.database.taskCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">智能引擎</dt>
            <dd>{report.engineAvailable ? "可用" : "暂不可用"}</dd>
          </div>
        </dl>
      )}
      {notice && <p className="mt-3 text-sm text-muted">{notice}</p>}
    </section>
  );
}

export function GenerationLedgerPanel() {
  const client = useStudio();
  const session = useStudioSession();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState(
    () => session.activeProjectId ?? "",
  );
  const [notice, setNotice] = useState<string>();
  const { data: records = [], error } = useQuery({
    queryKey: ["generation-ledger", projectId],
    queryFn: () => client.generation.list(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (session.activeProjectId && projectId !== session.activeProjectId)
      setProjectId(session.activeProjectId);
  }, [projectId, session.activeProjectId]);
  const updateCost = async (
    id: string,
    current?: number,
    currency = "CNY",
    note = "",
  ) => {
    const entered = window.prompt(
      "请输入本次实际成本；留空表示暂不记录：",
      current?.toString() ?? "",
    );
    if (entered === null) return;
    const amount = entered.trim() ? Number(entered) : undefined;
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      setNotice("成本必须是大于或等于零的数字。");
      return;
    }
    const costNote = window.prompt("成本备注（可选）：", note);
    if (costNote === null) return;
    try {
      await client.generation.update(id, {
        ...(amount === undefined ? {} : { actualCost: amount }),
        currency,
        costNote,
      });
      setNotice("已更新成本记录。");
      await queryClient.invalidateQueries({
        queryKey: ["generation-ledger", projectId],
      });
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">生成账本</h2>
          <p className="mt-1 text-sm text-muted">
            记录智能任务与制作检查的运行摘要，并可补录实际成本。
          </p>
        </div>
        <label className="grid gap-1 text-sm">
          项目
          <select
            className="rounded-lg border border-line px-3 py-2"
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
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{message(error)}</p>}
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
      <div className="mt-4 space-y-2">
        {records.map((record) => (
          <article
            key={record.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line p-3 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium">{record.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted">
                {record.summary}
              </p>
              <p className="mt-1 text-xs text-muted">
                成本：
                {record.actualCost === undefined
                  ? "尚未记录"
                  : `${record.currency} ${record.actualCost.toFixed(2)}`}
              </p>
            </div>
            <BareButton
              className="rounded-md border border-line px-2 py-1 text-xs text-brand"
              onClick={() =>
                void updateCost(
                  record.id,
                  record.actualCost,
                  record.currency,
                  record.costNote,
                )
              }
            >
              补录成本
            </BareButton>
          </article>
        ))}
        {projectId && !records.length && (
          <p className="text-sm text-muted">
            当前项目还没有可归档的生成或检查记录。
          </p>
        )}
      </div>
    </section>
  );
}

export type ProviderChoice = ModelProviderPresetId | "other";

export function providerDiscoveredModels(
  payload: Record<string, unknown>,
): string[] {
  const value = payload["可用模型"];
  return typeof value === "string"
    ? value
        .split("、")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

export function ProviderSettingsPanel(props: {
  onProviderSaved?(): void;
  onProviderTested?(providerId: string): void;
  onProviderActivated?(providerId: string): void;
}) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
  });
  const { data: credentialStorage } = useQuery({
    queryKey: ["credential-storage-status"],
    queryFn: client.host.getCredentialStorageStatus,
  });
  const unlockCredentialVault = useMutation({
    mutationFn: client.host.unlockCredentialVault,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["credential-storage-status"],
      });
      setNotice("本地凭据保险库已为本次启动解锁。");
    },
    onError: (cause) => setError(message(cause)),
  });
  const [choice, setChoice] = useState<ProviderChoice>("openai");
  const [modelId, setModelId] = useState(
    recommendedProviderModel(MODEL_PROVIDER_CATALOG[0]),
  );
  const [credentialRefreshRequested, setCredentialRefreshRequested] =
    useState(false);
  const [customName, setCustomName] = useState("");
  const [customServiceType, setCustomServiceType] = useState("智能模型");
  const [customModel, setCustomModel] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customProtocol, setCustomProtocol] = useState("OpenAI 兼容文本");
  const [editing, setEditing] = useState<DomainEntity>();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const formRef = useRef<HTMLDivElement>(null);
  const providerSelectRef = useRef<HTMLSelectElement>(null);
  const preset = choice === "other" ? undefined : modelProviderPreset(choice);
  const editingPayload = recordPayload(editing?.payload);
  const selectableModels = preset
    ? [
        ...preset.models,
        ...providerDiscoveredModels(editingPayload)
          .filter((id) => !preset.models.some((model) => model.id === id))
          .map((id) => ({ id, label: `${id}（账户可用）` })),
        ...(modelId && !preset.models.some((model) => model.id === modelId)
          ? [{ id: modelId, label: `${modelId}（已保存）` }]
          : []),
      ]
    : [];

  useEffect(() => {
    if (!editing) return;
    formRef.current?.scrollIntoView({ block: "start" });
    providerSelectRef.current?.focus({ preventScroll: true });
  }, [editing]);

  const selectPreset = (next: ProviderChoice) => {
    setChoice(next);
    setEditing(undefined);
    setCredentialRefreshRequested(false);
    setError(undefined);
    setNotice(undefined);
    if (next === "other") {
      setCustomName("");
      setCustomServiceType("智能模型");
      setCustomModel("");
      setCustomBaseUrl("");
      setCustomProtocol("OpenAI 兼容文本");
      setModelId("");
      return;
    }
    const nextPreset = modelProviderPreset(next);
    if (nextPreset) setModelId(recommendedProviderModel(nextPreset));
  };

  const editProvider = (provider: DomainEntity) => {
    const payload = recordPayload(provider.payload);
    const presetId = String(payload["预设服务商"] ?? "");
    const known = modelProviderPreset(presetId);
    setEditing(provider);
    setChoice(known ? known.id : "other");
    setModelId(String(payload["模型名称"] ?? ""));
    setCredentialRefreshRequested(false);
    setCustomName(provider.title);
    setCustomServiceType(String(payload["服务类型"] ?? "智能模型"));
    setCustomModel(String(payload["模型名称"] ?? ""));
    setCustomBaseUrl(String(payload["服务地址"] ?? ""));
    setCustomProtocol(String(payload["调用协议"] ?? "OpenAI 兼容文本"));
    setError(undefined);
    setNotice(undefined);
  };

  const resetForm = () => selectPreset("openai");

  const saveProvider = async () => {
    const oldPayload = recordPayload(editing?.payload);
    const previousCredentialRef = String(oldPayload["凭据引用"] ?? "").trim();
    const selectedModel = preset ? modelId.trim() : customModel.trim();
    const title = preset?.name ?? customName.trim();
    const protocol = preset?.protocol ?? customProtocol.trim();
    const serviceType = preset ? "智能模型" : customServiceType.trim();
    const baseUrl = preset?.baseUrl ?? customBaseUrl.trim();
    const stableDiffusionWithoutKey =
      !preset && protocol.toLowerCase().includes("stable diffusion");
    if (!title || !serviceType || !selectedModel || !protocol) {
      setError("请完整填写服务商名称、服务类型、模型和调用协议。");
      return;
    }
    const needsCredential =
      !stableDiffusionWithoutKey &&
      (!previousCredentialRef || credentialRefreshRequested);
    if (needsCredential && credentialStorage?.available !== true) {
      setError("本地凭据库当前不可用，无法安全保存接口密钥。");
      return;
    }
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    let newCredentialRef: string | undefined;
    try {
      if (needsCredential) {
        newCredentialRef = (
          await client.host.captureCredential({
            purpose: "provider-authentication",
            label: `${title} 接口密钥`,
            policyId: preset
              ? `provider.catalog.${preset.id}`
              : "provider.custom.reauthorization-required",
            ...(baseUrl ? { allowedOrigin: new URL(baseUrl).origin } : {}),
          })
        ).credentialRef;
      }
      const credentialRef = newCredentialRef ?? previousCredentialRef;
      const payload: Record<string, unknown> = {
        ...oldPayload,
        服务类型: serviceType,
        模型名称: selectedModel,
        服务地址: baseUrl,
        调用协议: protocol,
        ...(credentialRef ? { 凭据引用: credentialRef } : {}),
        ...(preset
          ? {
              预设服务商: preset.id,
              模型目录版本: MODEL_PROVIDER_CATALOG_RELEASE,
              模型目录核对日期: MODEL_PROVIDER_CATALOG_UPDATED_AT,
            }
          : { 预设服务商: "other" }),
      };
      if (editing) {
        await client.resources.update("providers", editing.id, {
          title,
          payload,
          version: editing.version,
        });
      } else {
        await client.resources.create("providers", { title, payload });
      }
      if (
        newCredentialRef &&
        previousCredentialRef &&
        previousCredentialRef !== newCredentialRef
      )
        await client.host.removeCredential(previousCredentialRef);
      setCredentialRefreshRequested(false);
      setEditing(undefined);
      setNotice(`已保存 ${title}，密钥不会写入业务数据库。`);
      props.onProviderSaved?.();
      await queryClient.invalidateQueries({
        queryKey: ["resource", "providers"],
      });
    } catch (cause) {
      if (newCredentialRef)
        await client.host.removeCredential(newCredentialRef).catch(() => {});
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  };

  const removeProvider = async (provider: DomainEntity) => {
    if (!(await confirmDialog(`删除模型服务商「${provider.title}」吗？`)))
      return;
    setError(undefined);
    const credentialRef = String(
      recordPayload(provider.payload)["凭据引用"] ?? "",
    ).trim();
    try {
      await client.resources.remove("providers", provider.id);
      if (credentialRef)
        await client.host.removeCredential(credentialRef).catch(() => {});
      if (editing?.id === provider.id) resetForm();
      await queryClient.invalidateQueries({
        queryKey: ["resource", "providers"],
      });
    } catch (cause) {
      setError(message(cause));
    }
  };

  const testProvider = async (provider: DomainEntity) => {
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await client.providers.testConnection(provider.id);
      await queryClient.invalidateQueries({
        queryKey: ["resource", "providers"],
      });
      if (editing?.id === provider.id) {
        const refreshed = await client.resources.get("providers", provider.id);
        editProvider(refreshed);
      }
      setNotice(`${provider.title}：${result.message}`);
      if (result.ok) props.onProviderTested?.(provider.id);
    } catch (cause) {
      setError(message(cause));
    }
  };

  const activateProvider = async (provider: DomainEntity) => {
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await client.providers.activateForAgent(provider.id);
      setNotice(`${provider.title}：${result.message}`);
      props.onProviderActivated?.(provider.id);
      await queryClient.invalidateQueries({ queryKey: ["agent-engines"] });
    } catch (cause) {
      setError(message(cause));
    }
  };

  return (
    <section className="studio-card overflow-hidden p-0">
      <div className="border-b border-line bg-brand-soft/55 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="studio-eyebrow">第一步</p>
            <h2 className="mt-1 text-xl font-semibold">模型服务商</h2>
            <p className="mt-1 text-sm text-muted">
              常用服务商已预填接口地址和协议，只需选择模型并填写接口密钥。
            </p>
          </div>
          <span className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">
            模型目录核对于 {MODEL_PROVIDER_CATALOG_UPDATED_AT}
          </span>
        </div>
      </div>

      <div ref={formRef} className="scroll-mt-20 p-5">
        {editing && (
          <div
            className="rounded-lg border border-brand bg-brand-soft px-4 py-3 text-sm text-brand"
            role="status"
            aria-live="polite"
          >
            <p className="font-medium">正在编辑 {editing.title}</p>
            <p className="mt-1 text-xs">
              已将现有配置载入上方表单。修改模型或密钥后，请点击“保存服务商修改”；不更换密钥时保持留空即可。
            </p>
          </div>
        )}
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <label className="grid gap-1 text-sm text-muted">
            服务商
            <select
              ref={providerSelectRef}
              className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
              value={choice}
              onChange={(event) =>
                selectPreset(event.target.value as ProviderChoice)
              }
            >
              {MODEL_PROVIDER_CATALOG.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
              <option value="other">其他（全部手动填写）</option>
            </select>
          </label>

          {preset ? (
            <label className="grid gap-1 text-sm text-muted">
              模型
              <select
                className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              >
                {selectableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                    {"recommended" in model && model.recommended
                      ? "（推荐）"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="grid gap-1 text-sm text-muted">
              服务商名称
              <input
                className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
                placeholder="输入服务商名称"
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
              />
            </label>
          )}

          <div className="grid gap-1 text-sm text-muted">
            接口密钥（API Key）
            <BareButton
              className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-left text-ink disabled:opacity-50"
              disabled={credentialStorage?.available !== true}
              onClick={() => setCredentialRefreshRequested(true)}
            >
              {credentialRefreshRequested
                ? "保存时将在独立安全窗口输入密钥"
                : editing
                  ? "继续使用已保存密钥（点击以更换）"
                  : "保存时在独立安全窗口输入密钥"}
            </BareButton>
          </div>
        </div>

        {!preset && (
          <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-sm text-muted">
              服务类型
              <select
                className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
                value={customServiceType}
                onChange={(event) => setCustomServiceType(event.target.value)}
              >
                <option value="智能模型">智能模型</option>
                <option value="图片生成">图片生成</option>
                <option value="语音生成">语音生成</option>
                <option value="视频生成">视频生成</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">
              模型名称
              <input
                className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
                placeholder="输入模型标识"
                value={customModel}
                onChange={(event) => setCustomModel(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm text-muted">
              服务地址
              <input
                className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
                placeholder="输入完整接口基础地址"
                value={customBaseUrl}
                onChange={(event) => setCustomBaseUrl(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm text-muted">
              调用协议
              <select
                className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
                value={customProtocol}
                onChange={(event) => setCustomProtocol(event.target.value)}
              >
                <option value="OpenAI 兼容文本">OpenAI 兼容文本</option>
                <option value="Anthropic">Anthropic</option>
                <option value="Google Gemini">Google Gemini</option>
                <option value="OpenAI 兼容图片">OpenAI 兼容图片</option>
                <option value="OpenAI 兼容语音">OpenAI 兼容语音</option>
                <option value="OpenAI 兼容视频">OpenAI 兼容视频</option>
                <option value="Stable Diffusion WebUI">
                  Stable Diffusion WebUI
                </option>
              </select>
            </label>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            {preset && (
              <BareButton
                className="text-brand hover:underline"
                onClick={() => void client.host.openExternal(preset.apiKeyUrl)}
              >
                打开接口密钥申请页面
              </BareButton>
            )}
            <span>密钥仅进入本地加密凭据库，业务数据库只保存凭据引用。</span>
          </div>
          <div className="flex gap-2">
            {editing && (
              <BareButton
                className="rounded-lg border border-line px-3 py-2 text-sm"
                onClick={resetForm}
              >
                取消编辑
              </BareButton>
            )}
            <BareButton
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={saving}
              onClick={() => void saveProvider()}
            >
              {saving
                ? "保存中…"
                : editing
                  ? "保存服务商修改"
                  : "添加模型服务商"}
            </BareButton>
          </div>
        </div>

        {credentialStorage?.available === false && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-amber-700">
            <span>
              {credentialStorage.message ??
                "本地凭据库不可用，当前不能新增或更换接口密钥，也不会降级保存明文。"}
            </span>
            {credentialStorage.locked &&
              credentialStorage.storage === "master_password" && (
                <BareButton
                  className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  disabled={unlockCredentialVault.isPending}
                  onClick={() => unlockCredentialVault.mutate()}
                >
                  {unlockCredentialVault.isPending
                    ? "等待安全输入…"
                    : "输入主密码解锁"}
                </BareButton>
              )}
          </div>
        )}
        {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {providers.map((provider) => {
            const payload = recordPayload(provider.payload);
            return (
              <article
                key={provider.id}
                aria-label={`模型服务商 ${provider.title}`}
                className={`rounded-xl border p-4 ${editing?.id === provider.id ? "border-brand bg-brand-soft/55 shadow-control" : "border-line"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{provider.title}</p>
                    <p className="mt-1 text-sm text-muted">
                      {String(payload["模型名称"] ?? "尚未选择模型")}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {String(payload["连接状态"] ?? "尚未测试连接")}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <BareButton
                      className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                      aria-pressed={editing?.id === provider.id}
                      disabled={editing?.id === provider.id}
                      onClick={() => editProvider(provider)}
                    >
                      {editing?.id === provider.id ? "正在编辑" : "编辑配置"}
                    </BareButton>
                    <BareButton
                      className="rounded-md border border-line px-2 py-1 text-xs text-brand"
                      onClick={() => void testProvider(provider)}
                    >
                      测试连接
                    </BareButton>
                    {payload["服务类型"] === "智能模型" && (
                      <BareButton
                        className="rounded-md border border-brand px-2 py-1 text-xs text-brand"
                        onClick={() => void activateProvider(provider)}
                      >
                        设为智能助手模型
                      </BareButton>
                    )}
                    <BareButton
                      className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600"
                      onClick={() => void removeProvider(provider)}
                    >
                      删除服务商
                    </BareButton>
                  </div>
                </div>
              </article>
            );
          })}
          {!providers.length && (
            <p className="text-sm text-muted">
              尚未配置模型服务商，请从上方常用服务商开始添加。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function SmartCreationPreparation(props: { testedProviderId?: string }) {
  const client = useStudio();
  const queryClient = useQueryClient();
  const session = useStudioSession();
  const navigate = useNavigate();
  const returnButtonRef = useRef<HTMLButtonElement>(null);
  const { data: engines = [], isFetching } = useQuery({
    queryKey: ["agent-engines"],
    queryFn: client.agentEngines.list,
    refetchInterval: 2_000,
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
  });
  const intent = session.pendingIntent;
  const runnableEngine = engines.find(
    (engine) => engine.canRun ?? engine.status === "available",
  );
  useEffect(() => {
    if (intent && runnableEngine) returnButtonRef.current?.focus();
  }, [intent, runnableEngine]);
  if (!intent) return null;
  const returnTo = safeLocalRoute(intent.returnTo) ?? "/";
  const failureReasons = engines
    .filter((engine) => !(engine.canRun ?? engine.status === "available"))
    .map(
      (engine) =>
        `${engine.name}：${engine.statusMessage ?? "尚未达到可运行状态"}`,
    );
  const returnToCreation = () => {
    if (intent.projectId) session.selectProject(intent.projectId);
    navigate(returnTo);
  };
  const nextStep = !providers.length
    ? "保存一个模型服务商"
    : !props.testedProviderId
      ? "对准备使用的服务商执行连接测试"
      : `将${providers.find((provider) => provider.id === props.testedProviderId)?.title ?? "已测试的服务商"}设为智能助手模型`;
  return (
    <section className="rounded-xl border-2 border-brand bg-brand-soft/40 p-5 shadow-card">
      <p className="studio-eyebrow">智能创作准备</p>
      <h2 className="mt-1 text-xl font-semibold">完成配置后返回原动作</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        原页面、项目、章节和未提交输入已保留。这里不会自动调用模型；返回后仍需由你再次确认原动作。
      </p>
      {!runnableEngine && (
        <div className="mt-4 rounded-lg border border-brand/30 bg-surface p-4 text-sm">
          <p className="text-xs font-medium text-muted">唯一下一步</p>
          <p className="mt-1 font-semibold text-ink">{nextStep}</p>
          <p className="mt-1 text-xs text-muted">
            完成后这里会刷新为下一步；连接或激活失败时不会清除已有安全配置。
          </p>
        </div>
      )}
      {runnableEngine ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <p>
            已刷新确认 {runnableEngine.name}{" "}
            可以运行。正式内容仍未修改，可以安全返回。
          </p>
          <Button
            ref={returnButtonRef}
            className="mt-3"
            onClick={returnToCreation}
          >
            返回继续创作
          </Button>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            {isFetching
              ? "正在刷新智能引擎状态…"
              : "配置尚未达到可运行状态，请按上方顺序完成并重试。"}
          </p>
          {failureReasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {failureReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs">
            原创作草稿和项目内容是安全的；连接失败不会覆盖任何正式内容。
          </p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <BareButton
          className="font-medium text-brand underline"
          onClick={() =>
            void queryClient.invalidateQueries({ queryKey: ["agent-engines"] })
          }
        >
          重新检查引擎状态
        </BareButton>
        <BareButton
          className="text-muted underline"
          onClick={() => {
            session.clearPendingIntent();
            returnToCreation();
          }}
        >
          取消配置并返回
        </BareButton>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const [testedProviderId, setTestedProviderId] = useState<string>();
  return (
    <div className="space-y-5">
      <WorkspaceIntro
        eyebrow="应用与智能能力"
        title="设置中心"
        description="先配置模型服务商，再管理智能引擎、备份、诊断和外部连接。"
        badge="安全配置"
      />
      <SmartCreationPreparation testedProviderId={testedProviderId} />
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-4">
          <p className="studio-eyebrow">外观</p>
          <h2 className="mt-1 text-xl font-semibold">界面主题</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            主题仅保存在本机，并与应用栏中的外观菜单保持同步。
          </p>
        </div>
        <ThemeSettings />
      </section>
      <ProviderSettingsPanel
        onProviderSaved={() => setTestedProviderId(undefined)}
        onProviderTested={setTestedProviderId}
        onProviderActivated={setTestedProviderId}
      />
      <AgentEngineSettingsPanel />
      <Suspense fallback={<LoadingState label="正在加载扩展管理…" />}>
        <ExtensionMarketplace />
        <DeclarativeExtensionUi slot="settings.extensions" />
      </Suspense>
      <BackupPanel />
      <DiagnosticPanel />
      <GenerationLedgerPanel />
    </div>
  );
}

export const AGENT_ENGINE_LABELS: Record<AgentEngineKind, string> = {
  pi: "Pi",
  codex: "Codex",
  langgraph: "LangGraph.js",
};
export const AGENT_EXPERIMENT_ENGINE_LABELS: Record<
  AgentExperimentEngineKind,
  string
> = AGENT_ENGINE_LABELS;

export function AgentEngineSettingsPanel() {
  const client = useStudio();
  const queryClient = useQueryClient();
  const session = useStudioSession();
  const { data: engines = [] } = useQuery({
    queryKey: ["agent-engines"],
    queryFn: client.agentEngines.list,
    refetchInterval: 5_000,
  });
  const { data: globalSettings } = useQuery({
    queryKey: ["global-agent-settings"],
    queryFn: client.agentEngines.getGlobalSettings,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["resource", "providers"],
    queryFn: () => client.resources.list("providers"),
  });
  const { data: codexAuth } = useQuery({
    queryKey: ["codex-auth"],
    queryFn: client.agentEngines.codexAuthStatus,
    refetchInterval: 5_000,
  });
  const { data: credentialStorage } = useQuery({
    queryKey: ["credential-storage-status"],
    queryFn: client.host.getCredentialStorageStatus,
  });
  const [projectId, setProjectId] = useState(
    () => session.activeProjectId ?? "",
  );
  const [globalDefaultEngine, setGlobalDefaultEngine] =
    useState<AgentEngineKind>("pi");
  const [globalModelId, setGlobalModelId] = useState("");
  const [defaultEngine, setDefaultEngine] = useState<AgentEngineKind>("pi");
  const [defaultModelId, setDefaultModelId] = useState("");
  const [codexProviderId, setCodexProviderId] = useState("");
  const [codexProtocol, setCodexProtocol] =
    useState<CodexConnectionProtocol>("chat_completions");
  const [notice, setNotice] = useState<string>();
  const codexProviders = providers.filter((provider) => {
    const payload = recordPayload(provider.payload);
    return (
      payload["服务类型"] === "智能模型" &&
      String(payload["调用协议"] ?? "")
        .toLowerCase()
        .includes("openai")
    );
  });
  const { data: projectSettings } = useQuery({
    queryKey: ["project-agent-settings", projectId],
    queryFn: () => client.agentEngines.getProjectSettings(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (session.activeProjectId && projectId !== session.activeProjectId)
      setProjectId(session.activeProjectId);
  }, [projectId, session.activeProjectId]);
  useEffect(() => {
    if (globalSettings) {
      setGlobalDefaultEngine(globalSettings.defaultEngineKind);
      setGlobalModelId(globalSettings.defaultModel?.modelId ?? "");
    }
  }, [globalSettings]);
  useEffect(() => {
    if (projectSettings) {
      setDefaultEngine(projectSettings.defaultEngineKind);
      setDefaultModelId(projectSettings.defaultModel?.modelId ?? "");
    }
  }, [projectSettings]);
  useEffect(() => {
    if (codexAuth?.provider?.id) setCodexProviderId(codexAuth.provider.id);
    if (codexAuth?.provider?.protocol)
      setCodexProtocol(codexAuth.provider.protocol);
  }, [codexAuth?.provider?.id, codexAuth?.provider?.protocol]);
  const updateGlobalDefault = useMutation({
    mutationFn: () =>
      client.agentEngines.updateGlobalSettings({
        defaultEngineKind: globalDefaultEngine,
        ...(globalModelId.trim()
          ? { defaultModel: { modelId: globalModelId.trim() } }
          : {}),
      }),
    onSuccess: async () => {
      setNotice("全局默认智能引擎已保存");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["global-agent-settings"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-engines"] }),
      ]);
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const updateDefault = useMutation({
    mutationFn: () =>
      client.agentEngines.updateProjectSettings(projectId, {
        defaultEngineKind: defaultEngine,
        ...(defaultModelId.trim()
          ? { defaultModel: { modelId: defaultModelId.trim() } }
          : {}),
      }),
    onSuccess: async () => {
      setNotice("项目默认智能引擎已保存");
      await queryClient.invalidateQueries({
        queryKey: ["project-agent-settings", projectId],
      });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const loginCodex = useMutation({
    mutationFn: async (
      mode:
        | "api_key"
        | "chatgpt_browser"
        | "chatgpt_device_code"
        | "custom_provider",
    ) => {
      if (mode === "custom_provider") {
        if (!codexProviderId)
          throw new Error("请选择要连接到 Codex 的模型服务商");
        return client.agentEngines.codexLogin({
          mode,
          providerId: codexProviderId,
          protocol: codexProtocol,
        });
      }
      if (mode === "api_key") {
        const stored = await client.host.captureCredential({
          purpose: "codex-authentication",
          label: "Codex 接口密钥",
          policyId: "engine.codex.openai.v1",
          allowedOrigin: "https://api.openai.com",
        });
        try {
          return await client.agentEngines.codexLogin({
            mode,
            credentialRef: stored.credentialRef,
          });
        } catch (cause) {
          await client.host.removeCredential(stored.credentialRef);
          throw cause;
        }
      }
      return client.agentEngines.codexLogin({ mode });
    },
    onSuccess: async (result) => {
      if (result.verificationUrl)
        await client.host.openExternal(result.verificationUrl);
      setNotice(
        result.userCode
          ? `请在已打开的页面输入设备码：${result.userCode}`
          : (result.message ?? "Codex 登录流程已启动"),
      );
      await queryClient.invalidateQueries({ queryKey: ["codex-auth"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  const logoutCodex = useMutation({
    mutationFn: client.agentEngines.codexLogout,
    onSuccess: async () => {
      setNotice("已退出 Codex");
      await queryClient.invalidateQueries({ queryKey: ["codex-auth"] });
    },
    onError: (cause) => setNotice(message(cause)),
  });
  return (
    <section className="studio-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="studio-eyebrow">第二步</p>
          <h2 className="mt-1 text-xl font-semibold">智能引擎</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            每次任务只运行你明确选择的引擎。引擎失败时不会自动切换。
          </p>
        </div>
        <span className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">
          {AGENT_ENGINE_LABELS[globalSettings?.defaultEngineKind ?? "pi"]}{" "}
          全局默认
        </span>
      </div>
      <div aria-label="智能引擎状态" className="mt-4 grid gap-3 lg:grid-cols-3">
        {engines.map((engine) => (
          <article
            key={engine.kind}
            className="rounded-xl border border-line bg-surface-raised p-4 shadow-card"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{engine.name}</p>
            </div>
            <p className="mt-1 text-xs text-muted">版本 {engine.version}</p>
            <p
              className={`mt-2 text-sm ${engine.status === "available" ? "text-emerald-700" : "text-amber-700"}`}
            >
              {engine.status === "available"
                ? "运行正常"
                : engine.status === "degraded"
                  ? "运行异常"
                  : "当前不可用"}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted">
              {engine.statusMessage}
            </p>
          </article>
        ))}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
        <label className="grid gap-1 text-sm text-muted">
          全局默认引擎
          <select
            className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
            value={globalDefaultEngine}
            onChange={(event) =>
              setGlobalDefaultEngine(event.target.value as AgentEngineKind)
            }
          >
            {engines.map((engine) => (
              <option key={engine.kind} value={engine.kind}>
                {engine.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-muted">
          全局默认模型（可选）
          <input
            className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
            placeholder="例如：gpt-5.4"
            value={globalModelId}
            onChange={(event) => setGlobalModelId(event.target.value)}
          />
        </label>
        <BareButton
          className="self-end rounded-lg border border-brand px-3 py-2 text-sm font-medium text-brand disabled:opacity-50"
          disabled={updateGlobalDefault.isPending}
          onClick={() => updateGlobalDefault.mutate()}
        >
          {updateGlobalDefault.isPending ? "保存中…" : "保存全局默认值"}
        </BareButton>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="grid gap-1 text-sm text-muted">
          项目
          <select
            className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
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
        </label>
        <label className="grid gap-1 text-sm text-muted">
          项目默认模型（可选）
          <input
            className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
            placeholder="留空时继承全局设置"
            value={defaultModelId}
            onChange={(event) => setDefaultModelId(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm text-muted">
          项目默认引擎
          <select
            className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-ink"
            value={defaultEngine}
            onChange={(event) =>
              setDefaultEngine(event.target.value as AgentEngineKind)
            }
          >
            {engines.map((engine) => (
              <option key={engine.kind} value={engine.kind}>
                {engine.name}
              </option>
            ))}
          </select>
        </label>
        <BareButton
          className="self-end rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!projectId || updateDefault.isPending}
          onClick={() => updateDefault.mutate()}
        >
          {updateDefault.isPending ? "保存中…" : "保存默认引擎"}
        </BareButton>
      </div>
      <div className="mt-5 rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Codex 认证</p>
            <p className="mt-1 text-xs text-muted">
              {codexAuth?.authenticated
                ? codexAuth.provider
                  ? `已连接${codexAuth.provider.name}：${codexAuth.provider.model}（${codexAuth.provider.protocol === "chat_completions" ? "本地 Chat Completions 转换" : "Responses 直连"}）`
                  : `已登录${codexAuth.accountLabel ? `：${codexAuth.accountLabel}` : ""}`
                : (codexAuth?.message ?? "尚未登录")}
            </p>
          </div>
          {codexAuth?.authenticated && (
            <BareButton
              className="rounded-lg border border-line px-3 py-2 text-sm"
              disabled={logoutCodex.isPending}
              onClick={() => logoutCodex.mutate()}
            >
              退出 Codex
            </BareButton>
          )}
        </div>
        {codexAuth?.mode !== "custom_provider" && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Codex 模型服务商"
                className="min-w-64 flex-1 rounded-lg border border-line px-3 py-2 text-sm"
                value={codexProviderId}
                onChange={(event) => {
                  const providerId = event.target.value;
                  const provider = codexProviders.find(
                    (candidate) => candidate.id === providerId,
                  );
                  setCodexProviderId(providerId);
                  setCodexProtocol(
                    recommendedCodexConnectionProtocol(
                      provider
                        ? recordPayload(provider.payload)["预设服务商"]
                        : undefined,
                    ),
                  );
                }}
                disabled={
                  credentialStorage?.available !== true || loginCodex.isPending
                }
              >
                <option value="">选择已有的 OpenAI 兼容服务商</option>
                {codexProviders.map((provider) => {
                  const payload = recordPayload(provider.payload);
                  return (
                    <option key={provider.id} value={provider.id}>
                      {provider.title} ·{" "}
                      {String(payload["模型名称"] ?? "未选模型")}
                    </option>
                  );
                })}
              </select>
              <select
                aria-label="Codex 连接协议"
                className="min-w-56 rounded-lg border border-line px-3 py-2 text-sm"
                value={codexProtocol}
                onChange={(event) =>
                  setCodexProtocol(
                    event.target.value as CodexConnectionProtocol,
                  )
                }
                disabled={loginCodex.isPending}
              >
                <option value="responses">Responses：直接连接</option>
                <option value="chat_completions">
                  Chat Completions：本地转换
                </option>
              </select>
              <BareButton
                className="rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
                disabled={
                  credentialStorage?.available !== true ||
                  !codexProviderId ||
                  loginCodex.isPending
                }
                onClick={() => loginCodex.mutate("custom_provider")}
              >
                使用此服务商连接 Codex
              </BareButton>
            </div>
            <p className="text-xs leading-5 text-muted">
              Responses 模式直接请求
              <code className="mx-1">/v1/responses</code>；Chat Completions
              模式会在本机转换为 Responses，兼容更多厂商，但 Codex 的部分
              高级能力可能受限。目录内仅提供 Chat Completions
              的厂商在首次选择时默认使用转换模式；如果厂商实际支持
              <code className="mx-1">/v1/responses</code>，可手动切换为
              Responses 直连。
            </p>
            <div className="flex flex-wrap gap-2">
              <BareButton
                className="rounded-lg border border-brand px-3 py-2 text-sm text-brand disabled:opacity-50"
                disabled={
                  credentialStorage?.available !== true || loginCodex.isPending
                }
                onClick={() => loginCodex.mutate("api_key")}
              >
                使用接口密钥登录
              </BareButton>
              <BareButton
                className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50"
                disabled={
                  credentialStorage?.available !== true || loginCodex.isPending
                }
                onClick={() => loginCodex.mutate("chatgpt_browser")}
              >
                使用 ChatGPT 登录
              </BareButton>
              <BareButton
                className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50"
                disabled={
                  credentialStorage?.available !== true || loginCodex.isPending
                }
                onClick={() => loginCodex.mutate("chatgpt_device_code")}
              >
                使用设备码登录
              </BareButton>
            </div>
          </div>
        )}
        {credentialStorage?.available === false && (
          <p className="mt-3 text-xs text-amber-700">
            本地凭据库不可用，Codex 登录已禁用；应用不会降级保存明文凭据。
          </p>
        )}
      </div>
      {notice && <p className="mt-3 text-sm text-brand">{notice}</p>}
    </section>
  );
}
