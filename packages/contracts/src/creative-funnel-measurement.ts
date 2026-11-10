import {
  CreativeFunnelMetricSchema,
  CreativeFunnelSummarySchema,
  canonicalCreativeMetricJSON,
  type CreativeFunnelRecord,
  type CreativeFunnelSummary,
} from "./creative-funnel.js";
import {
  CreativePlanningFunnelSummarySchema,
  type CreativePlanningFunnelRecord,
  type CreativePlanningAdoptionRecord,
} from "./creative-planning.js";
import type { CreativeOutcomeRecord } from "./creative-outcomes.js";
import { NarrativePlanningOperationSchema } from "./creation.js";
const adoptedKinds = {
  "novel.chapter": "novel.chapter-adopted",
  "adaptation.diagnosis": "adaptation.diagnosis-adopted",
  "adaptation.strategy": "adaptation.strategy-adopted",
  "adaptation.season-plan": "adaptation.season-plan-adopted",
  "adaptation.script": "adaptation.script-adopted",
} as const;
/** Exact original fact arrays in source-cursor order; shared with the original owner projection reader. */
export function measureCreativeFunnelRecords(
  facts: readonly CreativeFunnelRecord[],
  adopts: readonly CreativeOutcomeRecord[],
): CreativeFunnelSummary {
  const measures = CreativeFunnelMetricSchema.options.map((metric) => {
    const records = facts.filter((record) => record.fact.metric === metric);
    const requests = records.filter(
      (
        record,
      ): record is CreativeFunnelRecord & {
        fact: Extract<CreativeFunnelRecord["fact"], { kind: "request" }>;
      } => record.fact.kind === "request",
    );
    const candidates = records.filter(
      (
        record,
      ): record is CreativeFunnelRecord & {
        fact: Extract<
          CreativeFunnelRecord["fact"],
          { kind: "candidate-ready" }
        >;
      } => record.fact.kind === "candidate-ready",
    );
    const accepted = adopts.filter(
      (record) =>
        record.kind === adoptedKinds[metric] &&
        record.workflowId &&
        record.candidate,
    );
    const ownerRejections = records.filter(
      (
        record,
      ): record is CreativeFunnelRecord & {
        fact: Extract<
          CreativeFunnelRecord["fact"],
          { kind: "owner-rejection" }
        >;
      } =>
        record.fact.kind === "owner-rejection" &&
        candidates.some(
          (candidate) =>
            candidate.cursor < record.cursor &&
            candidate.fact.workflowId === record.fact.workflowId &&
            canonicalCreativeMetricJSON(candidate.fact.candidate) ===
              canonicalCreativeMetricJSON(
                record.fact.kind === "owner-rejection"
                  ? record.fact.candidate
                  : undefined,
              ) &&
            requests.some(
              (request) =>
                request.cursor < candidate.cursor &&
                request.fact.workflowId === candidate.fact.workflowId,
            ),
        ),
    );
    const sourceConflicts = [
      ...records.flatMap((record) =>
        record.fact.kind === "source-conflict"
          ? [
              {
                cursor: record.cursor,
                occurredAt: record.occurredAt,
                workflowId: record.fact.workflowId,
                candidate: record.fact.candidate,
                sourceConflict: record.fact.sourceConflict,
                ownerRejection: undefined,
              },
            ]
          : [],
      ),
      ...ownerRejections.flatMap((record) =>
        record.fact.sourceConflict
          ? [
              {
                cursor: record.cursor,
                occurredAt: record.occurredAt,
                workflowId: record.fact.workflowId,
                candidate: record.fact.candidate,
                sourceConflict: record.fact.sourceConflict,
                ownerRejection: record.fact.ownerRejection,
              },
            ]
          : [],
      ),
    ].sort((a, b) => a.cursor - b.cursor);
    const lastSourceConflict = sourceConflicts.at(-1);
    const targets = new Map<string, (typeof requests)[number]>();
    for (const request of requests)
      if (!targets.has(request.fact.targetKey))
        targets.set(request.fact.targetKey, request);
    let firstCandidates = 0,
      firstAdopted = 0,
      pendingDecision = 0,
      closedWithoutFirstAdoption = 0,
      revisedAdoption = 0,
      unobservedFirstTargets = 0;
    const matches = (
      candidate: (typeof candidates)[number],
      adoption: (typeof accepted)[number],
    ) =>
      candidate.fact.workflowId === adoption.workflowId &&
      candidate.fact.candidate.id === adoption.candidate!.id &&
      candidate.fact.candidate.contentFingerprint ===
        adoption.candidate!.contentFingerprint &&
      canonicalCreativeMetricJSON(candidate.fact.candidate.selectionOptions) ===
        canonicalCreativeMetricJSON(adoption.candidate!.selectionOptions);
    for (const request of targets.values()) {
      if (
        request.fact.targetAttempt !== 1 ||
        request.fact.requestKind !== "new-request"
      ) {
        unobservedFirstTargets++;
        continue;
      }
      const candidate = candidates.find(
        (item) => item.fact.workflowId === request.fact.workflowId,
      );
      if (!candidate) continue;
      firstCandidates++;
      if (accepted.some((adoption) => matches(candidate, adoption))) {
        firstAdopted++;
        continue;
      }
      if (
        accepted.some(
          (adoption) => adoption.workflowId === request.fact.workflowId,
        )
      ) {
        revisedAdoption++;
        continue;
      }
      const lastState = records
        .filter(
          (record) =>
            record.fact.kind === "state" &&
            record.fact.workflowId === request.fact.workflowId,
        )
        .at(-1);
      if (
        lastState?.fact.kind === "state" &&
        lastState.fact.state !== "adoption-rejected"
      )
        closedWithoutFirstAdoption++;
      else pendingDecision++;
    }
    let firstAccepted: CreativeFunnelSummary["measures"][number]["firstAccepted"] =
      null;
    for (const adoption of accepted) {
      const request = requests.find(
        (item) => item.fact.workflowId === adoption.workflowId,
      );
      const candidate = candidates.find(
        (item) => item.fact.workflowId === adoption.workflowId,
      );
      if (!request || !candidate) continue;
      const spans = [
        Date.parse(candidate.occurredAt) - Date.parse(request.fact.requestedAt),
        Date.parse(adoption.occurredAt) - Date.parse(candidate.occurredAt),
        Date.parse(adoption.occurredAt) - Date.parse(request.fact.requestedAt),
      ];
      firstAccepted = {
        workflowId: request.fact.workflowId,
        candidateId: adoption.candidate!.id,
        adoptedEventId: adoption.eventId,
        adoptionMode:
          metric === "adaptation.strategy"
            ? "selected-option"
            : matches(candidate, adoption)
              ? "exact-candidate"
              : "edited-candidate",
        ...(metric === "adaptation.strategy"
          ? { selectedOption: adoption.selectedOption }
          : {}),
        requestToReadyMs: spans[0]! < 0 ? null : spans[0]!,
        readyToAdoptMs: spans[1]! < 0 ? null : spans[1]!,
        requestToAdoptMs: spans[2]! < 0 ? null : spans[2]!,
        clockState: spans.some((span) => span < 0)
          ? "inconsistent"
          : "consistent",
      };
      break;
    }
    return {
      metric,
      modelEvidence: "unknown" as const,
      recordedRequests: requests.length,
      requestedTargets: targets.size,
      unobservedFirstTargets,
      firstCandidates,
      firstAdopted,
      pendingDecision,
      closedWithoutFirstAdoption,
      revisedAdoption,
      retryCandidates: candidates.filter(
        (candidate) =>
          requests.find(
            (request) => request.fact.workflowId === candidate.fact.workflowId,
          )?.fact.targetAttempt !== 1,
      ).length,
      adoptionRejectedCount:
        records.filter(
          (record) =>
            record.fact.kind === "state" &&
            record.fact.state === "adoption-rejected",
        ).length + ownerRejections.length,
      sourceConflictCandidateCount: new Set(
        sourceConflicts.map((record) =>
          canonicalCreativeMetricJSON([record.workflowId, record.candidate]),
        ),
      ).size,
      lastSourceConflict: lastSourceConflict
        ? {
            occurredAt: lastSourceConflict.occurredAt,
            candidate: lastSourceConflict.candidate,
            sourceConflict: lastSourceConflict.sourceConflict,
            ...(lastSourceConflict.ownerRejection
              ? { ownerRejection: lastSourceConflict.ownerRejection }
              : {}),
          }
        : null,
      firstCandidateAdoptionRatio: firstCandidates
        ? firstAdopted / firstCandidates
        : null,
      firstAccepted,
    };
  });
  return CreativeFunnelSummarySchema.parse({
    unit: "first-recorded-target-request",
    adoptionBasis: "exact-candidate-owner-fact",
    ratioPolicy: "as-of-including-pending-not-public-quality",
    measures,
  });
}

