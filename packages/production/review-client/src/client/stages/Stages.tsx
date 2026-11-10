import { useMemo } from "react";
import type {} from "@dramaip/workspace-workspace-client/client/contract";
import type {
  PropsLocale,
  PropsRenderFactories,
  PropsRuntime,
} from "@dramaip/infra-ui-slots";
import type {} from "../contract.ts";
import type { StageRemotes } from "../remote.ts";
import { CompliancePreflight } from "./CompliancePreflight.tsx";
import { PlatformDelivery } from "./PlatformDelivery.tsx";
import { recordDomain, type ReviewRecordDomain } from "./records.ts";
import { ReviewEditor } from "./ReviewEditor.tsx";

/** Props of one stage body of the review and delivery page. */
export type StageProps = PropsRuntime<"review.stage"> &
  PropsLocale<"review"> &
  PropsRenderFactories &
  StageRemotes;

/**
 * The records of one review domain under the chosen episode, in the
 * project records workspace.
 */
function Records({
  props,
  domain,
  heading,
}: {
  props: StageProps;
  domain: ReviewRecordDomain;
  heading: Parameters<StageProps["t"]>[0];
}) {
  const { quality, review, delivery, system, t } = props;
  const domains = useMemo(
    () => [recordDomain(domain, { quality, review, delivery, system }, t)],
    [domain, quality, review, delivery, system, t],
  );
  return props.renderFactorySlot("workspace.records", {
    title: t(heading),
    domains,
    ...(props.projectId ? { projectId: props.projectId } : {}),
    ...(props.episodeId ? { parentId: props.episodeId } : {}),
    parentRequired: true,
  });
}

/** Problems and blockers: the quality records of the episode. */
export function QualityStage(props: StageProps) {
  return (
    <Records props={props} domain="quality" heading="records.quality.title" />
  );
}

/** Compliance recheck of the chosen episode, or its compliance records. */
export function ComplianceStage(props: StageProps) {
  return props.adaptationId && props.episodeId ? (
    <CompliancePreflight
      episodeId={props.episodeId}
      episodeTitle={props.episodeTitle}
      review={props.review}
      t={props.t}
    />
  ) : (
    <Records props={props} domain="compliance" heading="records.review.title" />
  );
}

/** Preview and revision: the review editor of the chosen episode. */
export function ReviewStage(props: StageProps) {
  return props.adaptationId && props.episodeId ? (
    <ReviewEditor
      key={`${props.projectId}:${props.episodeId}`}
      projectId={props.projectId}
      episodeId={props.episodeId}
      review={props.review}
      timeline={props.timeline}
      production={props.production}
      system={props.system}
      renderFactorySlot={props.renderFactorySlot}
      t={props.t}
    />
  ) : (
    <Records props={props} domain="review" heading="records.review.title" />
  );
}

/** Subtitles and localization records of the episode. */
export function LocalizationStage(props: StageProps) {
  return (
    <Records
      props={props}
      domain="localization"
      heading="records.delivery.title"
    />
  );
}

/** Export and publishing: the platform delivery of the chosen episode. */
export function DeliveryStage(props: StageProps) {
  return props.adaptationId && props.episodeId ? (
    <PlatformDelivery
      projectId={props.projectId}
      adaptationId={props.adaptationId}
      episodeId={props.episodeId}
      delivery={props.delivery}
      media={props.media}
      system={props.system}
      renderFactorySlot={props.renderFactorySlot}
      t={props.t}
    />
  ) : (
    <Records props={props} domain="delivery" heading="records.delivery.title" />
  );
}

/** The stage bodies by their `review.stage` key. */
export const STAGES = {
  quality: QualityStage,
  compliance: ComplianceStage,
  review: ReviewStage,
  localization: LocalizationStage,
  delivery: DeliveryStage,
} as const;
