import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG = new URL(
  "../tests/fixtures/product-evaluation/cases.json",
  import.meta.url,
);
const MAX_BYTES = 1_048_576;
const MAX_CATALOG_BYTES = 16_777_216;
const GENRES = ["mystery", "emotion", "light-comedy", "growth", "fantasy"];
const SCALES = ["short", "medium", "long"];
const FULL_CORPUS_SCALES = ["medium", "long"];
const ENTRIES = ["inspiration", "source-import", "script"];
const PATHS = ["novel", "adaptation"];
const CHECKS = [
  "character-knowledge",
  "timeline",
  "author-intent",
  "no-forced-video",
  "causality",
  "source-coverage",
  "lineage",
  "relationship",
  "tone",
  "no-forced-hook",
  "repetition",
  "screenplay-continuity",
  "no-forced-novel",
  "stable-blocks",
  "production-risk",
  "optional-media",
  "unknown-cost",
  "foreshadowing",
  "world-rule",
];

export class EvaluationValidationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
function requireFact(condition, code = "invalid-record") {
  if (!condition) throw new EvaluationValidationError(code);
}
function keys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
const tag = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(value);
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const number = (value) => Number.isSafeInteger(value) && value >= 0;
const instant = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function evidenceDigest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
async function readJson(path, maxBytes = MAX_BYTES) {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    requireFact(stat.isFile() && stat.size <= maxBytes, "invalid-file");
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    requireFact(offset <= maxBytes, "invalid-file");
    return JSON.parse(buffer.subarray(0, offset).toString("utf8"));
  } finally {
    await handle.close();
  }
}

export async function loadCatalog(path = CATALOG) {
  return validateCatalog(
    await readJson(path, path === CATALOG ? MAX_BYTES : MAX_CATALOG_BYTES),
  );
}

/** V1 remains byte-for-byte compatible; a full corpus needs a separate V2 suite. */
export function validateCatalog(value) {
  requireFact(
    keys(value, ["schemaVersion", "status", "sourcePolicy", "cases"]),
    "invalid-catalog",
  );
  requireFact(
    ((value.schemaVersion === 1 && value.status === "internal-scaffold") ||
      (value.schemaVersion === 2 && value.status === "internal-corpus")) &&
      typeof value.sourcePolicy === "string" &&
      Array.isArray(value.cases) &&
      value.cases.length >= 10,
    "invalid-catalog",
  );
  const ids = new Set();
  const sourceClassifications = new Map();
  for (const item of value.cases) {
    requireFact(
      keys(item, [
        "id",
        "genre",
        "targetScale",
        "entryPath",
        "workflowPath",
        "task",
        "source",
        "authorIntent",
        "sourceScope",
        "checks",
        ...(value.schemaVersion === 2 ? ["sourceCorpus"] : []),
      ]),
      "invalid-catalog",
    );
    requireFact(
      tag(item.id) &&
        !ids.has(item.id) &&
        GENRES.includes(item.genre) &&
        SCALES.includes(item.targetScale) &&
        ENTRIES.includes(item.entryPath) &&
        PATHS.includes(item.workflowPath) &&
        [item.task, item.authorIntent, item.sourceScope].every(
          (text) =>
            typeof text === "string" &&
            text.trim().length > 0 &&
            text.length <= 20_000,
        ) &&
        typeof item.source === "string" &&
        item.source.trim().length > 0 &&
        item.source.length <=
          (value.schemaVersion === 2 ? 2_000_000 : 20_000) &&
        Array.isArray(item.checks) &&
        item.checks.length > 0 &&
        new Set(item.checks).size === item.checks.length &&
        item.checks.every((check) => CHECKS.includes(check)),
      "invalid-catalog",
    );
    if (value.schemaVersion === 2) {
      const source = item.sourceCorpus;
      requireFact(
        item.source.isWellFormed() &&
          keys(source, [
            "extent",
            "sourceScale",
            "characters",
            "contentDigest",
            "classificationDigest",
            "units",
          ]) &&
          ["complete-work", "selected-excerpts", "scenario"].includes(
            source.extent,
          ) &&
          [...SCALES, "not-established"].includes(source.sourceScale) &&
          source.characters === Array.from(item.source).length &&
          source.contentDigest ===
            createHash("sha256").update(item.source, "utf8").digest("hex") &&
          (source.sourceScale === "not-established"
            ? source.classificationDigest === null
            : digest(source.classificationDigest)) &&
          Array.isArray(source.units) &&
          source.units.length > 0 &&
          source.units.length <= 10_000,
        "invalid-corpus",
      );
      const unitIds = new Set();
      let previousEnd = 0;
      const boundary = (offset) =>
        offset === 0 ||
        offset === item.source.length ||
        !(
          item.source.charCodeAt(offset - 1) >= 0xd800 &&
          item.source.charCodeAt(offset - 1) <= 0xdbff &&
          item.source.charCodeAt(offset) >= 0xdc00 &&
          item.source.charCodeAt(offset) <= 0xdfff
        );
      for (const unit of source.units) {
        requireFact(
          keys(unit, ["id", "startOffset", "endOffset"]) &&
            tag(unit.id) &&
            !unitIds.has(unit.id) &&
            number(unit.startOffset) &&
            number(unit.endOffset) &&
            unit.startOffset >= previousEnd &&
            unit.endOffset > unit.startOffset &&
            unit.endOffset <= item.source.length &&
            boundary(unit.startOffset) &&
            boundary(unit.endOffset) &&
            (source.extent !== "complete-work" ||
              unit.startOffset === previousEnd),
          "invalid-corpus-units",
        );
        unitIds.add(unit.id);
        previousEnd = unit.endOffset;
      }
      requireFact(
        source.extent !== "complete-work" || previousEnd === item.source.length,
        "incomplete-corpus-units",
      );
      const prior = sourceClassifications.get(source.contentDigest);
      requireFact(
        source.sourceScale === "not-established" ||
          prior === undefined ||
          prior === source.sourceScale,
        "inconsistent-corpus-scale",
      );
      if (source.sourceScale !== "not-established")
        sourceClassifications.set(source.contentDigest, source.sourceScale);
    }
    ids.add(item.id);
  }
  for (const [field, values] of [
    ["genre", GENRES],
    ["targetScale", SCALES],
    ["entryPath", ENTRIES],
    ["workflowPath", PATHS],
  ])
    requireFact(
      values.every((target) =>
        value.cases.some((item) => item[field] === target),
      ),
      "invalid-catalog",
    );
  return value;
}

