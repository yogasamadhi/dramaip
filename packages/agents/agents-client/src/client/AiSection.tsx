import { useCallback, useEffect, useState } from "react";
import type { PropsLocale, PropsRuntime } from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/infra-ui-settings/client";
import type { ProvidersCatalogResult } from "@dramaip/agents-agents/types";
import {
  value,
  type AgentsRemote,
  type ProviderRecord,
  type SystemRemote,
  type VaultState,
  type WorkspaceRemote,
} from "./ai-settings.ts";
import { EnginesPanel } from "./EnginesPanel.tsx";
import { ProvidersPanel } from "./ProvidersPanel.tsx";
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

/**
 * The AI connections: the model providers first, then the agent engines and
 * their global and project defaults.
 */
export function AiSection({
  agents,
  system,
  workspace,
  announce,
  t,
}: AiSectionProps) {
  const [catalog, setCatalog] = useState<ProvidersCatalogResult>();
  const [providers, setProviders] = useState<readonly ProviderRecord[]>([]);
  const [vault, setVault] = useState<VaultState>();
  const [providersRevision, setProvidersRevision] = useState(0);
  const [vaultRevision, setVaultRevision] = useState(0);
  const [enginesRevision, setEnginesRevision] = useState(0);
  useEffect(() => {
    let live = true;
    void value<ProvidersCatalogResult>(agents.providersCatalog()).then(
      (next) => {
        if (live) setCatalog(next);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [agents]);
  useEffect(() => {
    let live = true;
    void value<ProviderRecord[]>(agents.providersList(undefined)).then(
      (next) => {
        if (live) setProviders(next);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [agents, providersRevision]);
  useEffect(() => {
    let live = true;
    void value<VaultState>(system.credentialStatus()).then(
      (next) => {
        if (live) setVault(next);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [system, vaultRevision]);
  const reload = useCallback(() => setProvidersRevision((n) => n + 1), []);
  return (
    <div className={css.section}>
      <ProvidersPanel
        t={t}
        agents={agents}
        system={system}
        catalog={catalog}
        providers={providers}
        vault={vault}
        reload={reload}
        reloadVault={() => setVaultRevision((n) => n + 1)}
        onSaved={() => announce(undefined)}
        onTested={announce}
        onActivated={(providerId) => {
          announce(providerId);
          setEnginesRevision((n) => n + 1);
        }}
      />
      <EnginesPanel
        t={t}
        agents={agents}
        workspace={workspace}
        revision={enginesRevision}
      />
    </div>
  );
}
