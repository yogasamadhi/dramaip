/**
 * Factory contract of the workspace client: the project records workspace,
 * which any domain client renders over its own records Remote calls.
 * @module @dramaip/workspace-workspace-client/client/contract
 */
import type {} from "@dramaip/infra-ui-slots";
import type {
  RecordsRemotes,
  RecordsWorkspaceProps,
} from "./records/RecordsWorkspace.tsx";

export type {
  RecordAction,
  RecordCreateInput,
  RecordEntity,
  RecordField,
  RecordFieldKind,
  RecordsDomain,
  RecordsStore,
  RecordsWorkspaceProps,
} from "./records/RecordsWorkspace.tsx";

declare module "@dramaip/infra-ui-slots" {
  interface SlotFactoryMap {
    /** The records workspace of one area, over its domains' records. */
    "workspace.records": {
      scope: "root";
      props: RecordsWorkspaceProps;
      inject: RecordsRemotes;
      locale: "workspace";
    };
  }
}