/** Source extent/scale are reviewed declarations, never inferred from target labels. */
export function summarizeCatalogSources(catalog) {
  validateCatalog(catalog);
  const cases = catalog.cases.map((item) => ({
    caseId: item.id,
    targetScale: item.targetScale,
    sourceExtent: item.sourceCorpus?.extent ?? "not-established",
    sourceScale: item.sourceCorpus?.sourceScale ?? "not-established",
    actualCharacters: Array.from(item.source).length,
    suppliedUnits: item.sourceCorpus?.units.length ?? null,
    classificationReferenceSupplied:
      item.sourceCorpus?.classificationDigest != null,
  }));
  const completeScales = SCALES.filter((scale) =>
    cases.some(
      (item) =>
        item.sourceExtent === "complete-work" &&
        item.sourceScale === scale &&
        item.classificationReferenceSupplied,
    ),
  );
  return {
    catalogSchemaVersion: catalog.schemaVersion,
    requiredFullCorpusScales: FULL_CORPUS_SCALES,
    suppliedCompleteScales: completeScales,
    missingFullCorpusScales: FULL_CORPUS_SCALES.filter(
      (scale) => !completeScales.includes(scale),
    ),
    fullCorpusDeclarationsSupplied: FULL_CORPUS_SCALES.every((scale) =>
      completeScales.includes(scale),
    ),
    sourceExtentAndScaleIndependentlyVerified: false,
    cases,
    boundary:
      "Actual source character counts and supplied UTF-16 unit coverage are checked; targetScale is not source scale or proof of a full manuscript. Complete-work and source-scale classifications require a supplied human review reference, whose bytes, authenticity and rights are not independently verified. No literary length standard, full-work authenticity or semantic quality is inferred. V1 scenario/excerpt suites cannot satisfy the full-corpus inventory.",
  };
}

export function createTemplate(catalog) {
  return {
    schemaVersion: 2,
    suiteDigest: evidenceDigest(catalog),
    records: catalog.cases.map((item) => ({
      recordId: `${item.id}-r1`,
      caseId: item.id,
      inputDigest: evidenceDigest(item),
      evidenceKind: "unknown",
      status: "not-run",
      modelSnapshot: null,
      execution: null,
      elapsedMs: null,
      candidateDigest: null,
      adopted: null,
      revisionCount: null,
      reportedUsage: null,
      settledCost: null,
      humanReview: null,
    })),
  };
}

