import {
  createTemplate,
  evidenceDigest,
  EvaluationValidationError,
  summarizeEvaluationRecord,
  summarizeCatalogSources,
} from "./product-evaluation.mjs";

const PATHS = ["novel", "adaptation", "script"];
const ROLES = ["author", "screenwriter", "studio"];
const TASKS = {
  novel: [
    "author-intent",
    "planning",
    "chapter-one",
    "chapter-two",
    "continuity",
    "manuscript",
  ],
  adaptation: [
    "diagnosis",
    "strategy",
    "season-plan",
    "script",
    "storyboard",
    "pilot-package",
  ],
  script: ["episode-outline", "script", "storyboard", "pilot-package"],
};
const SHA = /^[a-f0-9]{64}$/u;
const TAG = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/u;
const fact = (ok, code = "invalid-study") => {
  if (!ok) throw new EvaluationValidationError(code);
};
const keys = (v, names) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === names.length &&
  names.every((n) => Object.hasOwn(v, n));
const sha = (v) => typeof v === "string" && SHA.test(v);
const nullableSha = (v) => v === null || sha(v);
const tag = (v) => typeof v === "string" && TAG.test(v);
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const instant = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;

/** Proposed thresholds are not approved thresholds. Every real observation starts absent. */
export function createStudyTemplate(catalog) {
  return {
    schemaVersion: 1,
    suiteDigest: evidenceDigest(catalog),
    protocol: {
      studyId: "m5-pilot-1",
      status: "draft",
      frozenAt: null,
      approvalDigest: null,
      thresholds: {
        adoptionMinimum: { numerator: 7, denominator: 10 },
        minimumHumanRating: 3,
        unassistedCompletionMinimum: { numerator: 4, denominator: 5 },
        maximumContinuityFailures: 0,
      },
    },
    evaluation: createTemplate(catalog),
    sessions: [],
    tuning: [],
    publicCases: [],
    commercialDecision: null,
    releases: [],
  };
}

/** Metadata only; this is a participant-owned observation form, not a fabricated participant. */
export function createUserSessionTemplate(workflowPath = "novel") {
  fact(PATHS.includes(workflowPath));
  return {
    participantTag: "participant-pending",
    role: "author",
    workflowPath,
    consentDigest: null,
    deviceDigest: null,
    buildDigest: null,
    modelSnapshotDigest: null,
    conditionsDigest: null,
    status: "not-run",
    startedAt: null,
    firstCandidateAt: null,
    firstDecisionAt: null,
    finishedAt: null,
    helpCount: null,
    revisionCount: null,
    continuityFailures: null,
    tasks: TASKS[workflowPath].map((id) => ({
      id,
      result: "not-run",
      evidenceDigest: null,
    })),
    sourceChange: "not-run",
    restartRecovery: "not-run",
    finalArtifactDigest: null,
    observationDigest: null,
  };
}

