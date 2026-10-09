import {
  DiagnosisRequestSchema,
  SeasonPlanRequestSchema,
  type DiagnosisRequest,
  type SeasonPlanRequest,
} from "@dramaip/contracts/production";

export function sameDiagnosisRequest(
  left: DiagnosisRequest | undefined,
  right: DiagnosisRequest,
): boolean {
  return (
    Boolean(left) &&
    JSON.stringify(DiagnosisRequestSchema.parse(left)) ===
      JSON.stringify(DiagnosisRequestSchema.parse(right))
  );
}
export function sameSeasonPlanRequest(
  left: SeasonPlanRequest | undefined,
  right: SeasonPlanRequest,
): boolean {
  return (
    Boolean(left) &&
    JSON.stringify(SeasonPlanRequestSchema.parse(left)) ===
      JSON.stringify(SeasonPlanRequestSchema.parse(right))
  );
}
