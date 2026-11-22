import { useCallback, useEffect, useState } from "react";
import type { ProvidersCatalogResult } from "@dramaip/agents-agents/types";
import {
  messageOf,
  value,
  type AgentsRemote,
  type EngineSettings,
  type ProviderRecord,
  type SystemRemote,
  type VaultState,
} from "./ai-settings.ts";

/** How long to wait before each retry of a failed vault read. */
const VAULT_RETRY_MS = [1_000, 2_000, 4_000] as const;

/** What the AI model settings read: providers, the vault and the default. */
export interface AiSettingsData {
  catalog: ProvidersCatalogResult | undefined;
  providers: readonly ProviderRecord[];
  /** Undefined while the vault is first being read. */
  vault: VaultState | undefined;
  /** The provider the assistant uses now, when one is set. */
  activeProviderId: string | undefined;
  /** Read the providers again after a write. */
  reload: () => void;
  /** Read the vault state again, retrying from the start. */
  reloadVault: () => void;
  /** Read the default model settings again after an activation. */
  reloadSettings: () => void;
  /** Changes whenever the default model settings may have changed. */
  settingsRevision: number;
}

/**
 * Read everything the AI model settings show. A vault read that fails is
 * retried a few times, since the vault opens a moment after the app starts.
 */
export function useAiSettingsData(
  agents: AgentsRemote,
  system: SystemRemote,
): AiSettingsData {
  const [catalog, setCatalog] = useState<ProvidersCatalogResult>();
  const [providers, setProviders] = useState<readonly ProviderRecord[]>([]);
  const [vault, setVault] = useState<VaultState>();
  const [activeProviderId, setActiveProviderId] = useState<string>();
  const [providersRevision, setProvidersRevision] = useState(0);
  const [vaultRevision, setVaultRevision] = useState(0);
  const [settingsRevision, setSettingsRevision] = useState(0);

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
    void value<EngineSettings>(agents.enginesGetGlobalSettings()).then(
      (next) => {
        if (live) setActiveProviderId(next.activeProviderId);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [agents, settingsRevision]);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (attempt: number) => {
      void value<VaultState>(system.credentialStatus()).then(
        (next) => {
          if (live) setVault(next);
        },
        (cause: unknown) => {
          if (!live) return;
          const wait = VAULT_RETRY_MS[attempt];
          if (wait !== undefined) {
            timer = setTimeout(() => read(attempt + 1), wait);
            return;
          }
          setVault({
            available: false,
            storage: "unavailable",
            locked: false,
            message: messageOf(cause),
          });
        },
      );
    };
    read(0);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [system, vaultRevision]);

  const reload = useCallback(() => setProvidersRevision((n) => n + 1), []);
  const reloadVault = useCallback(() => setVaultRevision((n) => n + 1), []);
  const reloadSettings = useCallback(
    () => setSettingsRevision((n) => n + 1),
    [],
  );
  return {
    catalog,
    providers,
    vault,
    activeProviderId,
    reload,
    reloadVault,
    reloadSettings,
    settingsRevision,
  };
}
