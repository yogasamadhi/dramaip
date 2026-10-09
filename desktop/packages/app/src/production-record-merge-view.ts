import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { ProductionRecordMergeComparison } from "@dramaip/contracts/production";
import { canonicalCreativeMetricJSON } from "@dramaip/contracts/insights";
export function matchesProductionRecordComparison(
  workflow: CreationWorkflow,
  report: ProductionRecordMergeComparison,
) {
  const basis = workflow.episodeDevelopmentBasis,
    base = basis?.storyboardRedo?.base;
  return (
    workflow.stage === "awaiting-review" &&
    workflow.input.operation === "storyboard-package" &&
    Boolean(base) &&
    report.projectId === workflow.input.projectId &&
    report.episodeId === basis?.episode.id &&
    report.workflow.id === workflow.id &&
    report.workflow.version === workflow.version &&
    report.base.id === base?.id &&
    report.base.version === base?.version &&
    (report.format === "storyboard-record-field-comparison-v4"
      ? basis?.storyboardRedo?.scope ===
          "author-frozen-scene-topology-plan-v1" &&
        basis.request.redoMode === "scene-topology-plan" &&
        canonicalCreativeMetricJSON(report.structure.receipt) ===
          canonicalCreativeMetricJSON(basis.storyboardRedo) &&
        report.structure.script.id === basis.request.script?.id &&
        report.structure.script.version === basis.request.script.version &&
        report.structure.documentVersion ===
          basis.request.baseScriptDocumentVersion
      : report.format === "storyboard-record-field-comparison-v3"
        ? basis?.storyboardRedo?.scope === "author-frozen-scene-shot-plan-v1" &&
          basis.request.redoMode === "scene-shot-plan" &&
          canonicalCreativeMetricJSON(report.structure.receipt) ===
            canonicalCreativeMetricJSON(basis.storyboardRedo) &&
          report.structure.script.id === basis.request.script?.id &&
          report.structure.script.version === basis.request.script.version &&
          report.structure.documentVersion ===
            basis.request.baseScriptDocumentVersion
        : report.format === "storyboard-record-field-comparison-v2"
          ? basis?.storyboardRedo?.scope ===
              "confirmed-block-structure-fixed-shots-duration-assets-v1" &&
            basis.request.redoMode === "confirmed-block-structure" &&
            canonicalCreativeMetricJSON(report.structure.receipt) ===
              canonicalCreativeMetricJSON(basis.storyboardRedo) &&
            report.structure.script.id === basis.request.script?.id &&
            report.structure.script.version === basis.request.script.version &&
            report.structure.documentVersion ===
              basis.request.baseScriptDocumentVersion
          : basis?.storyboardRedo?.scope ===
              "stable-mapping-fixed-duration-existing-assets-v1" &&
            !basis.request.redoMode)
  );
}
export function currentProductionRecordComparison(input: {
  workflow: CreationWorkflow;
  report?: ProductionRecordMergeComparison;
  opened: boolean;
  fetching: boolean;
  error: boolean;
}) {
  return input.opened &&
    !input.fetching &&
    !input.error &&
    input.report &&
    matchesProductionRecordComparison(input.workflow, input.report)
    ? input.report
    : undefined;
}