export function validateEvaluationRecord(catalog, report) {
  requireFact(keys(report, ["schemaVersion", "suiteDigest", "records"]));
  requireFact(
    [1, 2].includes(report.schemaVersion) &&
      report.suiteDigest === evidenceDigest(catalog),
    "stale-suite",
  );
  requireFact(Array.isArray(report.records) && report.records.length <= 1_000);
  const cases = new Map(catalog.cases.map((item) => [item.id, item]));
  const recordIds = new Set();
  const groups = new Map();
  for (const record of report.records) {
    requireFact(
      keys(record, [
        "recordId",
        "caseId",
        "inputDigest",
        "evidenceKind",
        "status",
        "modelSnapshot",
        "elapsedMs",
        "candidateDigest",
        "adopted",
        "revisionCount",
        "reportedUsage",
        "settledCost",
        "humanReview",
        ...(report.schemaVersion === 2 ? ["execution"] : []),
      ]),
    );
    const item = cases.get(record.caseId);
    requireFact(
      item && record.inputDigest === evidenceDigest(item),
      "stale-input",
    );
    requireFact(
      tag(record.recordId) && !recordIds.has(record.recordId),
      "duplicate-record",
    );
    recordIds.add(record.recordId);
    requireFact(
      ["unknown", "controlled-engine", "real-model"].includes(
        record.evidenceKind,
      ) && ["not-run", "failed", "completed"].includes(record.status),
    );
    requireFact(record.elapsedMs === null || number(record.elapsedMs));
    requireFact(
      record.candidateDigest === null || digest(record.candidateDigest),
    );
    requireFact(record.adopted === null || typeof record.adopted === "boolean");
    requireFact(record.revisionCount === null || number(record.revisionCount));
    // v1 remains readable; absent execution dates are unknown, never inferred.
    const execution = report.schemaVersion === 2 ? record.execution : null;
    requireFact(
      execution === null ||
        (keys(execution, [
          "startedAt",
          "finishedAt",
          "receiptDigest",
          "protocolDigest",
        ]) &&
          instant(execution.startedAt) &&
          instant(execution.finishedAt) &&
          Date.parse(execution.finishedAt) >= Date.parse(execution.startedAt) &&
          digest(execution.receiptDigest) &&
          (execution.protocolDigest === null ||
            digest(execution.protocolDigest))),
      "invalid-execution-evidence",
    );
    const model = record.modelSnapshot;
    requireFact(
      model === null ||
        (keys(model, [
          "providerTag",
          "modelId",
          "version",
          "configurationDigest",
        ]) &&
          [model.providerTag, model.modelId, model.version].every(tag) &&
          digest(model.configurationDigest)),
    );
    const usage = record.reportedUsage;
    requireFact(
      usage === null ||
        (keys(usage, [
          "semantics",
          "inputTokens",
          "outputTokens",
          "receiptDigest",
        ]) &&
          [
            "reported-final",
            "reported-incremental",
            "reported-cumulative",
          ].includes(usage.semantics) &&
          [usage.inputTokens, usage.outputTokens].every(
            (value) => value === null || number(value),
          ) &&
          digest(usage.receiptDigest)),
    );
    const cost = record.settledCost;
    requireFact(
      cost === null ||
        (record.evidenceKind === "real-model" &&
          keys(cost, ["amount", "currency", "receiptDigest"]) &&
          typeof cost.amount === "string" &&
          /^(0|[1-9]\d{0,14})(\.\d{1,8})?$/.test(cost.amount) &&
          typeof cost.currency === "string" &&
          /^[A-Z]{3}$/.test(cost.currency) &&
          digest(cost.receiptDigest)),
    );
    const review = record.humanReview;
    if (review !== null) {
      requireFact(
        keys(review, [
          "reviewerTag",
          "modelBlind",
          "ratings",
          "checks",
          "evidenceDigest",
        ]) &&
          tag(review.reviewerTag) &&
          review.modelBlind === true &&
          digest(review.evidenceDigest),
      );
      requireFact(
        keys(review.ratings, [
          "authorIntent",
          "continuity",
          "narrativeQuality",
        ]) &&
          Object.values(review.ratings).every(
            (value) => Number.isInteger(value) && value >= 1 && value <= 5,
          ),
      );
      requireFact(
        Array.isArray(review.checks) &&
          review.checks.length === item.checks.length &&
          new Set(review.checks.map((check) => check?.id)).size ===
            item.checks.length,
      );
      for (const check of review.checks)
        requireFact(
          keys(check, ["id", "result"]) &&
            item.checks.includes(check.id) &&
            ["pass", "fail", "unknown"].includes(check.result),
        );
    }
    if (record.status === "not-run")
      requireFact(
        [
          model,
          record.elapsedMs,
          record.candidateDigest,
          record.adopted,
          record.revisionCount,
          usage,
          cost,
          review,
          execution,
        ].every((value) => value === null),
        "unrun-evidence",
      );
    else if (record.status === "failed")
      requireFact(
        record.candidateDigest === null &&
          record.adopted === null &&
          record.revisionCount === null &&
          review === null,
        "failed-candidate",
      );
    else
      requireFact(
        model !== null &&
          record.elapsedMs !== null &&
          record.candidateDigest !== null,
        "missing-run-evidence",
      );
    const key = `${item.workflowPath}:${record.evidenceKind}:${model ? evidenceDigest(model) : "unknown-model"}`;
    const group = groups.get(key) ?? {
      workflowPath: item.workflowPath,
      evidenceKind: record.evidenceKind,
      modelSnapshotDigest: model ? evidenceDigest(model) : null,
      records: 0,
      completed: 0,
      failed: 0,
      notRun: 0,
      decisions: 0,
      adopted: 0,
      pendingDecisions: 0,
      humanReviews: 0,
      unknownUsage: 0,
      reportedZeroUsage: 0,
      unknownCost: 0,
      settlementReceipts: 0,
    };
    group.records += 1;
    group.completed += Number(record.status === "completed");
    group.failed += Number(record.status === "failed");
    group.notRun += Number(record.status === "not-run");
    if (record.status === "completed") {
      group.decisions += Number(record.adopted !== null);
      group.adopted += Number(record.adopted === true);
      group.pendingDecisions += Number(record.adopted === null);
    }
    group.humanReviews += Number(review !== null);
    group.unknownUsage += Number(
      usage === null ||
        usage.inputTokens === null ||
        usage.outputTokens === null,
    );
    group.reportedZeroUsage += Number(
      usage?.inputTokens === 0 && usage?.outputTokens === 0,
    );
    group.unknownCost += Number(cost === null);
    group.settlementReceipts += Number(cost !== null);
    groups.set(key, group);
  }
  return {
    schemaVersion: 1,
    inputSchemaVersion: report.schemaVersion,
    suiteDigest: report.suiteDigest,
    recordConsistency: "pass",
    independentlyVerifiedExternalEvidence: false,
    qualityConclusion: "not-established",
    releaseGate: "not-established",
    missingCaseIds: catalog.cases
      .filter(
        (item) => !report.records.some((record) => record.caseId === item.id),
      )
      .map((item) => item.id),
    uncompletedCaseIds: catalog.cases
      .filter(
        (item) =>
          !report.records.some(
            (record) =>
              record.caseId === item.id && record.status === "completed",
          ),
      )
      .map((item) => item.id),
    groups: [...groups.values()],
    boundary:
      "Counts reflect supplied records only. Digests do not verify file bytes, model origin, settlement, authorization or human identity. Pending decisions are not rejected; no pooled model score or quality pass is produced.",
  };
}

