import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import { Button, Modal } from "@dramaip/infra-ui-primitives";
import type {
  ProviderCatalogPreset,
  ProvidersCatalogResult,
} from "@dramaip/agents-agents/types";
import {
  captureCredential,
  messageOf,
  providerDiscoveredModels,
  value,
  type AgentsRemote,
  type ProviderRecord,
  type ProviderVerdict,
  type SystemRemote,
  type VaultState,
  unlockVault,
} from "./ai-settings.ts";
import css from "./AiSection.module.css";

type Translate = TranslateNS<"agents">;

/** The service types a hand-filled provider offers, as stored. */
const SERVICE_TYPES = [
  ["智能模型", "ai.serviceType.text"],
  ["图片生成", "ai.serviceType.image"],
  ["语音生成", "ai.serviceType.voice"],
  ["视频生成", "ai.serviceType.video"],
] as const;

/** The call protocols a hand-filled provider offers, as stored. */
const PROTOCOLS = [
  "OpenAI 兼容文本",
  "Anthropic",
  "Google Gemini",
  "OpenAI 兼容图片",
  "OpenAI 兼容语音",
  "OpenAI 兼容视频",
  "Stable Diffusion WebUI",
] as const;

const TEXT_MODEL = SERVICE_TYPES[0][0];
const DEFAULT_PROTOCOL = PROTOCOLS[0];

/** A preset id, or `other` for a provider filled in by hand. */
type Choice = string;

const recommended = (preset: ProviderCatalogPreset | undefined) =>
  preset?.models.find((model) => model.recommended)?.id ??
  preset?.models[0]?.id ??
  "";

/** Props of the model providers panel. */
export interface ProvidersPanelProps {
  t: Translate;
  agents: AgentsRemote;
  system: SystemRemote;
  catalog: ProvidersCatalogResult | undefined;
  providers: readonly ProviderRecord[];
  vault: VaultState | undefined;
  /** Read the providers again after a write. */
  reload: () => void;
  /** Read the vault state again after an unlock. */
  reloadVault: () => void;
  onSaved: () => void;
  onTested: (providerId: string) => void;
  onActivated: (providerId: string) => void;
}

/**
 * The model providers: a form over the catalog presets (or a provider filled
 * in by hand) and the saved providers. Keys go through the shell's capture
 * window into the vault; the provider keeps only the reference.
 */
