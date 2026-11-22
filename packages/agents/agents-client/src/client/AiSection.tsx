import type { PropsLocale, PropsRuntime } from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/infra-ui-settings/client";
import {
  providerDiscoveredModels,
  type AgentsRemote,
  type ProviderRecord,
  type SystemRemote,
  type WorkspaceRemote,
} from "./ai-settings.ts";
import { CloudAiPanel } from "./CloudAiPanel.tsx";
import { EnginesPanel } from "./EnginesPanel.tsx";
import { ProvidersPanel } from "./ProvidersPanel.tsx";
import { useAiSettingsData } from "./use-ai-settings.ts";
import css from "./AiSection.module.css";

/** Injected face: the namespaces the section reads and writes. */
export interface AiSectionInjected {
  agents: AgentsRemote;
  system: SystemRemote;
  workspace: WorkspaceRemote;
  /**
   * Tell the page which provider last passed its connection test or was
   * made the assistant's, or that none has since a save.
   */
  announce: (providerId: string | undefined) => void;
}

/** Full component props of the AI connection settings section. */
export type AiSectionProps = PropsRuntime<"settings.section"> &
  PropsLocale<"agents"> &
  AiSectionInjected;

/** The language models the saved providers offer, each once. */
export function providerModels(providers: readonly ProviderRecord[]): string[] {
  const models = new Set<string>();
  for (const provider of providers) {
    if (provider.payload["服务类型"] !== "智能模型") continue;
    const model = String(provider.payload["模型名称"] ?? "").trim();
    if (model) models.add(model);
    for (const id of providerDiscoveredModels(provider.payload)) models.add(id);
  }
  return [...models];
}

/**
 * The AI model settings: add a model provider (saving it makes it the
 * default), then, folded away, the default models per project.
 */
export function AiSection({
  agents,
  system,
  workspace,
  announce,
  t,
}: AiSectionProps) {
  const data = useAiSettingsData(agents, system);
  const active = data.providers.find(({ id }) => id === data.activeProviderId);
  const modelProviders =
    active?.payload["认证方式"] === "hosted" ||
    active?.payload["认证方式"] === "piSubscription"
      ? [active]
      : data.providers.filter(
          ({ payload }) => payload["认证方式"] !== "hosted",
        );
  return (
    <div className={css.section}>
      <CloudAiPanel
        t={t}
        agents={agents}
        system={system}
        providers={data.providers}
        activeProviderId={data.activeProviderId}
        byokEditor={
          <ProvidersPanel
            t={t}
            agents={agents}
            system={system}
            catalog={data.catalog}
            providers={data.providers}
            vault={data.vault}
            activeProviderId={data.activeProviderId}
            reload={data.reload}
            reloadVault={data.reloadVault}
            onSaved={() => announce(undefined)}
            onTested={announce}
            onActivated={(providerId) => {
              announce(providerId);
              data.reloadSettings();
            }}
          />
        }
        onSaved={data.reload}
        onActivated={(providerId) => {
          data.reload();
          data.reloadSettings();
          announce(providerId);
        }}
      />

      <EnginesPanel
        t={t}
        agents={agents}
        workspace={workspace}
        revision={data.settingsRevision}
        models={providerModels(modelProviders)}
      />
    </div>
  );
}