/** Descriptive observations only: no inferred run identity or quality threshold. */
export function summarizeEvaluationRecord(catalog, report) {
  const validation = validateEvaluationRecord(catalog, report);
  const cases = new Map(catalog.cases.map((item) => [item.id, item]));
  const grouped = new Map();
  for (const record of report.records) {
    const item = cases.get(record.caseId);
    const modelDigest = record.modelSnapshot
      ? evidenceDigest(record.modelSnapshot)
      : null;
    const key = JSON.stringify([
      item.workflowPath,
      record.evidenceKind,
      modelDigest,
    ]);
    const records = grouped.get(key) ?? [];
    records.push(record);
    grouped.set(key, records);
  }
  const statistics = (values) => {
    const known = values.filter((value) => value !== null);
    return {
      observed: known.length,
      unknown: values.length - known.length,
      reportedZero: known.filter((value) => value === 0).length,
      minimum: known.length ? Math.min(...known) : null,
      maximum: known.length ? Math.max(...known) : null,
      // Individual values are safe integers; their sum need not be. Keep the
      // mean exact and explicitly tied to known observations, not all records.
      mean: known.length
        ? {
            numerator: known
              .reduce((sum, value) => sum + BigInt(value), 0n)
              .toString(),
            denominator: known.length,
          }
        : null,
    };
  };
  const decimal = (amount) => {
    const [integer, fraction = ""] = amount.split(".");
    return BigInt(integer) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
  };
  const observations = validation.groups.map((group) => {
    const records = grouped.get(
      JSON.stringify([
        group.workflowPath,
        group.evidenceKind,
        group.modelSnapshotDigest,
      ]),
    );
    const completed = records.filter((record) => record.status === "completed");
    const executed = records.filter((record) => record.status !== "not-run");
    const decisions = completed.filter((record) => record.adopted !== null);
    const reviews = completed.filter((record) => record.humanReview !== null);
    const checks = [
      ...new Set(
        completed.flatMap((record) => cases.get(record.caseId).checks),
      ),
    ]
      .sort()
      .map((checkId) => {
        const applicable = completed.filter((record) =>
          cases.get(record.caseId).checks.includes(checkId),
        );
        const results = applicable.map(
          (record) =>
            record.humanReview?.checks.find((check) => check.id === checkId)
              ?.result,
        );
        return {
          checkId,
          applicableRecords: applicable.length,
          pass: results.filter((result) => result === "pass").length,
          fail: results.filter((result) => result === "fail").length,
          unknown: results.filter((result) => result === "unknown").length,
          unreviewed: results.filter((result) => result === undefined).length,
        };
      });
    const settlements = new Map();
    for (const record of executed) {
      if (!record.settledCost) continue;
      const cost = record.settledCost;
      const entries = settlements.get(cost.currency) ?? [];
      entries.push(cost);
      settlements.set(cost.currency, entries);
    }
    return {
      workflowPath: group.workflowPath,
      evidenceKind: group.evidenceKind,
      modelSnapshotDigest: group.modelSnapshotDigest,
      coverage: catalog.cases
        .filter((item) => records.some((record) => record.caseId === item.id))
        .map(({ id, genre, targetScale, entryPath }) => ({
          caseId: id,
          genre,
          targetScale,
          entryPath,
          records: records.filter((record) => record.caseId === id).length,
          completed: completed.filter((record) => record.caseId === id).length,
        })),
      adoption: {
        unit: "completed-record-decision",
        decisions: decisions.length,
        adopted: group.adopted,
        rejected: decisions.length - group.adopted,
        pending: group.pendingDecisions,
        ratioAmongDecisions: decisions.length
          ? group.adopted / decisions.length
          : null,
        firstCandidateAdoptionRatio: null,
      },
      revisions: statistics(completed.map((record) => record.revisionCount)),
      adoptedRecordRevisions: statistics(
        completed
          .filter((record) => record.adopted === true)
          .map((record) => record.revisionCount),
      ),
      elapsedMs: statistics(executed.map((record) => record.elapsedMs)),
      humanReview: {
        reviewedRecords: reviews.length,
        unreviewedCompletedRecords: completed.length - reviews.length,
        // These ordinal distributions remain separate; no composite score or
        // numeric mean turns them into an automatic literary-quality verdict.
        ratings: Object.fromEntries(
          ["authorIntent", "continuity", "narrativeQuality"].map(
            (dimension) => [
              dimension,
              [1, 2, 3, 4, 5].map((rating) => ({
                rating,
                count: reviews.filter(
                  (record) => record.humanReview.ratings[dimension] === rating,
                ).length,
              })),
            ],
          ),
        ),
        checks,
      },
      usage: {
        unit: "reported-observation-not-complete-run-total",
        unreportedExecutedRecords: executed.filter(
          (record) => record.reportedUsage === null,
        ).length,
        bySemantics: [
          "reported-final",
          "reported-incremental",
          "reported-cumulative",
        ].flatMap((semantics) => {
          const items = executed.filter(
            (record) => record.reportedUsage?.semantics === semantics,
          );
          return items.length
            ? [
                {
                  semantics,
                  records: items.length,
                  distinctDeclaredReceiptDigests: new Set(
                    items.map((record) => record.reportedUsage.receiptDigest),
                  ).size,
                  inputTokens: statistics(
                    items.map((record) => record.reportedUsage.inputTokens),
                  ),
                  outputTokens: statistics(
                    items.map((record) => record.reportedUsage.outputTokens),
                  ),
                },
              ]
            : [];
        }),
        totalTokens: null,
      },
      settlement: {
        unit: "declared-receipt-observation-not-distinct-charge",
        unreportedExecutedRecords: executed.filter(
          (record) => record.settledCost === null,
        ).length,
        byCurrency: [...settlements]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, entries]) => {
            const ordered = [...entries].sort((a, b) => {
              const left = decimal(a.amount),
                right = decimal(b.amount);
              return left < right ? -1 : left > right ? 1 : 0;
            });
            return {
              currency,
              records: entries.length,
              distinctDeclaredReceiptDigests: new Set(
                entries.map((entry) => entry.receiptDigest),
              ).size,
              reportedZero: entries.filter(
                (entry) => decimal(entry.amount) === 0n,
              ).length,
              minimumAmount: ordered[0].amount,
              maximumAmount: ordered.at(-1).amount,
            };
          }),
        totalCost: null,
      },
    };
  });
  return {
    ...validation,
    recordDigest: evidenceDigest(report),
    observationPolicy: "supplied-records-not-distinct-runs-or-formal-results",
    statisticsPolicy: "known-observations-only-no-imputation-or-pooled-models",
    revisionPolicy: "declared-count-not-inferred-from-attempts-or-candidates",
    elapsedPolicy: "declared-run-elapsed-not-time-to-adoption",
    observations,
    boundary:
      "Descriptive supplied-record observations only; origin labels and receipt digests are unverified. Repeated declarations can describe the same run, candidate or charge. No first-candidate rate, token/cost total, per-minute cost, quality threshold or release pass is inferred. Target scales do not certify full-book corpus coverage. Human ordinal ratings and individual checks remain independent; unknown and unreviewed are not failures.",
  };
}