export function ProvidersPanel(props: ProvidersPanelProps) {
  const { t, agents, system, catalog, providers, vault } = props;
  const presets = catalog?.providers ?? [];
  const [choice, setChoice] = useState<Choice>("");
  const [modelId, setModelId] = useState("");
  const [refreshKey, setRefreshKey] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customServiceType, setCustomServiceType] =
    useState<string>(TEXT_MODEL);
  const [customModel, setCustomModel] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customProtocol, setCustomProtocol] =
    useState<string>(DEFAULT_PROTOCOL);
  const [editing, setEditing] = useState<ProviderRecord>();
  const [saving, setSaving] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [removing, setRemoving] = useState<ProviderRecord>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const formRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const credentialCopy = {
    cancelled: t("ai.credential.cancelled"),
    expired: t("ai.credential.expired"),
  };

  // The form starts on the first preset once the catalog arrives.
  useEffect(() => {
    if (choice || !presets[0]) return;
    setChoice(presets[0].id);
    setModelId(recommended(presets[0]));
  }, [choice, presets]);

  useEffect(() => {
    if (!editing) return;
    formRef.current?.scrollIntoView({ block: "start" });
    selectRef.current?.focus({ preventScroll: true });
  }, [editing]);

  const preset =
    choice === "other" ? undefined : presets.find(({ id }) => id === choice);
  const modelBaseUrl =
    preset?.models.find((model) => model.id === modelId)?.baseUrl ??
    preset?.baseUrl;
  const needsEndpoint = Boolean(
    preset && (!modelBaseUrl || /[{}]/.test(modelBaseUrl)),
  );
  const editingPayload = editing?.payload ?? {};
  const selectableModels = preset
    ? [
        ...preset.models.map((model) => ({
          id: model.id,
          label: model.recommended
            ? t("providers.model.recommended", { label: model.label })
            : model.label,
        })),
        ...providerDiscoveredModels(editingPayload)
          .filter((id) => !preset.models.some((model) => model.id === id))
          .map((id) => ({ id, label: t("providers.model.available", { id }) })),
        ...(modelId && !preset.models.some((model) => model.id === modelId)
          ? [
              {
                id: modelId,
                label: t("providers.model.saved", { id: modelId }),
              },
            ]
          : []),
      ]
    : [];

  const select = (next: Choice) => {
    setChoice(next);
    setEditing(undefined);
    setRefreshKey(false);
    setError(undefined);
    setNotice(undefined);
    setCustomBaseUrl("");
    if (next === "other") {
      setCustomName("");
      setCustomServiceType(TEXT_MODEL);
      setCustomModel("");
      setCustomBaseUrl("");
      setCustomProtocol(DEFAULT_PROTOCOL);
      setModelId("");
      return;
    }
    setModelId(recommended(presets.find(({ id }) => id === next)));
  };

  const edit = (provider: ProviderRecord) => {
    const payload = provider.payload;
    const presetId = String(payload["预设服务商"] ?? "");
    setEditing(provider);
    setChoice(presets.some(({ id }) => id === presetId) ? presetId : "other");
    setModelId(String(payload["模型名称"] ?? ""));
    setRefreshKey(false);
    setCustomName(provider.title);
    setCustomServiceType(String(payload["服务类型"] ?? TEXT_MODEL));
    setCustomModel(String(payload["模型名称"] ?? ""));
    setCustomBaseUrl(String(payload["服务地址"] ?? ""));
    setCustomProtocol(String(payload["调用协议"] ?? DEFAULT_PROTOCOL));
    setError(undefined);
    setNotice(undefined);
  };

  const reset = () => select(presets[0]?.id ?? "other");

  const save = async () => {
    const previousRef = String(editingPayload["凭据引用"] ?? "").trim();
    const model = preset ? modelId.trim() : customModel.trim();
    const title = preset?.name ?? customName.trim();
    const protocol = preset?.protocol ?? customProtocol.trim();
    const serviceType = preset ? TEXT_MODEL : customServiceType.trim();
    const baseUrl =
      preset && !needsEndpoint ? modelBaseUrl : customBaseUrl.trim();
    const keyless =
      !preset && protocol.toLowerCase().includes("stable diffusion");
    if (!title || !serviceType || !model || !protocol) {
      setError(t("providers.incomplete"));
      return;
    }
    if (preset && (!baseUrl || /[{}]/.test(baseUrl))) {
      setError(t("providers.endpointRequired"));
      return;
    }
    const needsKey = !keyless && (!previousRef || refreshKey);
    if (needsKey && vault?.available !== true) {
      setError(t("providers.vaultRequired"));
      return;
    }
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    let newRef: string | undefined;
    try {
      if (needsKey)
        newRef = await captureCredential(
          system,
          {
            purpose: "provider-authentication",
            label: t("providers.key.label", { name: title }),
            policyId: preset
              ? `provider.catalog.${preset.id}`
              : "provider.custom.reauthorization-required",
            ...(baseUrl ? { allowedOrigin: new URL(baseUrl).origin } : {}),
          },
          credentialCopy,
        );
      const credentialRef = newRef ?? previousRef;
      const payload: Record<string, unknown> = {
        ...editingPayload,
        服务类型: serviceType,
        模型名称: model,
        服务地址: baseUrl,
        调用协议: protocol,
        ...(credentialRef ? { 凭据引用: credentialRef } : {}),
        ...(preset
          ? {
              预设服务商: preset.id,
              Pi服务商: preset.id,
              模型目录版本: catalog?.release,
              模型目录核对日期: catalog?.updatedAt,
            }
          : { 预设服务商: "other", Pi服务商: undefined }),
      };
      if (editing)
        await value(
          agents.providersUpdate(
            editing.id,
            { title, payload, version: editing.version } as never,
            `"${editing.version}"`,
            crypto.randomUUID(),
          ),
        );
      else
        await value(
          agents.providersCreate(
            { title, payload } as never,
            undefined,
            crypto.randomUUID(),
          ),
        );
      if (newRef && previousRef && previousRef !== newRef)
        await value(system.removeCredential(previousRef));
      setRefreshKey(false);
      setEditing(undefined);
      setNotice(t("providers.saved", { name: title }));
      props.onSaved();
      props.reload();
    } catch (cause) {
      if (newRef)
        await value(system.removeCredential(newRef)).catch(() => undefined);
      setError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (provider: ProviderRecord) => {
    setRemoving(undefined);
    setError(undefined);
    const credentialRef = String(provider.payload["凭据引用"] ?? "").trim();
    try {
      await value(
        agents.providersDelete(provider.id, undefined, crypto.randomUUID()),
      );
      if (credentialRef)
        await value(system.removeCredential(credentialRef)).catch(
          () => undefined,
        );
      if (editing?.id === provider.id) reset();
      props.reload();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const test = async (provider: ProviderRecord) => {
    setError(undefined);
    setNotice(undefined);
    try {
      const verdict = await value<ProviderVerdict>(
        agents.providersTestConnection(
          provider.id,
          undefined,
          undefined,
          crypto.randomUUID(),
        ),
      );
      props.reload();
      if (editing?.id === provider.id)
        edit(await value<ProviderRecord>(agents.providersGet(provider.id)));
      setNotice(
        t("ai.result", { name: provider.title, message: verdict.message }),
      );
      if (verdict.ok) props.onTested(provider.id);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const activate = async (provider: ProviderRecord) => {
    setError(undefined);
    setNotice(undefined);
    try {
      const verdict = await value<ProviderVerdict>(
        agents.providersActivateForAgent(
          provider.id,
          undefined,
          undefined,
          crypto.randomUUID(),
        ),
      );
      setNotice(
        t("ai.result", { name: provider.title, message: verdict.message }),
      );
      props.onActivated(provider.id);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const unlock = async () => {
    setUnlocking(true);
    try {
      await unlockVault(system, {
        cancelled: t("ai.vault.cancelled"),
        expired: t("ai.vault.expired"),
      });
      props.reloadVault();
      setNotice(t("providers.unlocked"));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <section className={clsx(css.card, css.flush)}>
      <div className={css.banner}>
        <div className={css.head}>
          <div>
            <p className={css.eyebrow}>{t("providers.step")}</p>
            <h2 className={css.title}>{t("providers.title")}</h2>
            <p className={css.muted}>{t("providers.description")}</p>
          </div>
          {catalog && (
            <span className={css.badge}>
              {t("providers.catalog", {
                date: catalog.updatedAt,
                release: catalog.release,
              })}
            </span>
          )}
        </div>
      </div>

      <div ref={formRef} className={css.body}>
        {editing && (
          <div className={css.editing} role="status" aria-live="polite">
            <p className={css.strong}>
              {t("providers.editing", { name: editing.title })}
            </p>
            <p className={css.small}>{t("providers.editingHint")}</p>
          </div>
        )}
        <div className={css.grid3}>
          <label className={css.field}>
            {t("providers.preset")}
            <select
              ref={selectRef}
              className={css.control}
              value={choice}
              onChange={(event) => select(event.target.value)}
            >
              {presets.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
              <option value="other">{t("providers.other")}</option>
            </select>
          </label>

          {preset ? (
            <label className={css.field}>
              {t("providers.model")}
              <select
                className={css.control}
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              >
                {selectableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className={css.field}>
              {t("providers.name")}
              <input
                className={css.control}
                placeholder={t("providers.name.placeholder")}
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
              />
            </label>
          )}

          <div className={css.field}>
            {t("providers.key")}
            <button
              type="button"
              className={css.keyButton}
              disabled={vault?.available !== true}
              onClick={() => setRefreshKey(true)}
            >
              {t(
                refreshKey
                  ? "providers.key.refresh"
                  : editing
                    ? "providers.key.keep"
                    : "providers.key.new",
              )}
            </button>
          </div>
        </div>

        {needsEndpoint && (
          <label className={css.field}>
            {t("providers.baseUrl")}
            <input
              className={css.control}
              placeholder={modelBaseUrl || t("providers.baseUrl.placeholder")}
              value={customBaseUrl}
              onChange={(event) => setCustomBaseUrl(event.target.value)}
            />
          </label>
        )}

        {!preset && (
          <div className={css.grid4}>
            <label className={css.field}>
              {t("providers.serviceType")}
              <select
                className={css.control}
                value={customServiceType}
                onChange={(event) => setCustomServiceType(event.target.value)}
              >
                {SERVICE_TYPES.map(([stored, key]) => (
                  <option key={stored} value={stored}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </label>
            <label className={css.field}>
              {t("providers.modelName")}
              <input
                className={css.control}
                placeholder={t("providers.modelName.placeholder")}
                value={customModel}
                onChange={(event) => setCustomModel(event.target.value)}
              />
            </label>
            <label className={css.field}>
              {t("providers.baseUrl")}
              <input
                className={css.control}
                placeholder={t("providers.baseUrl.placeholder")}
                value={customBaseUrl}
                onChange={(event) => setCustomBaseUrl(event.target.value)}
              />
            </label>
            <label className={css.field}>
              {t("providers.protocol")}
              <select
                className={css.control}
                value={customProtocol}
                onChange={(event) => setCustomProtocol(event.target.value)}
              >
                {PROTOCOLS.map((protocol) => (
                  <option key={protocol} value={protocol}>
                    {protocol}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className={css.footer}>
          <div className={css.notes}>
            {preset?.apiKeyUrl && (
              <button
                type="button"
                className={css.link}
                onClick={() => {
                  if (preset.apiKeyUrl)
                    void system.openExternal(preset.apiKeyUrl);
                }}
              >
                {t("providers.keyPage")}
              </button>
            )}
            <span>{t("providers.keyNote")}</span>
          </div>
          <div className={css.row}>
            {editing && (
              <Button variant="outline" onClick={reset}>
                {t("providers.cancelEdit")}
              </Button>
            )}
            <Button
              variant="primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {t(
                saving
                  ? "ai.saving"
                  : editing
                    ? "providers.saveEdit"
                    : "providers.add",
              )}
            </Button>
          </div>
        </div>

        {vault?.available === true && vault.message && (
          <p className={css.notice} role="status">
            {vault.message}
          </p>
        )}
        {vault?.available === false && (
          <div className={css.warning}>
            <span>{vault.message ?? t("providers.vaultUnavailable")}</span>
            {vault.locked && vault.storage === "master_password" && (
              <Button
                variant="outline"
                size="sm"
                disabled={unlocking}
                onClick={() => void unlock()}
              >
                {t(unlocking ? "providers.unlocking" : "providers.unlock")}
              </Button>
            )}
          </div>
        )}
        {notice && <p className={css.notice}>{notice}</p>}
        {error && <p className={css.danger}>{error}</p>}

        <div className={css.grid2}>
          {providers.map((provider) => {
            const current = editing?.id === provider.id;
            return (
              <article
                key={provider.id}
                aria-label={t("providers.card", { name: provider.title })}
                className={clsx(css.provider, current && css.current)}
              >
                <div className={css.head}>
                  <div>
                    <p className={css.strong}>{provider.title}</p>
                    <p className={css.muted}>
                      {String(
                        provider.payload["模型名称"] ?? t("providers.noModel"),
                      )}
                    </p>
                    <p className={css.small}>
                      {String(
                        provider.payload["连接状态"] ?? t("providers.untested"),
                      )}
                    </p>
                  </div>
                  <div className={css.actions}>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-pressed={current}
                      disabled={current}
                      onClick={() => edit(provider)}
                    >
                      {t(current ? "providers.editingNow" : "providers.edit")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void test(provider)}
                    >
                      {t("providers.test")}
                    </Button>
                    {provider.payload["服务类型"] === TEXT_MODEL && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void activate(provider)}
                      >
                        {t("providers.activate")}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className={css.dangerButton}
                      onClick={() => setRemoving(provider)}
                    >
                      {t("providers.remove")}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
          {!providers.length && (
            <p className={css.muted}>{t("providers.empty")}</p>
          )}
        </div>
      </div>
      <Modal
        open={removing !== undefined}
        onClose={() => setRemoving(undefined)}
        title={t("providers.remove.confirm", { name: removing?.title ?? "" })}
        closeLabel={t("ai.close")}
        footer={
          <>
            <Button variant="outline" onClick={() => setRemoving(undefined)}>
              {t("ai.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => removing && void remove(removing)}
            >
              {t("providers.remove.action")}
            </Button>
          </>
        }
      />
    </section>
  );
}
