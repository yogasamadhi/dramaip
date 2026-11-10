/**
 * Factory contract of the media client: the read-only delivery evidence of
 * one exact media record, which any domain client shows beside its own
 * review of that record.
 * @module @dramaip/production-media-client/client/contract
 */
import type {} from "@dramaip/infra-ui-slots";
import type { DeliveryEvidenceProps } from "./evidence/DeliveryEvidence.tsx";

export type { DeliveryEvidenceProps } from "./evidence/DeliveryEvidence.tsx";

declare module "@dramaip/infra-ui-slots" {
  interface SlotFactoryMap {
    /** The delivery evidence of one exact media record version. */
    "media.delivery-evidence": {
      scope: "root";
      props: DeliveryEvidenceProps;
      locale: "media";
    };
  }
}