/** Paired supplied observations, not a causal experiment or an automatic tuning decision. */
export function compareEvaluationRecords(catalog, baseline, result) {
  const beforeSummary = summarizeEvaluationRecord(catalog, baseline);
  const afterSummary = summarizeEvaluationRecord(catalog, result);
  const decimal = (amount) => {
    const [integer, fraction = ""] = amount.split(".");
    return BigInt(integer) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
  };
  const amount = (units) => {
    const absolute = units < 0n ? -units : units;
    const fraction = String(absolute % 100_000_000n)
      .padStart(8, "0")
      .replace(/0+$/u, "");
    return `${units < 0n ? "-" : ""}${absolute / 100_000_000n}${fraction ? `.${fraction}` : ""}`;
  };
  const directions = (values) => ({
    lower: values.filter((v) => v < 0).length,
    same: values.filter((v) => v === 0).length,
    higher: values.filter((v) => v > 0).length,
  });
  const changes = (pairs, field) => {
    const known = pairs.filter(
      (p) => p.before[field] !== null && p.after[field] !== null,
    );
    return {
      observedPairs: known.length,
      unknownPairs: pairs.length - known.length,
      beforeMean: known.length
        ? {
            numerator: known
              .reduce((n, p) => n + BigInt(p.before[field]), 0n)
              .toString(),
            denominator: known.length,
          }
        : null,
      afterMean: known.length
        ? {
            numerator: known
              .reduce((n, p) => n + BigInt(p.after[field]), 0n)
              .toString(),
            denominator: known.length,
          }
        : null,
      ...directions(known.map((p) => p.after[field] - p.before[field])),
    };
  };
  const all = [...baseline.records, ...result.records];
  const frequencies = (select) => {
    const values = new Map();
    for (const r of all) {
      const value = select(r);
      if (value != null) values.set(value, (values.get(value) ?? 0) + 1);
    }
    return values;
  };
  const candidateCases = new Map();
  for (const r of all) {
    if (r.candidateDigest === null) continue;
    const ids = candidateCases.get(r.candidateDigest) ?? new Set();
    ids.add(r.caseId);
    candidateCases.set(r.candidateDigest, ids);
  }
  const settlements = frequencies((r) => r.settledCost?.receiptDigest);
  const executions = frequencies((r) => r.execution?.receiptDigest);
  const exclusions = [],
    paired = [],
    groups = new Map();
  const statusCounts = (records) => ({
    records: records.length,
    completed: records.filter((r) => r.status === "completed").length,
    failed: records.filter((r) => r.status === "failed").length,
    notRun: records.filter((r) => r.status === "not-run").length,
  });
  for (const item of catalog.cases) {
    const left = baseline.records.filter((r) => r.caseId === item.id);
    const right = result.records.filter((r) => r.caseId === item.id);
    const reasons = [];
    for (const [side, records] of [
      ["before", left],
      ["after", right],
    ]) {
      if (!records.length) reasons.push(`${side}-missing`);
      else if (records.length !== 1) reasons.push(`${side}-ambiguous`);
      else if (records[0].status !== "completed")
        reasons.push(`${side}-${records[0].status}`);
    }
    const before = left[0],
      after = right[0];
    const candidateUnchanged =
      before?.candidateDigest != null &&
      before.candidateDigest === after?.candidateDigest;
    const executionOrdered =
      before?.execution != null && after?.execution != null
        ? Date.parse(after.execution.startedAt) >=
          Date.parse(before.execution.finishedAt)
        : null;
    const distinctExecutionReferences =
      before?.execution != null && after?.execution != null
        ? [before, after].every(
            (r) => executions.get(r.execution.receiptDigest) === 1,
          )
        : null;
    if (
      !reasons.length &&
      [before, after].some(
        (r) => candidateCases.get(r.candidateDigest).size !== 1,
      )
    )
      reasons.push("candidate-reused-across-cases");
    if (
      !reasons.length &&
      candidateUnchanged &&
      !(executionOrdered === true && distinctExecutionReferences === true)
    )
      reasons.push("unchanged-candidate-without-distinct-ordered-executions");
    if (reasons.length) {
      exclusions.push({
        caseId: item.id,
        workflowPath: item.workflowPath,
        before: statusCounts(left),
        after: statusCounts(right),
        reasons,
      });
      continue;
    }
    const sameReviewer =
      before.humanReview !== null &&
      after.humanReview !== null &&
      before.humanReview.reviewerTag === after.humanReview.reviewerTag;
    const sameProtocol =
      before.execution?.protocolDigest != null &&
      after.execution?.protocolDigest != null
        ? before.execution.protocolDigest === after.execution.protocolDigest
        : null;
    const costReasons = [];
    if (before.settledCost === null || after.settledCost === null)
      costReasons.push("settlement-missing");
    else {
      if (before.settledCost.currency !== after.settledCost.currency)
        costReasons.push("currency-changed");
      if (
        [before, after].some(
          (r) => settlements.get(r.settledCost.receiptDigest) !== 1,
        )
      )
        costReasons.push("shared-settlement-reference");
    }
    const cost = costReasons.length
      ? null
      : {
          currency: before.settledCost.currency,
          beforeAmount: before.settledCost.amount,
          afterAmount: after.settledCost.amount,
          deltaAmount: amount(
            decimal(after.settledCost.amount) -
              decimal(before.settledCost.amount),
          ),
        };
    const key = JSON.stringify([
      item.workflowPath,
      before.evidenceKind,
      after.evidenceKind,
      evidenceDigest(before.modelSnapshot),
      evidenceDigest(after.modelSnapshot),
    ]);
    const group = groups.get(key) ?? {
      workflowPath: item.workflowPath,
      beforeEvidenceKind: before.evidenceKind,
      afterEvidenceKind: after.evidenceKind,
      beforeModelSnapshotDigest: evidenceDigest(before.modelSnapshot),
      afterModelSnapshotDigest: evidenceDigest(after.modelSnapshot),
      pairs: [],
    };
    const pair = {
      before,
      after,
      item,
      sameReviewer,
      candidateUnchanged,
      sameProtocol,
      executionOrdered,
      distinctExecutionReferences,
      cost,
    };
    group.pairs.push(pair);
    groups.set(key, group);
    paired.push({
      caseId: item.id,
      workflowPath: item.workflowPath,
      pairDigest: evidenceDigest({ before, after }),
      sameReviewer,
      candidateUnchanged,
      sameProtocol,
      executionOrdered,
      distinctExecutionReferences,
      cost,
      costIncomparability: costReasons,
    });
  }
  const cohorts = [...groups.values()].map(({ pairs, ...identity }) => {
    const decisions = pairs.filter(
      (p) => p.before.adopted !== null && p.after.adopted !== null,
    );
    const reviewed = pairs.filter((p) => p.sameReviewer);
    const knownCosts = pairs.filter((p) => p.cost !== null);
    const continuityChecks = [
      "character-knowledge",
      "timeline",
      "relationship",
      "foreshadowing",
      "causality",
      "screenplay-continuity",
      "world-rule",
    ];
    const checks = [...new Set(pairs.flatMap((p) => p.item.checks))]
      .sort()
      .map((checkId) => {
        const applicable = pairs.filter((p) => p.item.checks.includes(checkId));
        const observed = applicable
          .filter((p) => p.sameReviewer)
          .map((p) => ({
            before: p.before.humanReview.checks.find((c) => c.id === checkId)
              .result,
            after: p.after.humanReview.checks.find((c) => c.id === checkId)
              .result,
          }));
        const known = observed.filter(
          (p) => p.before !== "unknown" && p.after !== "unknown",
        );
        return {
          checkId,
          applicablePairs: applicable.length,
          observedPairs: known.length,
          unknownOrUnreviewedPairs: applicable.length - known.length,
          beforeFailures: known.filter((p) => p.before === "fail").length,
          afterFailures: known.filter((p) => p.after === "fail").length,
          introducedFailures: known.filter(
            (p) => p.before === "pass" && p.after === "fail",
          ).length,
          resolvedFailures: known.filter(
            (p) => p.before === "fail" && p.after === "pass",
          ).length,
        };
      });
    return {
      ...identity,
      pairedCases: pairs.length,
      unchangedCandidatePairs: pairs.filter((p) => p.candidateUnchanged).length,
      adoption: {
        observedPairs: decisions.length,
        unknownPairs: pairs.length - decisions.length,
        beforeAdopted: decisions.filter((p) => p.before.adopted).length,
        afterAdopted: decisions.filter((p) => p.after.adopted).length,
        gained: decisions.filter((p) => !p.before.adopted && p.after.adopted)
          .length,
        lost: decisions.filter((p) => p.before.adopted && !p.after.adopted)
          .length,
        rateDelta: decisions.length
          ? {
              numerator: decisions.reduce(
                (n, p) =>
                  n + Number(p.after.adopted) - Number(p.before.adopted),
                0,
              ),
              denominator: decisions.length,
            }
          : null,
        firstCandidateAdoptionRate: null,
      },
      revisions: changes(pairs, "revisionCount"),
      declaredElapsedMs: changes(pairs, "elapsedMs"),
      humanRatings: Object.fromEntries(
        ["authorIntent", "continuity", "narrativeQuality"].map((dimension) => [
          dimension,
          {
            observedPairs: reviewed.length,
            unknownOrChangedReviewerPairs: pairs.length - reviewed.length,
            ...directions(
              reviewed.map(
                (p) =>
                  p.after.humanReview.ratings[dimension] -
                  p.before.humanReview.ratings[dimension],
              ),
            ),
          },
        ]),
      ),
      checks,
      continuityChecks: checks.filter((c) =>
        continuityChecks.includes(c.checkId),
      ),
      cost: {
        observedPairs: knownCosts.length,
        incomparablePairs: pairs.length - knownCosts.length,
        byCurrency: [...new Set(knownCosts.map((p) => p.cost.currency))]
          .sort()
          .map((currency) => ({
            currency,
            ...directions(
              knownCosts
                .filter((p) => p.cost.currency === currency)
                .map((p) => {
                  const delta =
                    decimal(p.after.settledCost.amount) -
                    decimal(p.before.settledCost.amount);
                  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
                }),
            ),
          })),
        totalCost: null,
        estimatedSavings: null,
      },
      declaredExecution: {
        sameProtocol: pairs.filter((p) => p.sameProtocol === true).length,
        changedProtocol: pairs.filter((p) => p.sameProtocol === false).length,
        unknownProtocol: pairs.filter((p) => p.sameProtocol === null).length,
        ordered: pairs.filter((p) => p.executionOrdered === true).length,
        overlappingOrReversed: pairs.filter((p) => p.executionOrdered === false)
          .length,
        unknownTimes: pairs.filter((p) => p.executionOrdered === null).length,
        distinctReferences: pairs.filter(
          (p) => p.distinctExecutionReferences === true,
        ).length,
        sharedReferences: pairs.filter(
          (p) => p.distinctExecutionReferences === false,
        ).length,
        unknownReferences: pairs.filter(
          (p) => p.distinctExecutionReferences === null,
        ).length,
      },
    };
  });
  const comparison = {
    schemaVersion: 1,
    suiteDigest: evidenceDigest(catalog),
    baselineDigest: evidenceDigest(baseline),
    resultDigest: evidenceDigest(result),
    baselineSummaryDigest: evidenceDigest(beforeSummary),
    resultSummaryDigest: evidenceDigest(afterSummary),
    requiredCases: catalog.cases.length,
    pairedCases: paired.length,
    excludedCases: exclusions.length,
    pairs: paired,
    exclusions,
    cohorts,
    tuningDecision: "not-made",
    independentlyVerifiedExternalEvidence: false,
    qualityConclusion: "not-established",
    releaseGate: "not-established",
    m5Completion: "not-established",
    boundary:
      "Paired supplied-record observations only, never causal proof or an automatic retain/revert decision. Same input/suite and exactly one completed record per case are required; ambiguous, missing, failed, unrun or cross-case reused candidates are excluded, not zero-filled. Unchanged outputs remain paired when distinct ordered execution references are supplied; absent or reused references cannot establish a new observation. Sources and full before/after model configurations remain separate. Human comparisons require the same declared blinded reviewer; unknown is not a failure. Cost deltas require the same currency and unique declared settlement references; charges, timestamps, protocol bindings, participants and evidence origins are not authenticated. No first-candidate adoption rate, pooled cost/savings, literary score or M5/release pass is inferred. Explicit continuity check IDs are descriptive, not a complete semantic review. Execution/protocol differences remain visible and do not establish experimental comparability.",
  };
  return { ...comparison, comparisonDigest: evidenceDigest(comparison) };
}

