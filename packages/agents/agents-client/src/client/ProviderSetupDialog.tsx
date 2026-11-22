import type { FactoryComponentPropsOf } from "@dramaip/infra-ui-slots";
import { Modal } from "@dramaip/infra-ui-primitives";
import type { AgentsRemote, SystemRemote } from "./ai-settings.ts";
import { CloudAiPanel } from "./CloudAiPanel.tsx";
import { ProvidersPanel } from "./ProvidersPanel.tsx";
import { useAiSettingsData } from "./use-ai-settings.ts";
import css from "./AiSection.module.css";

/** Injected face of the inline model setup. */
export interface ProviderSetupRemotes {
  agents: AgentsRemote;
  system: SystemRemote;
}

/** What the page that opens the inline model setup hands it. */
export interface ProviderSetupProps {
  open: boolean;
  /** Closed without a usable model. */
  onClose(): void;
  /** A model was saved and made the default; the page can carry on. */
  onReady(providerId: string): void;
}

type ProviderSetupComponentProps =
  FactoryComponentPropsOf<"agents.provider-setup">;

/**
 * Set up an AI model without leaving the page: the providers form in a
 * dialog. Saving makes the model the default, and the dialog hands control
 * back so the author carries on where they were.
 */
export function ProviderSetupDialog({
  agents,
  system,
  t,
  open,
  onClose,
  onReady,
}: ProviderSetupComponentProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("setup.title")}
      description={t("setup.description")}
      closeLabel={t("ai.close")}
      className={css.setupDialog ?? ""}
      contentClassName={css.setupBody ?? ""}
    >
      {open && (
        <SetupBody t={t} agents={agents} system={system} onReady={onReady} />
      )}
    </Modal>
  );
}

function SetupBody(props: {
  t: ProviderSetupComponentProps["t"];
  agents: AgentsRemote;
  system: SystemRemote;
  onReady(providerId: string): void;
}) {
  const data = useAiSettingsData(props.agents, props.system);
  return (
    <div className={css.section}>
      <CloudAiPanel
        t={props.t}
        agents={props.agents}
        system={props.system}
        providers={data.providers}
        activeProviderId={data.activeProviderId}
        byokEditor={
          <ProvidersPanel
            t={props.t}
            agents={props.agents}
            system={props.system}
            catalog={data.catalog}
            providers={data.providers}
            vault={data.vault}
            activeProviderId={data.activeProviderId}
            reload={data.reload}
            reloadVault={data.reloadVault}
            onSaved={() => undefined}
            onTested={() => undefined}
            onActivated={(providerId) => {
              data.reloadSettings();
              props.onReady(providerId);
            }}
          />
        }
        onSaved={data.reload}
        onActivated={props.onReady}
      />
    </div>
  );
}
