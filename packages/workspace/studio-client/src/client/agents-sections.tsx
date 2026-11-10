import type { Context } from "@deepseek-ai/cordis";
import type { PropsRuntime } from "@dramaip/infra-ui-slots";
import { InspirationConversion } from "../app/agents-sections";
import type {} from "./contract.ts";

/** The project conversion of the conversation the inspiration space opens. */
function ConversionPanel(props: PropsRuntime<"agents.inspiration-conversion">) {
  return (
    <InspirationConversion
      conversationId={props.conversationId}
      conversationTitle={props.conversationTitle}
      cards={props.cards}
      notify={props.notify}
    />
  );
}

/**
 * Register the agents panel the existing app still owns: the inspiration
 * space's project conversion, into the slot the agents client's space
 * declares. Transitional until project creation moves (P6).
 * @param ctx - Client Context whose Slot registry the space declares into.
 */
export function registerLegacyAgentsPages(ctx: Context): void {
  ctx.slots.inject("agents.inspiration-conversion", () => [
    ctx.slots.register(
      {
        name: "agents.inspiration-conversion",
        key: "panel",
        registrant: "workspace-studio-client",
      },
      ConversionPanel,
    ),
  ]);
}