function validateSession(v) {
  fact(
    keys(v, [
      "participantTag",
      "role",
      "workflowPath",
      "consentDigest",
      "deviceDigest",
      "buildDigest",
      "modelSnapshotDigest",
      "conditionsDigest",
      "status",
      "startedAt",
      "firstCandidateAt",
      "firstDecisionAt",
      "finishedAt",
      "helpCount",
      "revisionCount",
      "continuityFailures",
      "tasks",
      "sourceChange",
      "restartRecovery",
      "finalArtifactDigest",
      "observationDigest",
    ]),
  );
  fact(
    tag(v.participantTag) &&
      ROLES.includes(v.role) &&
      PATHS.includes(v.workflowPath),
  );
  fact(["not-run", "completed", "failed", "abandoned"].includes(v.status));
  for (const field of [
    "consentDigest",
    "deviceDigest",
    "buildDigest",
    "modelSnapshotDigest",
    "conditionsDigest",
    "finalArtifactDigest",
    "observationDigest",
  ])
    fact(nullableSha(v[field]));
  for (const field of ["helpCount", "revisionCount", "continuityFailures"])
    fact(v[field] === null || count(v[field]));
  const times = [
    "startedAt",
    "firstCandidateAt",
    "firstDecisionAt",
    "finishedAt",
  ].map((k) => v[k]);
  fact(times.every((t) => t === null || instant(t)));
  fact(
    times
      .filter((t) => t !== null)
      .every((t, i, a) => i === 0 || Date.parse(t) >= Date.parse(a[i - 1])),
    "study-clock-order",
  );
  fact(
    Array.isArray(v.tasks) && v.tasks.length === TASKS[v.workflowPath].length,
  );
  fact(new Set(v.tasks.map((t) => t?.id)).size === v.tasks.length);
  for (const t of v.tasks)
    fact(
      keys(t, ["id", "result", "evidenceDigest"]) &&
        TASKS[v.workflowPath].includes(t.id) &&
        ["not-run", "pass", "fail", "unknown"].includes(t.result) &&
        nullableSha(t.evidenceDigest) &&
        (t.result === "not-run"
          ? t.evidenceDigest === null
          : sha(t.evidenceDigest)),
    );
  fact(
    ["not-run", "pass", "fail", "unknown"].includes(v.sourceChange) &&
      ["not-run", "pass", "fail", "unknown"].includes(v.restartRecovery),
  );
  if (v.status === "not-run") {
    fact(
      times.every((t) => t === null) &&
        [
          v.helpCount,
          v.revisionCount,
          v.continuityFailures,
          v.finalArtifactDigest,
          v.observationDigest,
        ].every((x) => x === null) &&
        v.tasks.every((t) => t.result === "not-run") &&
        v.sourceChange === "not-run" &&
        v.restartRecovery === "not-run",
      "unrun-study-evidence",
    );
  } else {
    fact(sha(v.consentDigest), "study-consent-missing");
    fact(
      instant(v.startedAt) && instant(v.finishedAt) && sha(v.observationDigest),
      "study-observation-missing",
    );
  }
  if (v.firstCandidateAt !== null) fact(v.startedAt !== null);
  if (v.firstDecisionAt !== null) fact(v.firstCandidateAt !== null);
}

const fraction = (v) =>
  keys(v, ["numerator", "denominator"]) &&
  count(v.numerator) &&
  Number.isSafeInteger(v.denominator) &&
  v.denominator > 0 &&
  v.denominator <= 1_000 &&
  v.numerator <= v.denominator;
const meets = (n, d, threshold) =>
  d > 0 &&
  BigInt(n) * BigInt(threshold.denominator) >=
    BigInt(d) * BigInt(threshold.numerator);
const suppliedState = (ok) =>
  ok ? "supplied-evidence-complete" : "incomplete";

