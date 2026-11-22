import { StrictMode, type ReactNode } from "react";
import { Navigate } from "../app/router";
import type {
  PropsRenderFactories,
  PropsRenderSlots,
} from "@dramaip/infra-ui-slots";
import { useAssistantIntent } from "../app/agents-sections";
import { AiSetupProvider, type RenderAiSetup } from "../app/ai-setup";
import { useProjectScope } from "../app/insights-sections";
import { useProjectRecord, useRoute } from "../app/project-tools";
import { useEpisodeScope, useProductionScope } from "../app/review-sections";
import { AppRoot } from "../app/studio-app";
import { useNovelQuickStart, useNovelWorkspace } from "../app/writing-sections";
import type { LegacyRouteOwnerProps } from "./contract.ts";

/**
 * The episode scope hook as the contract offers it: the production context
 * the page hands back is the one `useProductionScope` gave it, opaque to the
 * page.
 */
const episodeScope =
  useEpisodeScope as unknown as LegacyRouteOwnerProps["useEpisodeScope"];

/** The project record hook as the contract offers it: the record is opaque. */
const projectRecord =
  useProjectRecord as unknown as LegacyRouteOwnerProps["useProjectRecord"];

/** The novel workspace hook as the contract offers it: the record is opaque. */
const novelWorkspace =
  useNovelWorkspace as unknown as LegacyRouteOwnerProps["useNovelWorkspace"];

/**
 * The existing Studio app, as its own entry rendered it, with the pages the
 * domain client plugins registered under `studio.route` at their paths.
 */
export function LegacyStudio({
  renderSlot,
  renderFactorySlot,
}: PropsRenderSlots<"studio.route"> & PropsRenderFactories) {
  // The agents client registers the setup dialog; this package cannot name
  // its contract without a cycle, so the call goes through by name. Without
  // the dialog, the settings page does the same job.
  const renderAiSetup: RenderAiSetup = (props) =>
    (
      renderFactorySlot as unknown as (
        name: string,
        props: unknown,
        options: { fallback: ReactNode },
      ) => ReactNode
    )("agents.provider-setup", props, {
      fallback: props.open ? <Navigate to="/settings?setup=ai" /> : null,
    });
  return (
    <StrictMode>
      <AiSetupProvider value={renderAiSetup}>
        <AppRoot
          pluginRoutes={(path, navigate) =>
            renderSlot(
              "studio.route",
              {
                navigate,
                useRoute,
                useProjectRecord: projectRecord,
                useNovelWorkspace: novelWorkspace,
                useNovelQuickStart,
                useProjectScope,
                useProductionScope,
                useEpisodeScope: episodeScope,
                useAssistantIntent,
              },
              { entryKey: path },
            )
          }
        />
      </AiSetupProvider>
    </StrictMode>
  );
}
