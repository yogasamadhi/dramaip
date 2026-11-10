/**
 * Factory contract of the automation client: the creation workbench, which
 * any domain client renders where it starts, reviews or reopens an AI
 * creation run, the change preview card a domain client shows for a
 * preview it created, and the frozen source coverage of a run's result.
 * @module @dramaip/automation-automation-client/client/contract
 */
import type {} from "@dramaip/infra-ui-slots";
import type {
  CreationRecordWorkbenchProps,
  CreationRunCardProps,
  CreationWorkbenchProps,
  CreationWorkbenchRemotes,
  ProductionRemote,
} from "./creation/CreationWorkbench.tsx";
import type { ChangePreviewFactoryProps } from "./confirmations/PreviewCards.tsx";
import type { TaskRemotes } from "./confirmations/remote.ts";
import type { SourceCoverageFactoryProps } from "./creation/SourceCoverage.tsx";

export type { ChangePreviewFactoryProps } from "./confirmations/PreviewCards.tsx";
export type {
  NarrativeSourceBasis,
  SourceCoverageFactoryProps,
} from "./creation/SourceCoverage.tsx";
export type {
  CreationRecordDomain,
  CreationRecordWorkbenchProps,
  CreationRunCardProps,
  CreationWorkbenchProps,
} from "./creation/CreationWorkbench.tsx";

declare module "@dramaip/infra-ui-slots" {
  interface SlotFactoryMap {
    /** One creation workbench, scoped by its props. */
    "automation.creation-workbench": {
      scope: "root";
      props: CreationWorkbenchProps;
      inject: CreationWorkbenchRemotes;
      locale: "creation";
    };
    /** The workbench of one production record, checked before it opens. */
    "automation.creation-record": {
      scope: "root";
      props: CreationRecordWorkbenchProps;
      inject: CreationWorkbenchRemotes & { production: ProductionRemote };
      locale: "creation";
    };
    /** The workbench of one existing run, scoped to its frozen input. */
    "automation.creation-run": {
      scope: "root";
      props: CreationRunCardProps;
      inject: CreationWorkbenchRemotes;
      locale: "creation";
    };
    /**
     * What a run was given: each chapter's frozen form, its references and
     * what was left out of its allowed range.
     */
    "automation.source-coverage": {
      scope: "root";
      props: SourceCoverageFactoryProps;
      locale: "creation";
    };
    /** One change preview, applied or discarded by the author. */
    "automation.change-preview": {
      scope: "root";
      props: ChangePreviewFactoryProps;
      inject: TaskRemotes;
      locale: "automation";
    };
  }
}