/** Explicit local attachments only. Byte equality never authenticates their meaning or origin. */
export async function verifyEvaluationEvidence(catalog, report, directory) {
  validateEvaluationRecord(catalog, report);
  requireFact(
    typeof directory === "string" && directory.length > 0,
    "invalid-evidence-directory",
  );
  requireFact(
    typeof constants.O_NOFOLLOW === "number" &&
      constants.O_NOFOLLOW > 0 &&
      typeof constants.O_NONBLOCK === "number" &&
      constants.O_NONBLOCK > 0,
    "evidence-filesystem-unavailable",
  );
  const root = resolve(directory),
    references = new Map();
  const add = (recordId, role, value) => {
    if (value == null) return;
    const entries = references.get(value) ?? [];
    entries.push({ recordDigest: evidenceDigest(recordId), role });
    references.set(value, entries);
  };
  for (const r of report.records) {
    add(r.recordId, "candidate", r.candidateDigest);
    add(
      r.recordId,
      "model-configuration",
      r.modelSnapshot?.configurationDigest,
    );
    add(r.recordId, "execution", r.execution?.receiptDigest);
    add(r.recordId, "protocol", r.execution?.protocolDigest);
    add(r.recordId, "usage", r.reportedUsage?.receiptDigest);
    add(r.recordId, "settlement", r.settledCost?.receiptDigest);
    add(r.recordId, "human-review", r.humanReview?.evidenceDigest);
  }
  requireFact(references.size <= 5000, "evidence-limit-exceeded");
  const rootHandle = await open(
    root,
    constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_DIRECTORY ?? 0),
  ).catch(() => {
    throw new EvaluationValidationError("invalid-evidence-directory");
  });
  try {
    const rootStat = await rootHandle.stat({ bigint: true });
    requireFact(rootStat.isDirectory(), "invalid-evidence-directory");
    const sameDirectory = async () => {
      const value = await lstat(root, { bigint: true }).catch(() => null);
      requireFact(
        value?.isDirectory() &&
          !value.isSymbolicLink() &&
          value.dev === rootStat.dev &&
          value.ino === rootStat.ino,
        "evidence-directory-changed",
      );
    };
    await sameDirectory();
    let declaredBytes = 0n;
    const observations = [];
    for (const [expectedDigest, usages] of [...references].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      await sameDirectory();
      const path = join(root, `${expectedDigest}.receipt`);
      const observed = {
        digest: expectedDigest,
        references: usages,
        state: "unreadable",
        bytes: null,
        observedDigest: null,
      };
      const stat = await lstat(path, { bigint: true }).catch((e) => {
        if (e.code === "ENOENT") {
          observed.state = "missing";
          return null;
        }
        return null;
      });
      if (
        stat &&
        (!stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.size > 32n * 1024n * 1024n)
      )
        observed.state = "unsafe-or-excessive-file";
      else if (stat) {
        declaredBytes += stat.size;
        requireFact(
          declaredBytes <= 256n * 1024n * 1024n,
          "evidence-limit-exceeded",
        );
        let handle;
        try {
          handle = await open(
            path,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          const before = await handle.stat({ bigint: true });
          const sameFile = (a, b) =>
            a.dev === b.dev &&
            a.ino === b.ino &&
            a.size === b.size &&
            a.mtimeNs === b.mtimeNs &&
            a.ctimeNs === b.ctimeNs;
          if (!before.isFile() || !sameFile(stat, before))
            observed.state = "changed";
          else {
            const hash = createHash("sha256"),
              buffer = Buffer.alloc(65536);
            let total = 0;
            for (;;) {
              const { bytesRead } = await handle.read(
                buffer,
                0,
                buffer.length,
                null,
              );
              if (!bytesRead) break;
              total += bytesRead;
              if (total > 32 * 1024 * 1024) break;
              hash.update(buffer.subarray(0, bytesRead));
            }
            const after = await handle.stat({ bigint: true }),
              current = await lstat(path, { bigint: true }).catch(() => null);
            if (
              BigInt(total) !== before.size ||
              !sameFile(before, after) ||
              !current?.isFile() ||
              current.isSymbolicLink() ||
              !sameFile(after, current)
            )
              observed.state = "changed";
            else {
              observed.bytes = total;
              observed.observedDigest = hash.digest("hex");
              observed.state =
                observed.observedDigest === expectedDigest
                  ? "matched-at-read"
                  : "digest-mismatch";
            }
          }
        } catch {
          observed.state = "unreadable";
        } finally {
          await handle?.close();
        }
      }
      await sameDirectory();
      observations.push(observed);
    }
    const matched = observations.filter(
      (o) => o.state === "matched-at-read",
    ).length;
    const value = {
      schemaVersion: 1,
      suiteDigest: evidenceDigest(catalog),
      recordDigest: evidenceDigest(report),
      filePolicy: "explicit-content-addressed-receipt-files-raw-sha256",
      fileEvidence: observations.length
        ? matched === observations.length
          ? "complete"
          : "incomplete"
        : "none",
      referencedDigests: observations.length,
      matchedDigests: matched,
      declaredReferences: observations.reduce(
        (n, o) => n + o.references.length,
        0,
      ),
      observations,
      independentlyVerifiedExternalEvidence: false,
      qualityConclusion: "not-established",
      releaseGate: "not-established",
      m5Completion: "not-established",
      boundary:
        "Individual local file bytes matched their declared raw SHA-256 at read time, not an atomic directory snapshot, original owner receipt, independent run/charge, input-to-run binding, model origin/version, participant, consent, authorization, settlement, semantic review or M5/release pass. Shared references remain shared; no token/cost totals or quality decision. Files are not interpreted or printed. Canonical JSON digests are not silently converted to raw file digests; supply the exact original bytes or retain the mismatch.",
    };
    return { ...value, verificationDigest: evidenceDigest(value) };
  } finally {
    await rootHandle.close();
  }
}

