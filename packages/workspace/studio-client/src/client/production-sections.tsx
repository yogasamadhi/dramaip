import type { Context } from "@deepseek-ai/cordis";
import type {
  FactoryComponentPropsOf,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import {
  AdaptationWorkspace,
  ProductionNarrativeSelector,
} from "../app/production-sections";
import type { ProductionNarrativeSelection } from "./contract.ts";

/** The adaptation workbench, under the heading copy the page frame hands it. */
function AdaptBody(props: PropsRuntime<"production.adapt">) {
  return <AdaptationWorkspace intro={props.intro} />;
}

/**
 * The app's production source picker. Its request is the same frozen
 * production narrative the creation input carries, typed by the app's own
 * contracts.
 */
function NarrativeSources({
  projectId,
  storageKey,
  legacySourceIds,
  disabled,
  children,
}: FactoryComponentPropsOf<"production.narrative-sources">) {
  return (
    <ProductionNarrativeSelector
      projectId={projectId}
      storageKey={storageKey}
      {...(legacySourceIds ? { legacySourceIds } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
    >
      {(selection) => children(selection as ProductionNarrativeSelection)}
    </ProductionNarrativeSelector>
  );
}

/**
 * Register the adaptation workbench the existing app still owns into the page
 * frame the production client declares, and its production source picker as
 * the creation workbench's `production.narrative-sources` factory.
 * Transitional until they move (P6).
 * @param ctx - Client Context whose Slot registry the page declares into.
 */
export function registerLegacyProductionPages(ctx: Context): void {
  ctx.slots.inject("production.adapt", () => [
    ctx.slots.register(
      {
        name: "production.adapt",
        key: "body",
        registrant: "workspace-studio-client",
      },
      AdaptBody,
    ),
  ]);
  ctx.slots.registerFactory(
    {
      name: "production.narrative-sources",
      scope: "root",
    },
    NarrativeSources,
  );
}
