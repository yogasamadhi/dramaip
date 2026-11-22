import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import type { SystemCloudAiSummary } from "@dramaip/system-system/types";
import {
  messageOf,
  value,
  type AgentsRemote,
  type ProviderRecord,
  type SystemRemote,
} from "./ai-settings.ts";
import { connectProvider } from "./ProvidersPanel.tsx";
import css from "./AiSection.module.css";

type Mode = "hosted" | "byok";
const cloudPreference = "dramaip.ai.cloud-model";
const byokPreference = "dramaip.ai.byok-provider";

function readPreference(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage can be disabled. */
  }
}

interface CloudAiPanelProps {
  agents: AgentsRemote;
  system: SystemRemote;
  t: TranslateNS<"agents">;
  providers: readonly ProviderRecord[];
  activeProviderId: string | undefined;
  byokEditor: ReactNode;
  onSaved(): void;
  onActivated(providerId: string): void;
}

export function CloudAiPanel({
  agents,
  system,
  t,
  providers,
  activeProviderId,
  byokEditor,
  onSaved,
  onActivated,
}: CloudAiPanelProps) {
  const headingId = useId();
  const configurationId = useId();
  const active = providers.find(({ id }) => id === activeProviderId);
  const mode: Mode =
    active?.payload["认证方式"] === "hosted" ? "hosted" : "byok";
  const byokProviders = providers.filter(
    ({ payload }) =>
      payload["认证方式"] !== "hosted" && payload["服务类型"] === "智能模型",
  );
  const [lastByok, setLastByok] = useState(() =>
    readPreference(byokPreference),
  );
  const [savedCloud, setSavedCloud] = useState(() =>
    readPreference(cloudPreference),
  );
  const [panel, setPanel] = useState<Mode>();
  const [state, setState] = useState<SystemCloudAiSummary>();
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [revision, setRevision] = useState(0);
  const activePanel = panel ?? mode;
  const showCloudSettings = activePanel === "hosted" && state?.signedIn;
  const byok =
    byokProviders.find(
      ({ id }) => id === (mode === "byok" ? activeProviderId : lastByok),
    ) ?? byokProviders[0];
  const activeCloud =
    mode === "hosted" ? String(active?.payload["模型名称"] ?? "") : "";
  const savedModel =
    activeCloud ||
    savedCloud ||
    String(
      providers.find(({ payload }) => payload["认证方式"] === "hosted")
        ?.payload["模型名称"] ?? "",
    );
  const models = state?.models ?? [];
  const defaultCloud = models.includes(savedModel)
    ? savedModel
    : models.length === 1
      ? (models[0] ?? "")
      : "";
  const model =
    draft !== undefined && (!draft || models.includes(draft))
      ? draft
      : defaultCloud;
  const cloudName = (id: string) => {
    const name = state?.modelNames?.[id];
    return typeof name === "string" ? name : id;
  };

  useEffect(() => {
    if (mode !== "byok" || !activeProviderId) return;
    setLastByok(activeProviderId);
    writePreference(byokPreference, activeProviderId);
  }, [mode, activeProviderId]);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const summary = await value<SystemCloudAiSummary>(
          system.cloudAiSummary(),
        );
        if (!live) return;
        setState(summary);
        if (summary.pending) timer = setTimeout(() => void read(), 1500);
      } catch (cause) {
        if (live) setError(messageOf(cause));
      }
    }
    void read();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [system, revision]);

  async function perform(work: () => Promise<void>, refresh = false) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await work();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
      if (refresh) setRevision((current) => current + 1);
    }
  }

  function rememberCloud() {
    setSavedCloud(model);
    setDraft(undefined);
    writePreference(cloudPreference, model);
  }

  async function useCloud() {
    const saved = providers.find(
      ({ payload }) =>
        payload["认证方式"] === "hosted" && payload["模型名称"] === model,
    );
    const provider =
      saved ??
      (await value<ProviderRecord>(
        agents.providersCreate(
          {
            title: cloudName(model),
            payload: {
              服务类型: "智能模型",
              模型名称: model,
              认证方式: "hosted",
            },
          } as never,
          undefined,
          crypto.randomUUID(),
        ),
      ));
    if (!saved) onSaved();
    await connectProvider(agents, { id: provider.id, model });
    rememberCloud();
    setPanel("hosted");
    setNotice(t(mode === "hosted" ? "cloud.saved" : "cloud.enabled"));
    onActivated(provider.id);
  }

  async function useByok(provider: ProviderRecord) {
    await connectProvider(agents, {
      id: provider.id,
      model: String(provider.payload["模型名称"] ?? ""),
    });
    setPanel("byok");
    setNotice(t("cloud.byokEnabled"));
    onActivated(provider.id);
  }

  const accountUrl = state?.accountUrl;
  const cloudReady = Boolean(state?.signedIn && !state.message && model);
  const cloudDetail = !state
    ? t("cloud.loading")
    : !state.available || (state.signedIn && state.message)
      ? t("cloud.unavailable")
      : !state.signedIn
        ? t("cloud.signedOut")
        : activeCloud || defaultCloud
          ? cloudName(activeCloud || defaultCloud)
          : t(models.length ? "cloud.chooseModel" : "cloud.noModels");

  return (
    <>
      <section className={css.card} aria-labelledby={headingId}>
        <h2 id={headingId} className={css.title}>
          {t("cloud.modeHeading")}
        </h2>
        <p className={css.muted}>{t("cloud.modeDescription")}</p>
        <div className={css.modeGrid}>
          <section
            className={css.modeOption}
            data-active={mode === "hosted"}
            aria-label={t("cloud.title")}
          >
            <div className={css.modeTitle}>
              <h3>{t("cloud.title")}</h3>
              {mode === "hosted" && (
                <span className={css.badge}>{t("cloud.active")}</span>
              )}
            </div>
            <p className={css.muted}>{t("cloud.description")}</p>
            <strong className={css.strong}>{cloudDetail}</strong>
            <div className={css.modeActions}>
              {state?.signedIn && mode !== "hosted" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || !cloudReady}
                  onClick={() => void perform(useCloud)}
                >
                  {t("cloud.activate")}
                </Button>
              )}
              {state?.signedIn ? (
                <Button
                  variant="outline"
                  size="sm"
                  aria-pressed={showCloudSettings}
                  aria-controls={configurationId}
                  onClick={() => setPanel("hosted")}
                >
                  {t("cloud.accountHeading")}
                </Button>
              ) : (
                state?.available && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy || state.pending}
                    onClick={() =>
                      void perform(async () => {
                        await value(system.cloudAiSignIn());
                        setPanel("hosted");
                      }, true)
                    }
                  >
                    {t(state.pending ? "cloud.pending" : "cloud.signIn")}
                  </Button>
                )
              )}
            </div>
            {state?.message && (
              <p role="status" className={css.warning}>
                {t(
                  state.message === "CLOUD_AI_LOGIN_FAILED"
                    ? "cloud.loginFailed"
                    : state.message === "CLOUD_AI_SIGN_IN_REQUIRED"
                      ? "cloud.signInAgain"
                      : "cloud.unavailable",
                )}
              </p>
            )}
          </section>
          <section
            className={css.modeOption}
            data-active={mode === "byok" && !!active}
            aria-label={t("cloud.byok")}
          >
            <div className={css.modeTitle}>
              <h3>{t("cloud.byok")}</h3>
              {mode === "byok" && active && (
                <span className={css.badge}>{t("cloud.active")}</span>
              )}
            </div>
            <p className={css.muted}>{t("cloud.byokDescription")}</p>
            <strong className={css.strong}>
              {byok
                ? String(byok.payload["模型名称"] ?? byok.title)
                : t("cloud.byokMissing")}
            </strong>
            <div className={css.modeActions}>
              {mode !== "byok" && byok && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void perform(() => useByok(byok))}
                >
                  {t("cloud.activateByok")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                aria-pressed={!showCloudSettings}
                aria-controls={configurationId}
                onClick={() => setPanel("byok")}
              >
                {t("cloud.configureByok")}
              </Button>
            </div>
          </section>
        </div>
        {error && (
          <p role="alert" className={css.danger}>
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className={css.success}>
            {notice}
          </p>
        )}
      </section>
      <div id={configurationId}>
        <div hidden={showCloudSettings}>{byokEditor}</div>
        {showCloudSettings && (
          <section className={css.card} aria-label={t("cloud.accountHeading")}>
            <h2 className={css.title}>{t("cloud.accountHeading")}</h2>
            <div className={css.cloudAccount}>
              <strong>{state.email}</strong>
              {typeof state.remainingTokens === "number" && (
                <span>
                  {t("cloud.balance", {
                    count: state.remainingTokens.toLocaleString(),
                  })}
                </span>
              )}
            </div>
            <div className={css.modeActions}>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setRevision((current) => current + 1)}
              >
                {t("cloud.refresh")}
              </Button>
              {accountUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await value(system.openExternal(accountUrl));
                    })
                  }
                >
                  {t("cloud.account")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await value(system.cloudAiSignOut());
                    setDraft(undefined);
                  }, true)
                }
              >
                {t("cloud.signOut")}
              </Button>
            </div>
            {!state.message &&
              (models.length ? (
                <div className={css.row}>
                  <label className={css.field}>
                    {t("cloud.model")}
                    <select
                      className={css.control}
                      value={model}
                      disabled={busy}
                      onChange={(event) => setDraft(event.target.value)}
                    >
                      <option value="">{t("cloud.chooseModel")}</option>
                      {models.map((id) => (
                        <option key={id} value={id}>
                          {cloudName(id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !model || model === savedModel}
                    onClick={() =>
                      void perform(async () => {
                        if (mode === "hosted") await useCloud();
                        else {
                          rememberCloud();
                          setNotice(t("cloud.saved"));
                        }
                      })
                    }
                  >
                    {t("cloud.save")}
                  </Button>
                </div>
              ) : (
                <p className={css.muted}>{t("cloud.noModels")}</p>
              ))}
          </section>
        )}
      </div>
    </>
  );
}