async function main(args) {
  let catalogPath;
  if (args[0] === "--catalog") {
    requireFact(
      args.length >= 3 && args[1] && !args[1].startsWith("--"),
      "invalid-command",
    );
    catalogPath = resolve(args[1]);
    args = args.slice(2);
  }
  const [command, ...rest] = args;
  if (command === "--help" && rest.length === 0) {
    console.log(
      "Offline only; no model/network/file writes. Optional prefix: --catalog <local-v2-catalog.json> (new corpus suite; old records are not rebound). Commands: catalog | template | study-template | user-template <novel|adaptation|script> | validate <local-record.json> | summarize <local-record.json> | compare <baseline-record.json> <result-record.json> | verify-evidence <local-record.json> <explicit-receipt-directory> | study-check <local-study.json>. verify-evidence reads only <raw-sha256>.receipt files (32 MiB each, 256 MiB total); exit 2 means missing/incomplete file evidence. Run through node scripts/run-node.mjs scripts/product-evaluation.mjs. Consistency checks never independently certify corpus extent/scale, quality, participants, consent, bills or release readiness.",
    );
    return;
  }
  requireFact(
    ["catalog", "template", "study-template"].includes(command)
      ? rest.length === 0
      : ["compare", "verify-evidence"].includes(command)
        ? rest.length === 2
        : ["validate", "summarize", "study-check", "user-template"].includes(
            command,
          ) && rest.length === 1,
    "invalid-command",
  );
  const catalog = await loadCatalog(catalogPath);
  requireFact(
    !catalogPath || catalog.schemaVersion === 2,
    "versioned-catalog-required",
  );
  if (command === "verify-evidence") {
    const value = await verifyEvaluationEvidence(
      catalog,
      await readJson(resolve(rest[0])),
      rest[1],
    );
    console.log(JSON.stringify(value, null, 2));
    if (value.fileEvidence !== "complete") process.exitCode = 2;
    return;
  }
  if (command === "compare") {
    const [baseline, result] = await Promise.all(
      rest.map((path) => readJson(resolve(path))),
    );
    console.log(
      JSON.stringify(
        compareEvaluationRecords(catalog, baseline, result),
        null,
        2,
      ),
    );
    return;
  }
  if (["study-template", "study-check", "user-template"].includes(command)) {
    const study = await import("./product-study.mjs");
    const result =
      command === "study-template"
        ? study.createStudyTemplate(catalog)
        : command === "user-template"
          ? study.createUserSessionTemplate(rest[0])
          : study.checkProductStudy(catalog, await readJson(resolve(rest[0])));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const result =
    command === "catalog"
      ? {
          schemaVersion: catalog.schemaVersion,
          status: catalog.status,
          suiteDigest: evidenceDigest(catalog),
          sourcePolicy: catalogPath
            ? "supplied-local-catalog; source declarations unverified"
            : catalog.sourcePolicy,
          corpus: summarizeCatalogSources(catalog),
          cases: catalog.cases.map(
            ({ id, genre, targetScale, entryPath, workflowPath, checks }) => ({
              id,
              genre,
              targetScale,
              entryPath,
              workflowPath,
              checks,
            }),
          ),
        }
      : command === "template"
        ? createTemplate(catalog)
        : (command === "summarize"
            ? summarizeEvaluationRecord
            : validateEvaluationRecord)(
            catalog,
            await readJson(resolve(rest[0])),
          );
  console.log(JSON.stringify(result, null, 2));
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // Finish initializing the reusable evaluation exports before loading the
  // study command, which consumes those exports. Avoid an async module cycle.
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      `Product evaluation rejected: ${error instanceof EvaluationValidationError ? error.code : "invalid-file-or-json"}`,
    );
    process.exitCode = 1;
  });
}
