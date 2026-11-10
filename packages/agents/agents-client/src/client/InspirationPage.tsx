import type {
  PropsLocale,
  PropsRenderSlots,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/workspace-studio-client/client/contract";
import { InspirationSpace } from "./inspiration/InspirationSpace.tsx";
import type { InspirationRemotes } from "./inspiration/records.ts";

/** Full component props of the `/inspiration` page. */
export type InspirationPageProps = PropsRuntime<"studio.route"> &
  PropsRenderSlots<"agents.inspiration-conversion"> &
  PropsLocale<"agents"> &
  InspirationRemotes;

/**
 * The inspiration space page: the space under the page's heading copy, which
 * it places inside its own conversation list. The project conversion under
 * a conversation's cards is the panel its `agents.inspiration-conversion`
 * slot holds.
 */
export function InspirationPage(props: InspirationPageProps) {
  const { t, renderSlot } = props;
  return (
    <InspirationSpace
      t={t}
      agents={props.agents}
      knowledge={props.knowledge}
      quality={props.quality}
      system={props.system}
      title={t("inspiration.title")}
      description={t("inspiration.description")}
      renderConversion={(conversion) =>
        renderSlot("agents.inspiration-conversion", conversion, {
          entryKey: "panel",
        })
      }
    />
  );
}