export function checkProductStudy(catalog, study) {
  fact(
    keys(study, [
      "schemaVersion",
      "suiteDigest",
      "protocol",
      "evaluation",
      "sessions",
      "tuning",
      "publicCases",
      "commercialDecision",
      "releases",
    ]),
  );
  fact(
    study.schemaVersion === 1 && study.suiteDigest === evidenceDigest(catalog),
    "stale-suite",
  );
  const p = study.protocol;
  fact(
    keys(p, [
      "studyId",
      "status",
      "frozenAt",
      "approvalDigest",
      "thresholds",
    ]) && tag(p.studyId),
  );
  fact(
    ["draft", "frozen"].includes(p.status) &&
      nullableSha(p.approvalDigest) &&
      (p.frozenAt === null || instant(p.frozenAt)),
  );
  fact(
    p.status === "frozen"
      ? sha(p.approvalDigest) && instant(p.frozenAt)
      : p.approvalDigest === null && p.frozenAt === null,
  );
  const t = p.thresholds;
  fact(
    keys(t, [
      "adoptionMinimum",
      "minimumHumanRating",
      "unassistedCompletionMinimum",
      "maximumContinuityFailures",
    ]) &&
      fraction(t.adoptionMinimum) &&
      fraction(t.unassistedCompletionMinimum) &&
      Number.isInteger(t.minimumHumanRating) &&
      t.minimumHumanRating >= 1 &&
      t.minimumHumanRating <= 5 &&
      count(t.maximumContinuityFailures),
  );
  const summary = summarizeEvaluationRecord(catalog, study.evaluation);
  const corpus = summarizeCatalogSources(catalog);
  const protocolDigest =
    catalog.schemaVersion === 2
      ? evidenceDigest({ suiteDigest: study.suiteDigest, protocol: p })
      : evidenceDigest(p);
  const executedRealRecords = study.evaluation.records.filter(
    (r) => r.evidenceKind === "real-model" && r.status !== "not-run",
  );
  const executionScope = (records) => {
    const executed = records.filter((r) => r.status !== "not-run");
    const timed = executed.filter((r) => r.execution != null);
    const bound = timed.filter((r) => r.execution.protocolDigest !== null);
    return {
      observedRuns: executed.length,
      suppliedExecutionTimes: timed.length,
      suppliedProtocolBindings: bound.length,
      protocolBeforeObservedRuns:
        p.status === "frozen" &&
        executed.length > 0 &&
        timed.length === executed.length
          ? timed.every(
              (r) =>
                Date.parse(r.execution.startedAt) >= Date.parse(p.frozenAt),
            )
          : null,
      executionProtocolBindingsMatch:
        p.status === "frozen" &&
        executed.length > 0 &&
        bound.length === executed.length
          ? bound.every((r) => r.execution.protocolDigest === protocolDigest)
          : null,
    };
  };
  const modelExecution = executionScope(executedRealRecords);
  const modelGroups = summary.observations
    .filter((g) => g.evidenceKind === "real-model")
    .map((g) => {
      const ids = catalog.cases
        .filter((c) => c.workflowPath === g.workflowPath)
        .map((c) => c.id);
      const records = study.evaluation.records.filter(
        (r) =>
          r.evidenceKind === "real-model" &&
          r.modelSnapshot &&
          evidenceDigest(r.modelSnapshot) === g.modelSnapshotDigest &&
          ids.includes(r.caseId),
      );
      const uniqueCandidates = new Set(
        records.filter((r) => r.candidateDigest).map((r) => r.candidateDigest),
      );
      const complete =
        ids.every(
          (id) =>
            records.filter((r) => r.caseId === id && r.status === "completed")
              .length === 1,
        ) &&
        records.length === ids.length &&
        uniqueCandidates.size === records.length &&
        records.every(
          (r) =>
            r.adopted !== null &&
            r.revisionCount !== null &&
            r.humanReview !== null &&
            r.reportedUsage?.inputTokens !== null &&
            r.reportedUsage?.inputTokens !== undefined &&
            r.reportedUsage?.outputTokens !== null &&
            r.reportedUsage?.outputTokens !== undefined &&
            r.settledCost !== null &&
            r.execution != null &&
            r.execution.protocolDigest !== null,
        );
      const observedThresholdsMet =
        complete &&
        meets(g.adoption.adopted, g.adoption.decisions, t.adoptionMinimum) &&
        records.every(
          (r) =>
            Object.values(r.humanReview.ratings).every(
              (rating) => rating >= t.minimumHumanRating,
            ) && r.humanReview.checks.every((c) => c.result === "pass"),
        );
      return {
        workflowPath: g.workflowPath,
        modelSnapshotDigest: g.modelSnapshotDigest,
        requiredCases: ids.length,
        completedCases: ids.filter((id) =>
          records.some((r) => r.caseId === id && r.status === "completed"),
        ).length,
        suppliedEvidenceComplete: complete,
        ...executionScope(records),
        observedThresholdsMet:
          p.status === "frozen" ? observedThresholdsMet : null,
      };
    });
  fact(Array.isArray(study.sessions) && study.sessions.length <= 100);
  const participants = new Set();
  for (const session of study.sessions) {
    validateSession(session);
    fact(!participants.has(session.participantTag), "duplicate-participant");
    participants.add(session.participantTag);
  }
  const executed = study.sessions.filter((s) => s.status !== "not-run");
  const protocolBeforeObservedSessions =
    p.status === "frozen" &&
    executed.every((s) => Date.parse(s.startedAt) >= Date.parse(p.frozenAt));
  const cohorts = Object.fromEntries(
    ROLES.map((role) => [role, executed.filter((s) => s.role === role).length]),
  );
  const completed = executed.filter(
    (s) =>
      s.status === "completed" &&
      s.tasks.every((t) => t.result === "pass") &&
      s.sourceChange === "pass" &&
      s.restartRecovery === "pass" &&
      sha(s.finalArtifactDigest) &&
      s.helpCount !== null &&
      s.revisionCount !== null &&
      s.continuityFailures !== null &&
      [
        s.deviceDigest,
        s.buildDigest,
        s.modelSnapshotDigest,
        s.conditionsDigest,
      ].every(sha),
  );
  const unassisted = completed.filter((s) => s.helpCount === 0);
  const cohortComplete =
    executed.length >= 6 &&
    executed.length <= 8 &&
    cohorts.author >= 2 &&
    cohorts.author <= 3 &&
    cohorts.screenwriter >= 2 &&
    cohorts.screenwriter <= 3 &&
    cohorts.studio === 2 &&
    completed.some((s) => s.workflowPath === "novel") &&
    completed.some((s) => s.workflowPath === "adaptation");
  const comparableGroups = new Map();
  for (const s of executed) {
    const key = evidenceDigest({
      workflowPath: s.workflowPath,
      deviceDigest: s.deviceDigest,
      buildDigest: s.buildDigest,
      modelSnapshotDigest: s.modelSnapshotDigest,
      conditionsDigest: s.conditionsDigest,
    });
    const group = comparableGroups.get(key) ?? {
      groupDigest: key,
      workflowPath: s.workflowPath,
      observations: 0,
      unknownConditions: [
        s.deviceDigest,
        s.buildDigest,
        s.modelSnapshotDigest,
        s.conditionsDigest,
      ].some((x) => x === null),
      completed: 0,
      failed: 0,
      abandoned: 0,
      elapsedMs: [],
      helpCounts: [],
      revisionCounts: [],
      continuityFailures: [],
    };
    group.observations++;
    group.completed += Number(s.status === "completed");
    group.failed += Number(s.status === "failed");
    group.abandoned += Number(s.status === "abandoned");
    group.elapsedMs.push(Date.parse(s.finishedAt) - Date.parse(s.startedAt));
    group.helpCounts.push(s.helpCount);
    group.revisionCounts.push(s.revisionCount);
    group.continuityFailures.push(s.continuityFailures);
    comparableGroups.set(key, group);
  }
  fact(Array.isArray(study.tuning) && study.tuning.length <= 100);
  const tuningIds = new Set();
  for (const r of study.tuning) {
    fact(
      keys(r, [
        "id",
        "baselineDigest",
        "resultDigest",
        "changeDigest",
        "decision",
        "evidenceDigest",
      ]) &&
        tag(r.id) &&
        !tuningIds.has(r.id) &&
        [
          r.baselineDigest,
          r.resultDigest,
          r.changeDigest,
          r.evidenceDigest,
        ].every(sha) &&
        r.baselineDigest !== r.resultDigest &&
        ["retain", "revert", "pending"].includes(r.decision),
    );
    tuningIds.add(r.id);
  }
  fact(Array.isArray(study.publicCases) && study.publicCases.length <= 100);
  const publicPaths = new Set();
  for (const c of study.publicCases) {
    fact(
      keys(c, [
        "workflowPath",
        "recordIds",
        "sourceRightsDigest",
        "publicPermissionDigest",
        "publicationDigest",
        "status",
      ]) &&
        ["novel", "adaptation"].includes(c.workflowPath) &&
        !publicPaths.has(c.workflowPath) &&
        Array.isArray(c.recordIds) &&
        c.recordIds.length > 0 &&
        new Set(c.recordIds).size === c.recordIds.length &&
        c.recordIds.every(
          (id) =>
            tag(id) &&
            study.evaluation.records.some(
              (r) =>
                r.recordId === id &&
                r.evidenceKind === "real-model" &&
                r.status === "completed" &&
                r.adopted === true &&
                catalog.cases.some(
                  (item) =>
                    item.id === r.caseId &&
                    item.workflowPath === c.workflowPath,
                ),
            ),
        ) &&
        [c.sourceRightsDigest, c.publicPermissionDigest].every(sha) &&
        nullableSha(c.publicationDigest) &&
        ["prepared", "published"].includes(c.status) &&
        (c.status === "published"
          ? sha(c.publicationDigest)
          : c.publicationDigest === null),
    );
    publicPaths.add(c.workflowPath);
  }
  const commercial = study.commercialDecision;
  fact(
    commercial === null ||
      (keys(commercial, [
        "entitlementMapDigest",
        "approvalDigest",
        "effectiveAt",
        "evidenceDigest",
      ]) &&
        [
          commercial.entitlementMapDigest,
          commercial.approvalDigest,
          commercial.evidenceDigest,
        ].every(sha) &&
        instant(commercial.effectiveAt)),
  );
  fact(Array.isArray(study.releases) && study.releases.length <= 3);
  const platforms = new Set();
  for (const r of study.releases) {
    fact(
      keys(r, [
        "platform",
        "buildDigest",
        "install",
        "upgrade",
        "recovery",
        "approvalDigest",
        "evidenceDigest",
      ]) &&
        ["macos", "windows", "linux"].includes(r.platform) &&
        !platforms.has(r.platform) &&
        sha(r.buildDigest) &&
        [r.install, r.upgrade, r.recovery].every((result) =>
          ["pass", "fail", "not-run", "unknown"].includes(result),
        ) &&
        nullableSha(r.approvalDigest) &&
        sha(r.evidenceDigest),
    );
    platforms.add(r.platform);
  }
  const modelReady = ["novel", "adaptation"].every((path) =>
    modelGroups.some(
      (g) =>
        g.workflowPath === path &&
        g.suppliedEvidenceComplete &&
        g.protocolBeforeObservedRuns === true &&
        g.executionProtocolBindingsMatch === true &&
        g.observedThresholdsMet === true,
    ),
  );
  const userReady =
    protocolBeforeObservedSessions &&
    cohortComplete &&
    completed.length === executed.length &&
    meets(unassisted.length, executed.length, t.unassistedCompletionMinimum) &&
    completed.every((s) => s.continuityFailures <= t.maximumContinuityFailures);
  const releaseReady =
    platforms.size === 3 &&
    study.releases.every(
      (r) =>
        [r.install, r.upgrade, r.recovery].every(
          (result) => result === "pass",
        ) && sha(r.approvalDigest),
    );
  const gaps = [];
  if (p.status !== "frozen") gaps.push("PROTOCOL_APPROVAL_MISSING");
  else if (!protocolBeforeObservedSessions)
    gaps.push("PROTOCOL_POSTDATES_OBSERVED_SESSION");
  if (
    executedRealRecords.some(
      (r) => r.execution == null || r.execution.protocolDigest === null,
    )
  )
    gaps.push("MODEL_EXECUTION_EVIDENCE_MISSING");
  if (p.status === "frozen") {
    if (
      executedRealRecords.some(
        (r) =>
          r.execution &&
          Date.parse(r.execution.startedAt) < Date.parse(p.frozenAt),
      )
    )
      gaps.push("PROTOCOL_POSTDATES_OBSERVED_MODEL_RUN");
    if (
      executedRealRecords.some(
        (r) =>
          r.execution?.protocolDigest != null &&
          r.execution.protocolDigest !== protocolDigest,
      )
    )
      gaps.push("MODEL_EXECUTION_PROTOCOL_MISMATCH");
  }
  if (!corpus.fullCorpusDeclarationsSupplied)
    gaps.push("FULL_SOURCE_CORPUS_INCOMPLETE");
  if (!modelReady) gaps.push("REAL_MODEL_EVALUATION_INCOMPLETE");
  if (!userReady) gaps.push("TARGET_USER_STUDY_INCOMPLETE");
  if (!study.tuning.some((r) => r.decision !== "pending"))
    gaps.push("MEASURED_TUNING_MISSING");
  if (
    !["novel", "adaptation"].every((path) =>
      study.publicCases.some(
        (c) => c.workflowPath === path && c.status === "published",
      ),
    )
  )
    gaps.push("AUTHORIZED_PUBLIC_CASES_MISSING");
  if (!commercial) gaps.push("COMMERCIAL_DECISION_MISSING");
  if (!releaseReady) gaps.push("TARGET_DEVICE_RELEASE_EVIDENCE_MISSING");
  return {
    schemaVersion: 1,
    studyDigest: evidenceDigest(study),
    protocolDigest,
    recordConsistency: "pass",
    protocolStatus: p.status,
    preRegistrationIndependentlyVerified: false,
    protocolBeforeObservedSessions:
      p.status === "frozen" ? protocolBeforeObservedSessions : null,
    independentlyVerifiedExternalEvidence: false,
    qualityConclusion: "not-established",
    releaseGate: "not-established",
    m5Completion: "not-established",
    gates: [
      {
        id: "M5-01",
        state: suppliedState(
          modelReady &&
            p.status === "frozen" &&
            corpus.fullCorpusDeclarationsSupplied,
        ),
      },
      { id: "M5-02", state: suppliedState(userReady && p.status === "frozen") },
      {
        id: "M5-03",
        state: suppliedState(
          study.tuning.some((r) => r.decision !== "pending"),
        ),
      },
      {
        id: "M5-04",
        state: suppliedState(
          ["novel", "adaptation"].every((path) =>
            study.publicCases.some(
              (c) => c.workflowPath === path && c.status === "published",
            ),
          ),
        ),
      },
      { id: "M5-05", state: suppliedState(commercial !== null) },
      { id: "M5-06", state: suppliedState(releaseReady) },
    ],
    modelGroups,
    corpus,
    modelExecution,
    modelObservations: summary.observations,
    users: {
      observedParticipants: executed.length,
      notRun: study.sessions.length - executed.length,
      cohorts,
      completedWithRequiredEvidence: completed.length,
      unassisted: unassisted.length,
      failed: executed.filter((s) => s.status === "failed").length,
      abandoned: executed.filter((s) => s.status === "abandoned").length,
      observedThresholdsMet: p.status === "frozen" ? userReady : null,
      comparableGroups: [...comparableGroups.values()],
    },
    nextActions: gaps,
    boundary:
      "Offline consistency and supplied-evidence inventory only. V1 scenarios and targetScale labels do not satisfy full-corpus coverage; V2 source extent/scale references are supplied human declarations, not independently verified full works. Model execution dates and exact protocol bindings are supplied declarations, not authenticated timestamps or proof of pre-registration; v1 records and absent execution evidence remain unknown. Proposed thresholds require prior human approval; freeze dates, model origin, participant identity/consent, original evidence bytes, bills, permissions, commercial changes and target-device releases are not independently verified. Neither a label nor all supplied gates closes M5. Novel/script tasks never require adaptation or video; unknown and failed observations remain visible.",
  };
}