export function measureCreativePlanningFunnelRecords(
  facts: readonly CreativePlanningFunnelRecord[],
  batches: readonly CreativePlanningAdoptionRecord[],
) {
  const known = (
    workflowId: string,
    operation: string,
    adoptionCursor: number,
  ) => {
    const request = facts.find(
      (item) =>
        item.fact.kind === "request" &&
        item.fact.workflowId === workflowId &&
        item.fact.operation === operation,
    );
    const candidate = facts.find(
      (item) =>
        item.fact.kind === "candidate-ready" &&
        item.fact.workflowId === workflowId &&
        item.fact.operation === operation,
    );
    return Boolean(
      request &&
      candidate &&
      request.cursor < candidate.cursor &&
      candidate.cursor < adoptionCursor,
    );
  };
  const measures = NarrativePlanningOperationSchema.options.map((operation) => {
    const records = facts.filter((item) => item.fact.operation === operation);
    const requests = records.filter(
      (
        item,
      ): item is CreativePlanningFunnelRecord & {
        fact: Extract<
          CreativePlanningFunnelRecord["fact"],
          { kind: "request" }
        >;
      } => item.fact.kind === "request",
    );
    const candidates = records.filter(
      (
        item,
      ): item is CreativePlanningFunnelRecord & {
        fact: Extract<
          CreativePlanningFunnelRecord["fact"],
          { kind: "candidate-ready" }
        >;
      } => item.fact.kind === "candidate-ready",
    );
    const accepted = batches.filter(
      (item) =>
        item.fact.operation === operation &&
        known(item.fact.workflowId, operation, item.cursor),
    );
    const targets = new Map<string, (typeof requests)[number]>();
    for (const request of requests)
      if (!targets.has(request.fact.targetKey))
        targets.set(request.fact.targetKey, request);
    const matches = (
      candidate: (typeof candidates)[number],
      adoption: (typeof accepted)[number],
    ) =>
      candidate.fact.workflowId === adoption.fact.workflowId &&
      canonicalCreativeMetricJSON(candidate.fact.candidate) ===
        canonicalCreativeMetricJSON(adoption.fact.candidate);
    let firstCandidates = 0,
      firstAdopted = 0,
      pendingDecision = 0,
      closedWithoutFirstAdoption = 0,
      revisedAdoption = 0,
      unobservedFirstTargets = 0;
    for (const request of targets.values()) {
      if (
        request.fact.targetAttempt !== 1 ||
        request.fact.requestKind !== "new-request"
      ) {
        unobservedFirstTargets++;
        continue;
      }
      const candidate = candidates.find(
        (item) => item.fact.workflowId === request.fact.workflowId,
      );
      if (!candidate) continue;
      firstCandidates++;
      if (accepted.some((adoption) => matches(candidate, adoption))) {
        firstAdopted++;
        continue;
      }
      if (
        accepted.some(
          (adoption) => adoption.fact.workflowId === request.fact.workflowId,
        )
      ) {
        revisedAdoption++;
        continue;
      }
      const state = records
        .filter(
          (item) =>
            item.fact.kind === "state" &&
            item.fact.workflowId === request.fact.workflowId,
        )
        .at(-1);
      if (
        state?.fact.kind === "state" &&
        state.fact.state !== "adoption-rejected"
      )
        closedWithoutFirstAdoption++;
      else pendingDecision++;
    }
    let firstAccepted: null | {
      workflowId: string;
      candidateId: string;
      adoptedEventId: string;
      adoptionMode: "exact-candidate" | "edited-candidate";
      requestToReadyMs: number | null;
      readyToAdoptMs: number | null;
      requestToAdoptMs: number | null;
      clockState: "consistent" | "inconsistent";
    } = null;
    for (const adoption of accepted) {
      const request = requests.find(
          (item) => item.fact.workflowId === adoption.fact.workflowId,
        ),
        candidate = candidates.find(
          (item) => item.fact.workflowId === adoption.fact.workflowId,
        );
      if (!request || !candidate) continue;
      const spans = [
        Date.parse(candidate.occurredAt) - Date.parse(request.fact.requestedAt),
        Date.parse(adoption.occurredAt) - Date.parse(candidate.occurredAt),
        Date.parse(adoption.occurredAt) - Date.parse(request.fact.requestedAt),
      ];
      firstAccepted = {
        workflowId: request.fact.workflowId,
        candidateId: adoption.fact.candidate.id,
        adoptedEventId: adoption.eventId,
        adoptionMode: matches(candidate, adoption)
          ? "exact-candidate"
          : "edited-candidate",
        requestToReadyMs: spans[0]! < 0 ? null : spans[0]!,
        readyToAdoptMs: spans[1]! < 0 ? null : spans[1]!,
        requestToAdoptMs: spans[2]! < 0 ? null : spans[2]!,
        clockState: spans.some((span) => span < 0)
          ? "inconsistent"
          : "consistent",
      };
      break;
    }
    const conflicts = records.filter(
      (
        item,
      ): item is CreativePlanningFunnelRecord & {
        fact: Extract<
          CreativePlanningFunnelRecord["fact"],
          { kind: "source-conflict" }
        >;
      } => item.fact.kind === "source-conflict",
    );
    const last = conflicts.at(-1);
    return {
      operation,
      modelEvidence: "unknown",
      recordedRequests: requests.length,
      requestedTargets: targets.size,
      unobservedFirstTargets,
      firstCandidates,
      firstAdopted,
      pendingDecision,
      closedWithoutFirstAdoption,
      revisedAdoption,
      retryCandidates: candidates.filter(
        (candidate) =>
          requests.find(
            (request) => request.fact.workflowId === candidate.fact.workflowId,
          )?.fact.targetAttempt !== 1,
      ).length,
      adoptionRejectedCount: records.filter(
        (item) =>
          item.fact.kind === "state" && item.fact.state === "adoption-rejected",
      ).length,
      sourceConflicts: {
        candidateCount: new Set(
          conflicts.map(
            (item) =>
              `${item.fact.workflowId}:${item.fact.candidate.id}:${item.fact.candidate.contentFingerprint}`,
          ),
        ).size,
        last: last
          ? {
              candidate: last.fact.candidate,
              sourceConflict: last.fact.sourceConflict,
              eventId: last.eventId,
              cursor: last.cursor,
              occurredAt: last.occurredAt,
            }
          : null,
      },
      firstCandidateAdoptionRatio: firstCandidates
        ? firstAdopted / firstCandidates
        : null,
      firstAccepted,
    };
  });
  return CreativePlanningFunnelSummarySchema.parse({
    historyPolicy: "actual-planning-request-receipts-only",
    unit: "independent-original-planning-request",
    adoptionBasis: "complete-matching-owner-batch",
    ratioPolicy: "as-of-including-pending-not-public-quality",
    unmatchedAdoptionBatches: batches.filter(
      (item) => !known(item.fact.workflowId, item.fact.operation, item.cursor),
    ).length,
    measures,
  });
}
