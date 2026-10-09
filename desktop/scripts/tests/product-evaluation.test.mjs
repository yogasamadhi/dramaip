import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compareEvaluationRecords,
  createTemplate,
  evidenceDigest,
  EvaluationValidationError,
  loadCatalog,
  summarizeCatalogSources,
  summarizeEvaluationRecord,
  validateCatalog,
  validateEvaluationRecord,
  verifyEvaluationEvidence,
} from "../product-evaluation.mjs";
import {
  checkProductStudy,
  createStudyTemplate,
  createUserSessionTemplate,
} from "../product-study.mjs";

const catalog = await loadCatalog();
const hash = evidenceDigest("actual-test-receipt");
const clone = (value) => structuredClone(value);

async function evidenceFixture(root) {
  const report = completedReport(),
    record = report.records[0],
    files = new Map();
  record.recordId = "PRIVATE_RECORD_CANARY";
  record.modelSnapshot.providerTag = "PRIVATE_PROVIDER_CANARY";
  const attachment = async (name) => {
    const bytes = Buffer.from(`PRIVATE_ATTACHMENT_${name}\0\u0001\u00ff`),
      digest = createHash("sha256").update(bytes).digest("hex");
    const path = join(root, `${digest}.receipt`);
    await writeFile(path, bytes);
    files.set(digest, { bytes, path });
    return digest;
  };
  record.candidateDigest = await attachment("candidate");
  record.modelSnapshot.configurationDigest = await attachment("configuration");
  record.execution = {
    startedAt: "2026-10-07T00:00:00.000Z",
    finishedAt: "2026-10-07T00:00:01.000Z",
    receiptDigest: await attachment("execution"),
    protocolDigest: await attachment("protocol"),
  };
  record.reportedUsage = {
    semantics: "reported-final",
    inputTokens: 0,
    outputTokens: null,
    receiptDigest: await attachment("usage"),
  };
  record.settledCost = {
    amount: "0",
    currency: "USD",
    receiptDigest: await attachment("settlement"),
  };
  record.humanReview = {
    reviewerTag: "PRIVATE_PERSON_CANARY",
    modelBlind: true,
    ratings: { authorIntent: 3, continuity: 3, narrativeQuality: 3 },
    checks: catalog.cases[0].checks.map((id) => ({ id, result: "unknown" })),
    evidenceDigest: await attachment("review"),
  };
  return { report, files };
}

test("M5附件核对读取真实原字节，绑定七种摘要但不认证来源、质量、结算或验收", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-evidence-bytes-"));
  try {
    const { report, files } = await evidenceFixture(root),
      original = JSON.stringify(report);
    const result = await verifyEvaluationEvidence(catalog, report, root);
    assert.equal(result.fileEvidence, "complete");
    assert.equal(result.referencedDigests, 7);
    assert.equal(result.matchedDigests, 7);
    assert.equal(result.declaredReferences, 7);
    assert.deepEqual(
      new Set(
        result.observations.flatMap((o) => o.references.map((r) => r.role)),
      ),
      new Set([
        "candidate",
        "model-configuration",
        "execution",
        "protocol",
        "usage",
        "settlement",
        "human-review",
      ]),
    );
    for (const item of result.observations) {
      assert.equal(item.state, "matched-at-read");
      assert.equal(item.observedDigest, item.digest);
      assert.equal(item.bytes, files.get(item.digest).bytes.length);
    }
    assert.equal(result.independentlyVerifiedExternalEvidence, false);
    assert.equal(result.qualityConclusion, "not-established");
    assert.equal(result.m5Completion, "not-established");
    assert.equal(result.releaseGate, "not-established");
    const { verificationDigest, ...value } = result;
    assert.equal(verificationDigest, evidenceDigest(value));
    assert.equal(JSON.stringify(report), original);
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    assert.ok(!JSON.stringify(result).includes(root));
    for (const { path, bytes } of files.values())
      assert.deepEqual(await readFile(path), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M5共用附件只读一次但保留所有声明角色，不升级独立运行／收费；旧v1不补执行记录", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-evidence-shared-"));
  try {
    const { report } = await evidenceFixture(root),
      r = report.records[0],
      hash = r.candidateDigest;
    r.modelSnapshot.configurationDigest = hash;
    r.execution.receiptDigest = hash;
    r.execution.protocolDigest = hash;
    r.reportedUsage.receiptDigest = hash;
    r.settledCost.receiptDigest = hash;
    r.humanReview.evidenceDigest = hash;
    const value = await verifyEvaluationEvidence(catalog, report, root);
    assert.equal(value.matchedDigests, 1);
    assert.equal(value.declaredReferences, 7);
    assert.equal(value.observations[0].references.length, 7);
    assert.equal(value.independentlyVerifiedExternalEvidence, false);
    report.schemaVersion = 1;
    for (const r of report.records) delete r.execution;
    const old = await verifyEvaluationEvidence(catalog, report, root);
    assert.equal(old.fileEvidence, "complete");
    assert.equal(old.declaredReferences, 5);
    assert.ok(
      old.observations[0].references.every(
        (r) => !["execution", "protocol"].includes(r.role),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M5无附件引用和缺文件不补为字节通过或真实模型完成", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-evidence-missing-"));
  try {
    const none = await verifyEvaluationEvidence(
      catalog,
      createTemplate(catalog),
      root,
    );
    assert.equal(none.fileEvidence, "none");
    assert.equal(none.referencedDigests, 0);
    const { report, files } = await evidenceFixture(root);
    const first = files.get(report.records[0].candidateDigest);
    await rm(first.path);
    const missing = await verifyEvaluationEvidence(catalog, report, root);
    assert.equal(missing.fileEvidence, "incomplete");
    assert.equal(missing.matchedDigests, 6);
    assert.equal(
      missing.observations.find(
        (o) => o.digest === report.records[0].candidateDigest,
      ).state,
      "missing",
    );
    assert.equal(missing.m5Completion, "not-established");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M5等长篡改如实失败，不把canonical JSON摘要静默转换成原文件字节摘要", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-evidence-mismatch-"));
  try {
    const { report, files } = await evidenceFixture(root),
      digest = report.records[0].candidateDigest,
      file = files.get(digest),
      changed = Buffer.from(file.bytes);
    changed[0] ^= 1;
    await writeFile(file.path, changed);
    const value = await verifyEvaluationEvidence(catalog, report, root),
      row = value.observations.find((o) => o.digest === digest);
    assert.equal(value.fileEvidence, "incomplete");
    assert.equal(row.state, "digest-mismatch");
    assert.equal(row.bytes, file.bytes.length);
    assert.notEqual(row.observedDigest, digest);
    const json = { a: 1, b: 2 },
      canonical = evidenceDigest(json);
    report.records[0].candidateDigest = canonical;
    await writeFile(
      join(root, `${canonical}.receipt`),
      JSON.stringify(json, null, 2) + "\n",
    );
    assert.equal(
      (await verifyEvaluationEvidence(catalog, report, root)).observations.find(
        (o) => o.digest === canonical,
      ).state,
      "digest-mismatch",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M5附件拒绝符号链接、目录与超限文件，不枚举无关文件或猜替代附件", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-evidence-unsafe-"));
  try {
    const { report, files } = await evidenceFixture(root),
      digest = report.records[0].candidateDigest,
      path = files.get(digest).path;
    const target = join(root, "PRIVATE_UNREFERENCED_FILE");
    await writeFile(target, files.get(digest).bytes);
    await rm(path);
    await symlink(target, path);
    assert.equal(
      (await verifyEvaluationEvidence(catalog, report, root)).observations.find(
        (o) => o.digest === digest,
      ).state,
      "unsafe-or-excessive-file",
    );
    await rm(path);
    await mkdir(path);
    assert.equal(
      (await verifyEvaluationEvidence(catalog, report, root)).observations.find(
        (o) => o.digest === digest,
      ).state,
      "unsafe-or-excessive-file",
    );
    await rm(path, { recursive: true });
    await writeFile(path, "");
    await truncate(path, 32 * 1024 * 1024 + 1);
    assert.equal(
      (await verifyEvaluationEvidence(catalog, report, root)).observations.find(
        (o) => o.digest === digest,
      ).state,
      "unsafe-or-excessive-file",
    );
    const alias = join(root, "directory-alias");
    await symlink(root, alias, "dir");
    await assert.rejects(
      verifyEvaluationEvidence(catalog, report, alias),
      (e) =>
        e instanceof EvaluationValidationError &&
        e.code === "invalid-evidence-directory",
    );
    await assert.rejects(
      verifyEvaluationEvidence(catalog, report, target),
      (e) =>
        e instanceof EvaluationValidationError &&
        e.code === "invalid-evidence-directory",
    );
    assert.deepEqual(await readFile(target), files.get(digest).bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M5实际verify-evidence CLI明确只读，不泄露附件／标签／路径，未齐备exit2，坏输入exit1", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "dramaip-PRIVATE_DIRECTORY_CANARY-"),
  );
  const script = fileURLToPath(
    new URL("../product-evaluation.mjs", import.meta.url),
  );
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 10_000,
    });
  try {
    const { report, files } = await evidenceFixture(root),
      path = join(root, "PRIVATE_REPORT.json");
    await writeFile(path, JSON.stringify(report));
    const original = await readFile(path),
      result = run("verify-evidence", path, root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).fileEvidence, "complete");
    assert.ok(!result.stdout.includes("PRIVATE"));
    assert.ok(!result.stdout.includes(root));
    assert.equal(result.stderr, "");
    assert.deepEqual(await readFile(path), original);
    await rm(files.get(report.records[0].candidateDigest).path);
    const missing = run("verify-evidence", path, root);
    assert.equal(missing.status, 2);
    assert.equal(JSON.parse(missing.stdout).fileEvidence, "incomplete");
    await writeFile(path, JSON.stringify(createTemplate(catalog)));
    assert.equal(run("verify-evidence", path, root).status, 2);
    await writeFile(path, '{"credential":"PRIVATE_CANARY_SECRET"}');
    const bad = run("verify-evidence", path, root);
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, "");
    assert.ok(!bad.stderr.includes("PRIVATE"));
    assert.ok(!bad.stderr.includes(root));
    assert.equal(run("verify-evidence").status, 1);
    assert.equal(run("verify-evidence", path, root, "extra").status, 1);
    assert.match(run("--help").stdout, /verify-evidence/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function corpusFixture() {
  const value = clone(catalog);
  value.schemaVersion = 2;
  value.status = "internal-corpus";
  value.sourcePolicy = "PRIVATE_POLICY synthetic inert unit-test fixture only";
  const complete = new Map([
    [1, ["long", "测".repeat(100_000) + "终"]],
    [2, ["medium", "中".repeat(20_000) + "终"]],
    [3, ["short", "短篇结构测试，不是真实稿件。"]],
  ]);
  for (const [i, item] of value.cases.entries()) {
    const supplied = complete.get(i);
    if (supplied) {
      item.source = supplied[1];
      item.sourceScope =
        "synthetic inert test fixture; not an actual full work";
    }
    item.sourceCorpus = {
      extent: supplied ? "complete-work" : "scenario",
      sourceScale: supplied ? supplied[0] : "not-established",
      characters: Array.from(item.source).length,
      contentDigest: createHash("sha256")
        .update(item.source, "utf8")
        .digest("hex"),
      classificationDigest: supplied ? hash : null,
      units: [{ id: "unit-1", startOffset: 0, endOffset: item.source.length }],
    };
  }
  return validateCatalog(value);
}

test("新版语料冻结实际内容与全篇声明，允许超过旧片段上限但不覆盖旧套件", () => {
  const original = JSON.stringify(catalog);
  const value = corpusFixture();
  assert(value.cases[1].source.length > 20_000);
  assert.notEqual(evidenceDigest(value), evidenceDigest(catalog));
  const summary = summarizeCatalogSources(value);
  assert(summary.fullCorpusDeclarationsSupplied);
  assert.equal(summary.sourceExtentAndScaleIndependentlyVerified, false);
  assert.equal(summary.cases[1].actualCharacters, 100_001);
  assert.equal(summary.cases[2].actualCharacters, 20_001);
  assert.deepEqual(summary.suppliedCompleteScales, ["short", "medium", "long"]);
  assert.throws(
    () => validateEvaluationRecord(value, createTemplate(catalog)),
    /stale-suite/,
  );
  assert.throws(
    () => validateEvaluationRecord(catalog, createTemplate(value)),
    /stale-suite/,
  );
  assert.equal(JSON.stringify(catalog), original);
});

test("新版源字数／摘要／人工规模分类引用严格核对，不能只换目标标签", () => {
  for (const mutate of [
    (v) => v.cases[1].sourceCorpus.characters++,
    (v) => (v.cases[1].source += "漂移"),
    (v) => (v.cases[1].sourceCorpus.contentDigest = hash),
    (v) => (v.cases[1].sourceCorpus.classificationDigest = null),
    (v) => (v.cases[1].sourceCorpus.privateText = "PRIVATE_CANARY"),
    (v) => (v.cases[1].source = "\ud800"),
  ]) {
    const v = corpusFixture();
    mutate(v);
    assert.throws(() => validateCatalog(v), /invalid-corpus/);
  }
  const unknown = corpusFixture();
  unknown.cases[1].sourceCorpus.sourceScale = "not-established";
  unknown.cases[1].sourceCorpus.classificationDigest = null;
  assert.deepEqual(summarizeCatalogSources(unknown).missingFullCorpusScales, [
    "long",
  ]);
  unknown.cases[1].targetScale = "long";
  assert.equal(
    summarizeCatalogSources(unknown).fullCorpusDeclarationsSupplied,
    false,
  );
});

test("全篇单元必须顺序无漏覆盖实际正文，拒绝重叠／缺尾／重复与切开Unicode字符", () => {
  for (const mutate of [
    (v) => (v.cases[1].sourceCorpus.units[0].startOffset = 1),
    (v) => v.cases[1].sourceCorpus.units[0].endOffset--,
    (v) =>
      v.cases[1].sourceCorpus.units.push({
        id: "unit-2",
        startOffset: 3,
        endOffset: 4,
      }),
    (v) =>
      (v.cases[1].sourceCorpus.units = [
        { id: "same", startOffset: 0, endOffset: 1 },
        { id: "same", startOffset: 1, endOffset: v.cases[1].source.length },
      ]),
  ]) {
    const v = corpusFixture();
    mutate(v);
    assert.throws(() => validateCatalog(v), /corpus-units/);
  }
  const emoji = corpusFixture();
  const item = emoji.cases[3];
  item.source = "甲😀乙";
  item.sourceCorpus.characters = 3;
  item.sourceCorpus.contentDigest = createHash("sha256")
    .update(item.source)
    .digest("hex");
  item.sourceCorpus.units = [
    { id: "unit-1", startOffset: 0, endOffset: 3 },
    { id: "unit-2", startOffset: 3, endOffset: 4 },
  ];
  assert.equal(validateCatalog(emoji), emoji);
  item.sourceCorpus.units[0].endOffset = 2;
  item.sourceCorpus.units[1].startOffset = 2;
  assert.throws(() => validateCatalog(emoji), /invalid-corpus-units/);
});

test("同一源不能用不同规模声明重复计入，选中片段不升级为全篇", () => {
  const v = corpusFixture();
  v.cases[2].source = v.cases[1].source;
  v.cases[2].sourceCorpus = clone(v.cases[1].sourceCorpus);
  v.cases[2].sourceCorpus.sourceScale = "medium";
  assert.throws(() => validateCatalog(v), /inconsistent-corpus-scale/);
  const excerpts = corpusFixture();
  excerpts.cases[1].sourceCorpus.extent = "selected-excerpts";
  excerpts.cases[1].sourceCorpus.units[0].startOffset = 1;
  assert.deepEqual(summarizeCatalogSources(excerpts).missingFullCorpusScales, [
    "long",
  ]);
});

test("新套件供给语料与评测齐备仍不认证真实全篇／模型／M5；缺全篇只撤回就绪不丢观察", () => {
  const value = corpusFixture();
  let result = checkProductStudy(value, observedStudy(value));
  assert.equal(result.gates[0].state, "supplied-evidence-complete");
  assert.equal(result.corpus.sourceExtentAndScaleIndependentlyVerified, false);
  assert.equal(result.m5Completion, "not-established");
  assert.equal(result.qualityConclusion, "not-established");
  assert.equal(result.independentlyVerifiedExternalEvidence, false);
  value.cases[3].sourceCorpus.extent = "scenario";
  value.cases[3].sourceCorpus.sourceScale = "not-established";
  value.cases[3].sourceCorpus.classificationDigest = null;
  assert.equal(
    checkProductStudy(value, observedStudy(value)).gates[0].state,
    "supplied-evidence-complete",
  );
  value.cases[1].sourceCorpus.extent = "selected-excerpts";
  result = checkProductStudy(value, observedStudy(value));
  assert.equal(result.gates[0].state, "incomplete");
  assert(result.nextActions.includes("FULL_SOURCE_CORPUS_INCOMPLETE"));
  assert(result.modelGroups.every((g) => g.suppliedEvidenceComplete));
  assert.equal(
    result.modelObservations.reduce(
      (n, g) => n + g.coverage.reduce((count, c) => count + c.completed, 0),
      0,
    ),
    10,
  );
});

test("新语料协议摘要冻结原suite，不能把旧协议或同源未知声明补为确认", () => {
  const value = corpusFixture();
  const study = observedStudy(value);
  const result = checkProductStudy(value, study);
  assert.notEqual(result.protocolDigest, evidenceDigest(study.protocol));
  for (const record of study.evaluation.records)
    record.execution.protocolDigest = evidenceDigest(study.protocol);
  const unbound = checkProductStudy(value, study);
  assert.equal(unbound.gates[0].state, "incomplete");
  assert(unbound.nextActions.includes("MODEL_EXECUTION_PROTOCOL_MISMATCH"));
  const unknown = value.cases[4];
  unknown.source = value.cases[1].source;
  unknown.sourceCorpus = clone(value.cases[1].sourceCorpus);
  unknown.sourceCorpus.extent = "scenario";
  unknown.sourceCorpus.sourceScale = "not-established";
  unknown.sourceCorpus.classificationDigest = null;
  validateCatalog(value);
  const sourceSummary = summarizeCatalogSources(value);
  assert.equal(sourceSummary.cases[4].sourceScale, "not-established");
  assert.equal(sourceSummary.cases[4].classificationReferenceSupplied, false);
  assert.notEqual(
    checkProductStudy(value, observedStudy(value)).protocolDigest,
    result.protocolDigest,
  );
});

test("实际CLI读取独立新版套件贯通模板／评议／比较／研究，不写文件或泄露源内容", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-corpus-cli-"));
  const script = fileURLToPath(
    new URL("../product-evaluation.mjs", import.meta.url),
  );
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 10_000,
    });
  try {
    const value = corpusFixture();
    value.cases[0].task = "PRIVATE_TASK_CANARY";
    value.cases[0].authorIntent = "PRIVATE_INTENT_CANARY";
    const sourcePath = join(root, "catalog.json");
    const studyPath = join(root, "study.json");
    const beforePath = join(root, "before.json");
    const afterPath = join(root, "after.json");
    const study = observedStudy(value);
    await writeFile(sourcePath, JSON.stringify(value));
    await writeFile(studyPath, JSON.stringify(study));
    await writeFile(beforePath, JSON.stringify(study.evaluation));
    await writeFile(afterPath, JSON.stringify(study.evaluation));
    const files = [sourcePath, studyPath, beforePath, afterPath];
    const originals = await Promise.all(files.map((f) => readFile(f)));
    for (const args of [
      ["catalog"],
      ["template"],
      ["study-template"],
      ["validate", beforePath],
      ["summarize", beforePath],
      ["compare", beforePath, afterPath],
      ["study-check", studyPath],
    ]) {
      const r = run("--catalog", sourcePath, ...args);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotThrow(() => JSON.parse(r.stdout));
      assert(!r.stdout.includes("PRIVATE_"));
      assert(!r.stdout.includes(root));
      assert(!r.stdout.includes("测测测"));
    }
    assert.equal(
      JSON.parse(run("--catalog", sourcePath, "catalog").stdout).corpus
        .fullCorpusDeclarationsSupplied,
      true,
    );
    assert.equal(run("validate", beforePath).status, 1);
    const legacyPath = join(root, "legacy.json");
    await writeFile(legacyPath, JSON.stringify(catalog));
    assert.equal(run("--catalog", legacyPath, "catalog").status, 1);
    for (const args of [
      ["--catalog"],
      ["--catalog", sourcePath],
      ["--catalog", "--help", "catalog"],
      ["catalog", "--catalog", sourcePath],
      ["--catalog", sourcePath, "template", "extra"],
    ]) {
      const r = run(...args);
      assert.equal(r.status, 1);
      assert.equal(r.stdout, "");
      assert(!r.stderr.includes(root));
      assert(!r.stderr.includes("PRIVATE_"));
    }
    assert.deepEqual(
      await Promise.all(files.map((f) => readFile(f))),
      originals,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("大语料独立上限16MiB不扩大记录上限，超限和坏JSON只报脱敏错误", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-corpus-size-"));
  const script = fileURLToPath(
    new URL("../product-evaluation.mjs", import.meta.url),
  );
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 10_000,
    });
  try {
    const value = corpusFixture();
    const item = value.cases[1];
    item.source = "测".repeat(500_000);
    item.sourceCorpus.characters = 500_000;
    item.sourceCorpus.contentDigest = createHash("sha256")
      .update(item.source)
      .digest("hex");
    item.sourceCorpus.units[0].endOffset = item.source.length;
    const path = join(root, "large.json");
    const bytes = Buffer.from(JSON.stringify(value));
    assert(bytes.length > 1_048_576);
    await writeFile(path, bytes);
    assert.equal(run("--catalog", path, "catalog").status, 0);
    assert.equal(run("validate", path).status, 1);
    await writeFile(path, Buffer.alloc(16_777_217, 32));
    let rejected = run("--catalog", path, "catalog");
    assert.equal(rejected.status, 1);
    assert(rejected.stderr.includes("invalid-file"));
    await writeFile(path, "PRIVATE_BAD_JSON");
    rejected = run("--catalog", path, "catalog");
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, "");
    assert(!rejected.stderr.includes("PRIVATE_"));
    assert(!rejected.stderr.includes(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function comparisonPair() {
  const before = observedStudy().evaluation;
  const after = clone(before);
  for (const [side, report] of [
    ["before", before],
    ["after", after],
  ])
    for (const r of report.records) {
      r.candidateDigest = evidenceDigest(`${side}-candidate-${r.caseId}`);
      r.revisionCount = side === "before" ? 2 : 1;
      r.elapsedMs = side === "before" ? 100 : 80;
      r.execution.receiptDigest = evidenceDigest(`${side}-run-${r.caseId}`);
      if (side === "after") {
        r.execution.startedAt = "2026-10-07T00:05:00.000Z";
        r.execution.finishedAt = "2026-10-07T00:06:00.000Z";
        r.humanReview.ratings = {
          authorIntent: 4,
          continuity: 4,
          narrativeQuality: 4,
        };
      }
      r.settledCost = {
        amount: side === "before" ? "0.30000001" : "0.10000002",
        currency: "CNY",
        receiptDigest: evidenceDigest(`${side}-charge-${r.caseId}`),
      };
    }
  return [before, after];
}

test("离线评测回归接入原正常测试链，保留原类型／Main／App／Runtime／conformance且不用Bun运行Node测试", async () => {
  const { scripts } = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(scripts.test, "bun run typecheck && bun run test:unit");
  assert.equal(
    scripts["test:product-evaluation"],
    "bun scripts/run-node.mjs --test scripts/tests/product-evaluation.test.mjs",
  );
  assert.equal(
    scripts["test:unit"],
    "bun run test:product-evaluation && bun run test:release-candidate && bun run test:release-metadata && bun run test:nle-copy && bun test --cwd apps/desktop/electron && bun test --cwd packages/app && bun run test:runtime && bun run test:conformance",
  );
  assert.equal(
    scripts["test:nle-copy"],
    "bun scripts/run-node.mjs --import tsx --test apps/desktop/electron/host/nle-copy.integration.ts apps/desktop/electron/host/nle-copy-supervisor.integration.ts",
  );
  for (const name of ["format", "format:check"])
    for (const path of [
      "scripts/product-evaluation.mjs",
      "scripts/product-study.mjs",
      "scripts/tests/product-evaluation.test.mjs",
    ])
      assert.ok(scripts[name].split(" ").includes(path));
});

function observedStudy(sourceCatalog = catalog) {
  const study = createStudyTemplate(sourceCatalog);
  study.protocol.status = "frozen";
  study.protocol.frozenAt = "2026-10-07T00:00:00.000Z";
  study.protocol.approvalDigest = hash;
  const protocolDigest = checkProductStudy(sourceCatalog, study).protocolDigest;
  for (const r of study.evaluation.records) {
    Object.assign(r, {
      evidenceKind: "real-model",
      status: "completed",
      modelSnapshot: completedReport().records[0].modelSnapshot,
      execution: {
        startedAt: "2026-10-07T00:00:30.000Z",
        finishedAt: "2026-10-07T00:00:40.000Z",
        receiptDigest: hash,
        protocolDigest,
      },
      elapsedMs: 100,
      candidateDigest: evidenceDigest(r.recordId),
      adopted: true,
      revisionCount: 0,
      reportedUsage: {
        semantics: "reported-final",
        inputTokens: 0,
        outputTokens: 0,
        receiptDigest: hash,
      },
      settledCost: { amount: "0", currency: "CNY", receiptDigest: hash },
      humanReview: {
        reviewerTag: "reviewer-test",
        modelBlind: true,
        ratings: { authorIntent: 3, continuity: 3, narrativeQuality: 3 },
        checks: sourceCatalog.cases
          .find((c) => c.id === r.caseId)
          .checks.map((id) => ({ id, result: "pass" })),
        evidenceDigest: hash,
      },
    });
  }
  study.sessions = [
    "author",
    "author",
    "screenwriter",
    "screenwriter",
    "studio",
    "studio",
  ].map((role, i) => {
    const s = createUserSessionTemplate(
      role === "author" ? "novel" : "adaptation",
    );
    Object.assign(s, {
      participantTag: `test-user-${i}`,
      role,
      consentDigest: hash,
      deviceDigest: hash,
      buildDigest: hash,
      modelSnapshotDigest: hash,
      conditionsDigest: hash,
      status: "completed",
      startedAt: "2026-10-07T00:01:00.000Z",
      firstCandidateAt: "2026-10-07T00:02:00.000Z",
      firstDecisionAt: "2026-10-07T00:03:00.000Z",
      finishedAt: "2026-10-07T00:04:00.000Z",
      helpCount: 0,
      revisionCount: 0,
      continuityFailures: 0,
      sourceChange: "pass",
      restartRecovery: "pass",
      finalArtifactDigest: hash,
      observationDigest: hash,
      tasks: s.tasks.map((t) => ({
        ...t,
        result: "pass",
        evidenceDigest: hash,
      })),
    });
    return s;
  });
  return study;
}

test("M5研究模板未运行、阈值仅建议；小说／改编／直写各有独立终点且不强制媒体", () => {
  const study = createStudyTemplate(catalog);
  const result = checkProductStudy(catalog, study);
  assert.equal(result.protocolStatus, "draft");
  assert.equal(result.users.observedParticipants, 0);
  assert.equal(result.users.observedThresholdsMet, null);
  assert.equal(result.gates.length, 6);
  assert(result.gates.every((g) => g.state === "incomplete"));
  assert.equal(result.nextActions.length, 8);
  assert(result.nextActions.includes("FULL_SOURCE_CORPUS_INCOMPLETE"));
  for (const path of ["novel", "adaptation", "script"]) {
    const s = createUserSessionTemplate(path);
    assert.equal(s.status, "not-run");
    assert(
      s.tasks.every((t) => t.result === "not-run" && t.evidenceDigest === null),
    );
    assert(!s.tasks.some((t) => t.id === "video"));
    if (path === "novel") assert(!s.tasks.some((t) => t.id === "diagnosis"));
    if (path === "script")
      assert(
        !s.tasks.some((t) => t.id === "chapter-one" || t.id === "diagnosis"),
      );
    study.sessions = [s];
    assert.equal(checkProductStudy(catalog, study).users.notRun, 1);
  }
});

test("调优比较按同源样例／固定前后模型分组，真实标签也不自动决定质量或保留方案", () => {
  const [before, after] = comparisonPair();
  before.records[0].adopted = false;
  before.records[0].humanReview.checks[0].result = "fail";
  const originals = JSON.stringify([before, after]);
  const r = compareEvaluationRecords(catalog, before, after);
  assert.equal(r.pairedCases, 10);
  assert.equal(r.excludedCases, 0);
  assert.equal(r.cohorts.length, 2);
  const g = r.cohorts.find(
    (g) => g.workflowPath === catalog.cases[0].workflowPath,
  );
  assert.equal(g.adoption.gained, 1);
  assert.deepEqual(g.adoption.rateDelta, { numerator: 1, denominator: 5 });
  assert.equal(g.revisions.lower, 5);
  assert.deepEqual(g.revisions.beforeMean, { numerator: "10", denominator: 5 });
  assert.deepEqual(g.revisions.afterMean, { numerator: "5", denominator: 5 });
  assert.equal(g.declaredElapsedMs.lower, 5);
  assert.equal(g.humanRatings.continuity.higher, 5);
  assert.equal(
    g.checks.find(
      (c) => c.checkId === before.records[0].humanReview.checks[0].id,
    ).resolvedFailures,
    1,
  );
  assert(r.pairs.every((p) => p.cost.deltaAmount === "-0.19999999"));
  assert(
    r.cohorts.every(
      (g) =>
        g.declaredExecution.sameProtocol === 5 &&
        g.declaredExecution.ordered === 5,
    ),
  );
  assert.equal(r.tuningDecision, "not-made");
  assert.equal(r.independentlyVerifiedExternalEvidence, false);
  for (const key of ["qualityConclusion", "releaseGate", "m5Completion"])
    assert.equal(r[key], "not-established");
  const { comparisonDigest, ...body } = r;
  assert.equal(comparisonDigest, evidenceDigest(body));
  assert.equal(r.baselineDigest, evidenceDigest(before));
  assert.equal(r.resultDigest, evidenceDigest(after));
  assert.equal(JSON.stringify([before, after]), originals);
});

test("调优比较不挑最佳候选或拼缺样例，缺失／失败／未运行／多记录保留原覆盖", () => {
  const [before, after] = comparisonPair();
  after.records.shift();
  Object.assign(after.records[0], {
    status: "failed",
    candidateDigest: null,
    adopted: null,
    revisionCount: null,
    humanReview: null,
  });
  after.records[1] = createTemplate(catalog).records[2];
  after.records.push({
    ...clone(after.records[2]),
    recordId: "another-attempt",
    candidateDigest: evidenceDigest("another-candidate"),
  });
  const r = compareEvaluationRecords(catalog, before, after);
  assert.equal(r.pairedCases, 6);
  assert.equal(r.excludedCases, 4);
  assert.deepEqual(
    r.exclusions.map((e) => e.reasons[0]),
    ["after-missing", "after-failed", "after-not-run", "after-ambiguous"],
  );
  assert.equal(r.exclusions[1].after.failed, 1);
  assert.equal(r.exclusions[2].after.notRun, 1);
  assert.equal(r.exclusions[3].after.records, 2);
  assert.equal(
    r.cohorts.reduce((n, g) => n + g.adoption.observedPairs, 0),
    6,
  );
});

test("新执行的相同输出保留零变化，跨样例复用或缺独立执行不造新观察", () => {
  const [original, rerun] = comparisonPair();
  rerun.records[0].candidateDigest = original.records[0].candidateDigest;
  const unchanged = compareEvaluationRecords(catalog, original, rerun);
  assert.equal(unchanged.pairedCases, 10);
  assert.equal(unchanged.excludedCases, 0);
  assert.equal(unchanged.pairs[0].candidateUnchanged, true);
  assert.equal(
    unchanged.cohorts.find(
      (g) => g.workflowPath === catalog.cases[0].workflowPath,
    ).adoption.observedPairs,
    5,
  );
  for (const duplicateAcrossCases of [false, true]) {
    const [before, after] = comparisonPair();
    if (duplicateAcrossCases)
      before.records[1].candidateDigest = before.records[0].candidateDigest;
    else {
      after.records[0].candidateDigest = before.records[0].candidateDigest;
      after.records[0].execution.receiptDigest =
        before.records[0].execution.receiptDigest;
    }
    const r = compareEvaluationRecords(catalog, before, after);
    assert.equal(r.excludedCases, duplicateAcrossCases ? 2 : 1);
    assert(
      r.exclusions.every((e) =>
        e.reasons.includes(
          duplicateAcrossCases
            ? "candidate-reused-across-cases"
            : "unchanged-candidate-without-distinct-ordered-executions",
        ),
      ),
    );
  }
});

test("待决定／未知修订／未知检查不当作零或失败，不缩分母制造全体改善", () => {
  const [before, after] = comparisonPair();
  after.records[0].adopted = null;
  after.records[0].revisionCount = null;
  after.records[0].humanReview.checks[0].result = "unknown";
  const r = compareEvaluationRecords(catalog, before, after);
  const g = r.cohorts.find(
    (g) => g.workflowPath === catalog.cases[0].workflowPath,
  );
  assert.equal(g.pairedCases, 5);
  assert.equal(g.adoption.observedPairs, 4);
  assert.equal(g.adoption.unknownPairs, 1);
  assert.deepEqual(g.adoption.rateDelta, { numerator: 0, denominator: 4 });
  assert.equal(g.revisions.observedPairs, 4);
  assert.equal(g.revisions.unknownPairs, 1);
  const check = g.checks.find(
    (c) => c.checkId === before.records[0].humanReview.checks[0].id,
  );
  assert.equal(check.unknownOrUnreviewedPairs, 1);
  assert.equal(check.introducedFailures, 0);
});

test("调优前后来源／模型配置分别列组，受控记录不升级真实模型或与别组拼比例", () => {
  const [before, after] = comparisonPair();
  before.records[0].evidenceKind = "controlled-engine";
  before.records[0].settledCost = null;
  after.records[1].modelSnapshot.configurationDigest = evidenceDigest(
    "changed-request-budget",
  );
  const r = compareEvaluationRecords(catalog, before, after);
  assert.equal(r.cohorts.length, 4);
  const controlled = r.cohorts.find(
    (g) => g.beforeEvidenceKind === "controlled-engine",
  );
  assert.equal(controlled.pairedCases, 1);
  assert.equal(controlled.afterEvidenceKind, "real-model");
  const changed = r.cohorts.find(
    (g) =>
      g.afterModelSnapshotDigest ===
      evidenceDigest(after.records[1].modelSnapshot),
  );
  assert.equal(changed.pairedCases, 1);
  assert.equal(r.independentlyVerifiedExternalEvidence, false);
});

test("人评缺失或更换评议者不直接算等级／连续性变化，旧v1时间保持未知", () => {
  const [before, after] = comparisonPair();
  after.records[0].humanReview.reviewerTag = "another-reviewer";
  const samePath = catalog.cases.findIndex(
    (c, i) => i > 0 && c.workflowPath === catalog.cases[0].workflowPath,
  );
  after.records[samePath].humanReview = null;
  after.schemaVersion = 1;
  for (const r of after.records) delete r.execution;
  const r = compareEvaluationRecords(catalog, before, after);
  const g = r.cohorts.find(
    (g) => g.workflowPath === catalog.cases[0].workflowPath,
  );
  assert.equal(g.humanRatings.continuity.observedPairs, 3);
  assert.equal(g.humanRatings.continuity.unknownOrChangedReviewerPairs, 2);
  assert.equal(g.declaredExecution.unknownProtocol, 5);
  assert.equal(g.declaredExecution.unknownTimes, 5);
  assert.equal(g.declaredExecution.unknownReferences, 5);
  assert(
    r.pairs.every(
      (p) => p.sameProtocol === null && p.executionOrdered === null,
    ),
  );
});

test("标准改变／时间倒序或重叠／共用执行回执显式保留，不签发可比实验或调优通过", () => {
  const [before, after] = comparisonPair();
  after.records[0].execution.protocolDigest =
    evidenceDigest("different-protocol");
  after.records[1].execution.startedAt = "2026-10-07T00:00:10.000Z";
  after.records[1].execution.finishedAt = "2026-10-07T00:00:20.000Z";
  after.records[2].execution.receiptDigest =
    before.records[2].execution.receiptDigest;
  const r = compareEvaluationRecords(catalog, before, after);
  assert.equal(r.pairs[0].sameProtocol, false);
  assert.equal(r.pairs[1].executionOrdered, false);
  assert.equal(r.pairs[2].distinctExecutionReferences, false);
  assert.equal(r.tuningDecision, "not-made");
  assert.match(r.boundary, /never causal proof/);
});

test("成本只比较同币种独立声明回执，跨币种／共用账单／缺账单不造节省或总额", () => {
  const [before, after] = comparisonPair();
  after.records[0].settledCost.currency = "USD";
  after.records[1].settledCost.receiptDigest =
    before.records[2].settledCost.receiptDigest;
  after.records[3].settledCost = null;
  const r = compareEvaluationRecords(catalog, before, after);
  assert.equal(r.pairs[0].cost, null);
  assert.deepEqual(r.pairs[0].costIncomparability, ["currency-changed"]);
  assert(
    r.pairs[1].costIncomparability.includes("shared-settlement-reference"),
  );
  assert(
    r.pairs[2].costIncomparability.includes("shared-settlement-reference"),
  );
  assert.deepEqual(r.pairs[3].costIncomparability, ["settlement-missing"]);
  assert.equal(
    r.cohorts.reduce((n, g) => n + g.cost.observedPairs, 0),
    6,
  );
  assert(
    r.cohorts.every(
      (g) => g.cost.totalCost === null && g.cost.estimatedSavings === null,
    ),
  );
});

test("成本差值精确到八位小数，真实零单列；双方陈旧输入／隐私字段仍严格拒绝", () => {
  const [before, after] = comparisonPair();
  before.records[0].settledCost.amount = "999999999999999.99999999";
  after.records[0].settledCost.amount = "0.00000001";
  before.records[1].settledCost.amount = "0";
  after.records[1].settledCost.amount = "0.00000000";
  const r = compareEvaluationRecords(catalog, before, after);
  assert.equal(r.pairs[0].cost.deltaAmount, "-999999999999999.99999998");
  assert.equal(r.pairs[1].cost.deltaAmount, "0");
  for (const target of [before, after]) {
    const bad = clone(target);
    bad.records[0].inputDigest = evidenceDigest("changed-input");
    assert.throws(
      () => compareEvaluationRecords(catalog, bad, after),
      /stale-input/,
    );
    assert.throws(
      () => compareEvaluationRecords(catalog, before, bad),
      /stale-input/,
    );
    bad.records[0].path = "PRIVATE_PATH_CANARY";
    assert.throws(
      () => compareEvaluationRecords(catalog, before, bad),
      /invalid-record/,
    );
  }
});

test("真实compare CLI只读两份限定本地记录，隐去模型／人评／回执标签且错误不回显路径", async () => {
  const root = await mkdtemp(join(tmpdir(), "dramaip-paired-evaluation-"));
  try {
    const [before, after] = comparisonPair();
    for (const report of [before, after]) {
      report.records[0].modelSnapshot.modelId = "PRIVATE_MODEL_CANARY";
      report.records[0].humanReview.reviewerTag = "PRIVATE_REVIEWER_CANARY";
    }
    const paths = [join(root, "baseline.json"), join(root, "result.json")];
    const bytes = [JSON.stringify(before), JSON.stringify(after)];
    await Promise.all(paths.map((path, i) => writeFile(path, bytes[i])));
    const cli = (...args) =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("../product-evaluation.mjs", import.meta.url)),
          ...args,
        ],
        {
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1_048_576,
          windowsHide: true,
        },
      );
    const actual = cli("compare", ...paths);
    assert.equal(actual.status, 0, actual.stderr);
    assert.equal(JSON.parse(actual.stdout).pairedCases, 10);
    assert(!actual.stdout.includes("PRIVATE_"));
    assert.deepEqual(
      await Promise.all(paths.map((path) => readFile(path, "utf8"))),
      bytes,
    );
    for (const args of [
      ["compare", paths[0]],
      ["compare", ...paths, "PRIVATE_ARGUMENT_CANARY"],
      ["compare", paths[0], join(root, "PRIVATE_MISSING_CANARY")],
    ]) {
      const invalid = cli(...args);
      assert.equal(invalid.status, 1);
      assert.equal(invalid.stdout, "");
      assert(!invalid.stderr.includes(root));
      assert(!invalid.stderr.includes("PRIVATE_"));
    }
    assert(cli("--help").stdout.includes("compare <baseline-record.json>"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M5原情境记录齐备仍缺完整语料，保留观察但不签发质量或发布", () => {
  const result = checkProductStudy(catalog, observedStudy());
  assert(
    result.modelGroups.every(
      (g) => g.suppliedEvidenceComplete && g.observedThresholdsMet,
    ),
  );
  assert.equal(result.gates[0].state, "incomplete");
  assert(result.nextActions.includes("FULL_SOURCE_CORPUS_INCOMPLETE"));
  assert.deepEqual(result.corpus.missingFullCorpusScales, ["medium", "long"]);
  assert.equal(result.gates[1].state, "supplied-evidence-complete");
  assert.equal(result.users.unassisted, 6);
  assert.equal(result.users.comparableGroups.length, 2);
  assert.equal(
    result.modelObservations.filter((g) => g.evidenceKind === "real-model")
      .length,
    2,
  );
  assert(
    result.users.comparableGroups.every((g) =>
      g.revisionCounts.every((n) => n === 0),
    ),
  );
  assert.equal(result.preRegistrationIndependentlyVerified, false);
  assert.equal(result.independentlyVerifiedExternalEvidence, false);
  for (const key of ["m5Completion", "releaseGate", "qualityConclusion"])
    assert.equal(result[key], "not-established");
});

test("M5声明协议晚于实际用户开始时间不补为预注册，原观察仍保留", () => {
  const s = observedStudy();
  s.protocol.frozenAt = "2026-10-07T00:02:00.000Z";
  const r = checkProductStudy(catalog, s);
  assert.equal(r.users.observedParticipants, 6);
  assert.equal(r.protocolBeforeObservedSessions, false);
  assert.equal(r.gates[1].state, "incomplete");
  assert(r.nextActions.includes("PROTOCOL_POSTDATES_OBSERVED_SESSION"));
});

test("M5模型起止与原协议绑定供给齐备仍不认证真实来源或预注册", () => {
  const s = observedStudy();
  const before = JSON.stringify(s);
  const r = checkProductStudy(catalog, s);
  assert.deepEqual(r.modelExecution, {
    observedRuns: 10,
    suppliedExecutionTimes: 10,
    suppliedProtocolBindings: 10,
    protocolBeforeObservedRuns: true,
    executionProtocolBindingsMatch: true,
  });
  assert.equal(r.preRegistrationIndependentlyVerified, false);
  assert.equal(r.qualityConclusion, "not-established");
  assert.equal(JSON.stringify(s), before);
});

test("M5模型早于阈值确认不能借更晚用户开始放行，原结果与人工观察保留", () => {
  const s = observedStudy();
  s.protocol.frozenAt = "2026-10-07T00:00:35.000Z";
  for (const record of s.evaluation.records)
    record.execution.protocolDigest = evidenceDigest(s.protocol);
  const r = checkProductStudy(catalog, s);
  assert.equal(r.protocolBeforeObservedSessions, true);
  assert.equal(r.modelExecution.protocolBeforeObservedRuns, false);
  assert.equal(r.modelExecution.executionProtocolBindingsMatch, true);
  assert.equal(r.gates[0].state, "incomplete");
  assert(r.modelGroups.every((g) => g.observedThresholdsMet));
  assert(r.nextActions.includes("PROTOCOL_POSTDATES_OBSERVED_MODEL_RUN"));
});

test("M5旧记录／缺时间或协议摘要保持未知；改阈值不重绑原运行", () => {
  for (const change of [
    (s) => {
      s.evaluation.records[0].execution = null;
    },
    (s) => {
      s.evaluation.records[0].execution.protocolDigest = null;
    },
    (s) => {
      s.evaluation.schemaVersion = 1;
      for (const r of s.evaluation.records) delete r.execution;
    },
  ]) {
    const s = observedStudy();
    change(s);
    const r = checkProductStudy(catalog, s);
    assert.equal(r.gates[0].state, "incomplete");
    assert(r.nextActions.includes("MODEL_EXECUTION_EVIDENCE_MISSING"));
    assert.equal(r.modelExecution.executionProtocolBindingsMatch, null);
  }
  const s = observedStudy();
  s.protocol.thresholds.adoptionMinimum.numerator = 8;
  const r = checkProductStudy(catalog, s);
  assert.equal(r.modelExecution.protocolBeforeObservedRuns, true);
  assert.equal(r.modelExecution.executionProtocolBindingsMatch, false);
  assert.equal(r.gates[0].state, "incomplete");
  assert(r.modelGroups.every((g) => g.observedThresholdsMet));
  assert(r.nextActions.includes("MODEL_EXECUTION_PROTOCOL_MISMATCH"));
});

test("评测v2执行字段严格白名单／原时间顺序，v1不自动升级且未执行不造起止", () => {
  const s = observedStudy();
  assert.equal(s.evaluation.schemaVersion, 2);
  assert(createTemplate(catalog).records.every((r) => r.execution === null));
  for (const change of [
    (r) => {
      r.execution.startedAt = "2026-02-30T00:00:00.000Z";
    },
    (r) => {
      r.execution.finishedAt = "2026-10-07T00:00:20.000Z";
    },
    (r) => {
      r.execution.receiptDigest = null;
    },
    (r) => {
      r.execution.path = "PRIVATE_PATH_CANARY";
    },
  ]) {
    const report = clone(s.evaluation);
    change(report.records[0]);
    rejected(report, "invalid-execution-evidence");
  }
  const unrun = createTemplate(catalog);
  unrun.records[0].execution = clone(s.evaluation.records[0].execution);
  rejected(unrun, "unrun-evidence");
  const legacy = clone(s.evaluation);
  legacy.schemaVersion = 1;
  rejected(legacy);
  for (const r of legacy.records) delete r.execution;
  const result = validateEvaluationRecord(catalog, legacy);
  assert.equal(result.inputSchemaVersion, 1);
  assert.equal(result.qualityConclusion, "not-established");
});

test("M5不混受控模型、不同配置或重复候选，未审阅／未知用量账单不补成通过", () => {
  for (const change of [
    (s) => {
      s.evaluation.records[0].evidenceKind = "controlled-engine";
      s.evaluation.records[0].settledCost = null;
    },
    (s) => {
      s.evaluation.records[0].modelSnapshot.configurationDigest =
        evidenceDigest("other-config");
    },
    (s) => {
      s.evaluation.records[0].candidateDigest = s.evaluation.records.find(
        (r, i) =>
          i > 0 &&
          catalog.cases.find((c) => c.id === r.caseId).workflowPath ===
            catalog.cases[0].workflowPath,
      ).candidateDigest;
    },
    (s) => {
      s.evaluation.records[0].humanReview = null;
    },
    (s) => {
      s.evaluation.records[0].reportedUsage = null;
    },
    (s) => {
      s.evaluation.records[0].settledCost = null;
    },
    (s) => {
      s.evaluation.records[0].adopted = null;
    },
  ]) {
    const s = observedStudy();
    change(s);
    assert.equal(checkProductStudy(catalog, s).gates[0].state, "incomplete");
  }
});

test("M5两路分别核阈值，低人工等级或unknown检查不被采用率遮盖；draft不执行建议阈值", () => {
  const s = observedStudy();
  s.evaluation.records[0].humanReview.checks[0].result = "unknown";
  assert.equal(checkProductStudy(catalog, s).gates[0].state, "incomplete");
  s.evaluation.records[0].humanReview.checks[0].result = "pass";
  s.evaluation.records[0].humanReview.ratings.narrativeQuality = 2;
  assert.equal(checkProductStudy(catalog, s).gates[0].state, "incomplete");
  s.protocol.status = "draft";
  s.protocol.frozenAt = null;
  s.protocol.approvalDigest = null;
  assert(
    checkProductStudy(catalog, s).modelGroups.every(
      (g) => g.observedThresholdsMet === null,
    ),
  );
  s.protocol.thresholds.adoptionMinimum.denominator = 0;
  assert.throws(() => checkProductStudy(catalog, s), /invalid-study/);
});

test("M5参与者去重与研究同意必需，坏时钟／未运行伪造结果／额外隐私字段拒绝", () => {
  for (const [change, code] of [
    [
      (s) => {
        s.sessions[1].participantTag = s.sessions[0].participantTag;
      },
      "duplicate-participant",
    ],
    [
      (s) => {
        s.sessions[0].consentDigest = null;
      },
      "study-consent-missing",
    ],
    [
      (s) => {
        s.sessions[0].finishedAt = "2026-10-06T00:00:00.000Z";
      },
      "study-clock-order",
    ],
    [
      (s) => {
        s.sessions[0].name = "PRIVATE_PERSON_CANARY";
      },
      "invalid-study",
    ],
    [
      (s) => {
        s.sessions[0].status = "not-run";
      },
      "unrun-study-evidence",
    ],
  ]) {
    const s = observedStudy();
    change(s);
    assert.throws(() => checkProductStudy(catalog, s), new RegExp(code));
  }
});

test("M5保留放弃／失败／辅助与缺测量，角色数量不能替代独立小说和改编实际终点", () => {
  const s = observedStudy();
  s.sessions[0].status = "abandoned";
  s.sessions[1].helpCount = 1;
  s.sessions[2].status = "failed";
  s.sessions[3].helpCount = null;
  let r = checkProductStudy(catalog, s);
  assert.equal(r.users.abandoned, 1);
  assert.equal(r.users.failed, 1);
  assert.equal(r.users.completedWithRequiredEvidence, 3);
  assert.equal(r.users.unassisted, 2);
  assert.equal(r.gates[1].state, "incomplete");
  s.sessions = observedStudy().sessions;
  for (let i = 0; i < 2; i++) {
    const original = s.sessions[i];
    s.sessions[i] = {
      ...original,
      workflowPath: "script",
      tasks: createUserSessionTemplate("script").tasks.map((t) => ({
        ...t,
        result: "pass",
        evidenceDigest: hash,
      })),
    };
  }
  r = checkProductStudy(catalog, s);
  assert.equal(r.gates[1].state, "incomplete");
});

test("M5按原设备／构建／模型／素材预算条件分组耗时，不混不同任务或未知条件", () => {
  const s = observedStudy();
  s.sessions[1].conditionsDigest = evidenceDigest(
    "different-source-and-budget",
  );
  s.sessions[2].deviceDigest = null;
  const r = checkProductStudy(catalog, s);
  assert.equal(r.users.comparableGroups.length, 4);
  assert.equal(
    r.users.comparableGroups.filter((g) => g.unknownConditions).length,
    1,
  );
  assert(
    r.users.comparableGroups.every((g) =>
      g.elapsedMs.every((ms) => ms === 180_000),
    ),
  );
  assert(!JSON.stringify(r).includes("test-user"));
});

test("M5调优／公开案例／套餐／三平台发布逐项记录，不借草案或摘要变成发行批准", () => {
  const s = observedStudy();
  s.tuning = [
    {
      id: "tuning-1",
      baselineDigest: evidenceDigest("baseline"),
      resultDigest: evidenceDigest(s.evaluation),
      changeDigest: hash,
      decision: "retain",
      evidenceDigest: hash,
    },
  ];
  s.publicCases = ["novel", "adaptation"].map((workflowPath) => ({
    workflowPath,
    recordIds: [
      s.evaluation.records.find(
        (r) =>
          catalog.cases.find((c) => c.id === r.caseId).workflowPath ===
          workflowPath,
      ).recordId,
    ],
    sourceRightsDigest: hash,
    publicPermissionDigest: hash,
    publicationDigest: hash,
    status: "published",
  }));
  s.commercialDecision = {
    entitlementMapDigest: hash,
    approvalDigest: hash,
    effectiveAt: "2026-10-07T00:00:00.000Z",
    evidenceDigest: hash,
  };
  s.releases = ["macos", "windows", "linux"].map((platform) => ({
    platform,
    buildDigest: hash,
    install: "pass",
    upgrade: "pass",
    recovery: "pass",
    approvalDigest: hash,
    evidenceDigest: hash,
  }));
  const r = checkProductStudy(catalog, s);
  assert.equal(r.gates[0].state, "incomplete");
  assert(
    r.gates.slice(1).every((g) => g.state === "supplied-evidence-complete"),
  );
  assert.deepEqual(r.nextActions, ["FULL_SOURCE_CORPUS_INCOMPLETE"]);
  assert.equal(r.m5Completion, "not-established");
  assert.equal(r.releaseGate, "not-established");
  s.publicCases[0].recordIds = ["missing-record"];
  assert.throws(() => checkProductStudy(catalog, s), /invalid-study/);
  s.publicCases = [];
  s.releases[0].approvalDigest = null;
  assert.equal(checkProductStudy(catalog, s).gates[5].state, "incomplete");
});

test("M5实际CLI仅向stdout给模板并只读研究文件，拒绝泄露姓名／正文／路径和错误参数", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-study-cli-"));
  const script = fileURLToPath(
    new URL("../product-evaluation.mjs", import.meta.url),
  );
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 10_000,
    });
  try {
    const result = run("study-template");
    assert.equal(result.status, 0);
    const path = join(directory, "study.json");
    await writeFile(path, result.stdout);
    const bytes = await readFile(path);
    const checked = run("study-check", path);
    assert.equal(checked.status, 0);
    assert.equal(JSON.parse(checked.stdout).m5Completion, "not-established");
    assert.deepEqual(await readFile(path), bytes);
    assert.equal(
      JSON.parse(run("user-template", "script").stdout).tasks.length,
      4,
    );
    const s = createStudyTemplate(catalog);
    s.privateText = "PRIVATE_PERSON_CANARY";
    await writeFile(path, JSON.stringify(s));
    const bad = run("study-check", path);
    assert.equal(bad.status, 1);
    assert(!bad.stderr.includes("PRIVATE_PERSON_CANARY"));
    assert(!bad.stderr.includes(directory));
    for (const args of [
      ["study-check"],
      ["study-template", "extra"],
      ["user-template", "video"],
      ["user-template"],
    ])
      assert.equal(run(...args).status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("发布证据模板默认未执行，未知敏感信息核对和批准不预填成功", async () => {
  const template = JSON.parse(
    await readFile(
      new URL("../../docs/release/evidence-template.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(template.status, "not-run");
  assert.deepEqual(Object.keys(template).sort(), [
    "approved_by",
    "commit",
    "contains_secrets",
    "environment",
    "evidence_sha256",
    "executed_at",
    "procedure",
    "result",
    "status",
  ]);
  for (const [key, value] of Object.entries(template))
    if (key !== "status") assert.equal(value, null);
});

function completedReport(evidenceKind = "real-model") {
  const report = createTemplate(catalog);
  const record = report.records[0];
  Object.assign(record, {
    evidenceKind,
    status: "completed",
    modelSnapshot: {
      providerTag: "local-test-provider",
      modelId: "fixed-test-model",
      version: "test-version-1",
      configurationDigest: hash,
    },
    elapsedMs: 120,
    candidateDigest: hash,
  });
  return report;
}
function rejected(report, code) {
  assert.throws(
    () => validateEvaluationRecord(catalog, report),
    (error) =>
      error instanceof EvaluationValidationError &&
      (!code || error.code === code),
  );
}

test("固定十份原创情境包覆盖五类型、三种目标规模、三入口和两条独立路径，不冒充全书", () => {
  assert.equal(catalog.cases.length, 10);
  assert.equal(new Set(catalog.cases.map((item) => item.genre)).size, 5);
  assert.equal(new Set(catalog.cases.map((item) => item.targetScale)).size, 3);
  assert.equal(new Set(catalog.cases.map((item) => item.entryPath)).size, 3);
  assert.equal(new Set(catalog.cases.map((item) => item.workflowPath)).size, 2);
  for (const item of catalog.cases.filter(
    (item) => item.targetScale === "long",
  ))
    assert.match(item.sourceScope, /excerpts|unread|no full-book/);
  assert.equal(catalog.status, "internal-scaffold");
});

test("空模板只有 not-run／未知，不补零、人工分数或质量通过", () => {
  const template = createTemplate(catalog);
  assert.ok(
    template.records.every((record) => record.evidenceKind === "unknown"),
  );
  const result = validateEvaluationRecord(catalog, template);
  assert.equal(result.recordConsistency, "pass");
  assert.equal(result.qualityConclusion, "not-established");
  assert.equal(result.releaseGate, "not-established");
  assert.equal(result.independentlyVerifiedExternalEvidence, false);
  assert.equal(result.uncompletedCaseIds.length, 10);
  assert.deepEqual(result.missingCaseIds, []);
  assert.equal(result.groups.length, 2);
  for (const group of result.groups) {
    assert.equal(group.notRun, 5);
    assert.equal(group.completed, 0);
    assert.equal(group.unknownUsage, 5);
    assert.equal(group.reportedZeroUsage, 0);
    assert.equal(group.humanReviews, 0);
  }
});

test("输入和目录指纹冻结全部情境及作者意图，JSON 字段顺序不影响指纹", () => {
  const template = createTemplate(catalog);
  template.records[0].inputDigest = evidenceDigest({
    ...catalog.cases[0],
    source: "changed source",
  });
  rejected(template, "stale-input");
  const reordered = Object.fromEntries(Object.entries(catalog).reverse());
  assert.equal(evidenceDigest(reordered), evidenceDigest(catalog));
  const updated = clone(catalog);
  updated.cases[0].authorIntent += "changed intent";
  assert.throws(
    () => validateEvaluationRecord(updated, createTemplate(catalog)),
    /stale-suite/,
  );
});

test("完成记录必须有固定模型配置、候选摘要和实际耗时，失败／未执行不能有候选采用", () => {
  for (const field of ["modelSnapshot", "candidateDigest", "elapsedMs"]) {
    const report = completedReport();
    report.records[0][field] = null;
    rejected(report, "missing-run-evidence");
  }
  const failed = completedReport();
  failed.records[0].status = "failed";
  rejected(failed, "failed-candidate");
  const unrun = completedReport();
  unrun.records[0].status = "not-run";
  rejected(unrun, "unrun-evidence");
});

test("缺 usage 与实际报告零、无费用与零额回执分别计量，不把估算冒充报告", () => {
  const report = completedReport();
  const second = clone(report.records[0]);
  second.recordId += "-r2";
  second.reportedUsage = {
    semantics: "reported-final",
    inputTokens: 0,
    outputTokens: 0,
    receiptDigest: hash,
  };
  second.settledCost = { amount: "0", currency: "CNY", receiptDigest: hash };
  report.records.push(second);
  const group = validateEvaluationRecord(catalog, report).groups.find(
    (item) => item.evidenceKind === "real-model",
  );
  assert.equal(group.unknownUsage, 1);
  assert.equal(group.reportedZeroUsage, 1);
  assert.equal(group.unknownCost, 1);
  assert.equal(group.settlementReceipts, 1);
  second.reportedUsage.semantics = "estimated-context";
  rejected(report);
  second.reportedUsage.semantics = "reported-cumulative";
  second.reportedUsage.inputTokens = null;
  const partial = validateEvaluationRecord(catalog, report).groups.find(
    (item) => item.evidenceKind === "real-model",
  );
  assert.equal(partial.unknownUsage, 2);
  assert.equal(partial.reportedZeroUsage, 0);
});

test("真实／受控和模型版本分组，待决定不当拒绝；受控不能附伪结算", () => {
  const report = completedReport();
  const controlled = clone(report.records[0]);
  controlled.recordId += "-controlled";
  controlled.evidenceKind = "controlled-engine";
  controlled.adopted = true;
  const other = clone(report.records[0]);
  other.recordId += "-version2";
  other.modelSnapshot.version = "test-version-2";
  other.adopted = false;
  report.records.push(controlled, other);
  const groups = validateEvaluationRecord(catalog, report).groups.filter(
    (item) => item.modelSnapshotDigest,
  );
  assert.equal(groups.length, 3);
  assert.equal(
    groups.reduce((sum, item) => sum + item.pendingDecisions, 0),
    1,
  );
  assert.equal(
    groups.reduce((sum, item) => sum + item.decisions, 0),
    2,
  );
  controlled.settledCost = {
    amount: "0",
    currency: "CNY",
    receiptDigest: hash,
  };
  rejected(report);
});

test("人工隐藏模型评分与逐项检查独立，未知和失败都不转为语义质量通过", () => {
  const report = completedReport();
  const review = {
    reviewerTag: "reviewer-1",
    modelBlind: true,
    ratings: { authorIntent: 4, continuity: 3, narrativeQuality: 2 },
    checks: catalog.cases[0].checks.map((id) => ({ id, result: "unknown" })),
    evidenceDigest: hash,
  };
  report.records[0].humanReview = review;
  const result = validateEvaluationRecord(catalog, report);
  assert.equal(
    result.groups.find((item) => item.evidenceKind === "real-model")
      .humanReviews,
    1,
  );
  assert.equal(result.qualityConclusion, "not-established");
  review.checks[0].result = "fail";
  assert.equal(
    validateEvaluationRecord(catalog, report).releaseGate,
    "not-established",
  );
  review.modelBlind = false;
  rejected(report);
  review.modelBlind = true;
  review.checks[1].id = review.checks[0].id;
  rejected(report);
});

test("重复记录、越界数字、未知字段和敏感正文拒绝，异常不带输入值", () => {
  const duplicate = createTemplate(catalog);
  duplicate.records.push(clone(duplicate.records[0]));
  rejected(duplicate, "duplicate-record");
  for (const value of [-1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const report = completedReport();
    report.records[0].elapsedMs = value;
    rejected(report);
  }
  const secret = completedReport();
  secret.records[0].prompt = "PRIVATE_CANARY_SECRET";
  assert.throws(
    () => validateEvaluationRecord(catalog, secret),
    (error) =>
      error.message === "invalid-record" &&
      !error.message.includes("PRIVATE_CANARY_SECRET"),
  );
  const privateTag = completedReport();
  privateTag.records[0].modelSnapshot.providerTag = "PRIVATE_CANARY_SECRET";
  assert.ok(
    !JSON.stringify(validateEvaluationRecord(catalog, privateTag)).includes(
      "PRIVATE_CANARY_SECRET",
    ),
  );
});

test("缺样例保持缺失，不捏造未运行或已有模型／人工事实", () => {
  const empty = createTemplate(catalog);
  empty.records = [];
  const result = validateEvaluationRecord(catalog, empty);
  assert.equal(result.missingCaseIds.length, 10);
  assert.equal(result.uncompletedCaseIds.length, 10);
  assert.deepEqual(result.groups, []);
});

test("离线汇总空模板只描述未执行记录，不构造零耗时、费用、修订或采用率", () => {
  const report = createTemplate(catalog);
  const before = JSON.stringify(report);
  const result = summarizeEvaluationRecord(catalog, report);
  assert.equal(JSON.stringify(report), before);
  assert.equal(result.recordDigest, evidenceDigest(report));
  assert.equal(result.qualityConclusion, "not-established");
  assert.equal(result.releaseGate, "not-established");
  assert.equal(result.uncompletedCaseIds.length, 10);
  for (const item of result.observations) {
    assert.equal(item.adoption.ratioAmongDecisions, null);
    assert.equal(item.adoption.firstCandidateAdoptionRatio, null);
    for (const stats of [
      item.revisions,
      item.adoptedRecordRevisions,
      item.elapsedMs,
    ])
      assert.deepEqual(stats, {
        observed: 0,
        unknown: 0,
        reportedZero: 0,
        minimum: null,
        maximum: null,
        mean: null,
      });
    assert.deepEqual(item.usage.bySemantics, []);
    assert.deepEqual(item.settlement.byCurrency, []);
    assert.equal(item.usage.totalTokens, null);
    assert.equal(item.settlement.totalCost, null);
    assert.equal(item.humanReview.reviewedRecords, 0);
    assert.deepEqual(item.humanReview.checks, []);
  }
});

test("汇总采用分母仅含已决定完成记录；待决定、失败和未运行独立，不能称首候选采用率", () => {
  const report = completedReport();
  report.records = [report.records[0]];
  report.records[0].adopted = true;
  for (const [suffix, adopted] of [
    ["rejected", false],
    ["pending", null],
  ])
    report.records.push({
      ...clone(report.records[0]),
      recordId: suffix,
      adopted,
    });
  const failed = {
    ...clone(report.records[0]),
    recordId: "failed",
    status: "failed",
    candidateDigest: null,
    adopted: null,
    revisionCount: null,
  };
  report.records.push(failed);
  const result = summarizeEvaluationRecord(catalog, report);
  const [group] = result.observations;
  assert.deepEqual(group.adoption, {
    unit: "completed-record-decision",
    decisions: 2,
    adopted: 1,
    rejected: 1,
    pending: 1,
    ratioAmongDecisions: 0.5,
    firstCandidateAdoptionRatio: null,
  });
  assert.equal(result.groups[0].failed, 1);
  assert.equal(group.coverage[0].records, 4);
  assert.equal(group.coverage[0].completed, 3);
  assert.equal(group.revisions.unknown, 3);
  assert.equal(group.adoptedRecordRevisions.unknown, 1);
  assert.equal(group.adoptedRecordRevisions.observed, 0);
  assert.equal(group.elapsedMs.observed, 4);
  assert.match(result.observationPolicy, /not-distinct-runs/);
});

test("修订和耗时统计保留真实零与未知，超过安全整数的均值分子精确且不猜修订阶段", () => {
  const report = completedReport();
  report.records = [report.records[0]];
  const first = report.records[0];
  first.revisionCount = 0;
  first.adopted = true;
  first.elapsedMs = 0;
  report.records.push(
    {
      ...clone(first),
      recordId: "unknown-revisions",
      revisionCount: null,
      elapsedMs: Number.MAX_SAFE_INTEGER,
    },
    {
      ...clone(first),
      recordId: "max-revisions",
      revisionCount: Number.MAX_SAFE_INTEGER,
      elapsedMs: Number.MAX_SAFE_INTEGER,
    },
    {
      ...clone(first),
      recordId: "max-revisions2",
      revisionCount: Number.MAX_SAFE_INTEGER,
      adopted: false,
      elapsedMs: Number.MAX_SAFE_INTEGER,
    },
  );
  const [result] = summarizeEvaluationRecord(catalog, report).observations;
  assert.deepEqual(result.revisions, {
    observed: 3,
    unknown: 1,
    reportedZero: 1,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    mean: { numerator: "18014398509481982", denominator: 3 },
  });
  assert.deepEqual(result.elapsedMs.mean, {
    numerator: "27021597764222973",
    denominator: 4,
  });
  assert.deepEqual(result.adoptedRecordRevisions.mean, {
    numerator: "9007199254740991",
    denominator: 2,
  });
});

test("汇总严格分离路径、声明来源、固定模型版本和配置，规模只是覆盖元数据", () => {
  const report = completedReport();
  report.records = [report.records[0]];
  const original = report.records[0];
  report.records.push(
    {
      ...clone(original),
      recordId: "controlled",
      evidenceKind: "controlled-engine",
    },
    { ...clone(original), recordId: "unknown", evidenceKind: "unknown" },
    {
      ...clone(original),
      recordId: "other-version",
      modelSnapshot: { ...original.modelSnapshot, version: "v2" },
    },
    {
      ...clone(original),
      recordId: "other-config",
      modelSnapshot: {
        ...original.modelSnapshot,
        configurationDigest: "a".repeat(64),
      },
    },
  );
  const other = catalog.cases.find(
    (item) => item.workflowPath !== catalog.cases[0].workflowPath,
  );
  report.records.push({
    ...clone(original),
    recordId: "other-path",
    caseId: other.id,
    inputDigest: evidenceDigest(other),
  });
  const result = summarizeEvaluationRecord(catalog, report);
  assert.equal(result.observations.length, 6);
  assert.ok(result.observations.every((item) => item.adoption.pending === 1));
  assert.ok(result.observations.every((item) => item.coverage.length === 1));
  assert.deepEqual(result.observations[0].coverage[0], {
    caseId: catalog.cases[0].id,
    genre: catalog.cases[0].genre,
    targetScale: catalog.cases[0].targetScale,
    entryPath: catalog.cases[0].entryPath,
    records: 1,
    completed: 1,
  });
  assert.match(result.boundary, /do not certify full-book/);
});

test("人工三维等级分布和各适用检查分开，unknown／未评不算失败且不自动给质量通过", () => {
  const report = completedReport();
  report.records = [report.records[0]];
  const original = report.records[0];
  original.humanReview = {
    reviewerTag: "PRIVATE_REVIEWER_CANARY",
    modelBlind: true,
    ratings: { authorIntent: 5, continuity: 2, narrativeQuality: 3 },
    checks: catalog.cases[0].checks.map((id, index) => ({
      id,
      result: index === 0 ? "fail" : "unknown",
    })),
    evidenceDigest: hash,
  };
  const passed = { ...clone(original), recordId: "pass-review" };
  passed.humanReview.checks = passed.humanReview.checks.map((check) => ({
    ...check,
    result: "pass",
  }));
  const missing = {
    ...clone(original),
    recordId: "no-review",
    humanReview: null,
  };
  report.records.push(passed, missing);
  const result = summarizeEvaluationRecord(catalog, report);
  const review = result.observations[0].humanReview;
  assert.equal(review.reviewedRecords, 2);
  assert.equal(review.unreviewedCompletedRecords, 1);
  assert.deepEqual(
    review.ratings.continuity.map((item) => item.count),
    [0, 2, 0, 0, 0],
  );
  for (const item of review.checks) {
    assert.equal(item.applicableRecords, 3);
    assert.equal(item.pass, 1);
    assert.equal(item.unreviewed, 1);
    assert.equal(
      item.fail,
      Number(item.checkId === catalog.cases[0].checks[0]),
    );
    assert.equal(
      item.unknown,
      Number(item.checkId !== catalog.cases[0].checks[0]),
    );
  }
  assert.equal(result.qualityConclusion, "not-established");
  assert.ok(!JSON.stringify(result).includes("PRIVATE_REVIEWER_CANARY"));
});

test("token按报告语义与输入输出分别统计，不把部分值、增量、累计或共用回执相加为用量", () => {
  const report = completedReport();
  report.records = [report.records[0]];
  const original = report.records[0];
  original.reportedUsage = {
    semantics: "reported-final",
    inputTokens: 0,
    outputTokens: null,
    receiptDigest: hash,
  };
  report.records.push(
    { ...clone(original), recordId: "final2" },
    {
      ...clone(original),
      recordId: "increment",
      reportedUsage: {
        ...original.reportedUsage,
        semantics: "reported-incremental",
        inputTokens: 7,
        outputTokens: 3,
      },
    },
    {
      ...clone(original),
      recordId: "cumulative",
      reportedUsage: {
        ...original.reportedUsage,
        semantics: "reported-cumulative",
        inputTokens: 20,
        outputTokens: 9,
      },
    },
    { ...clone(original), recordId: "unreported", reportedUsage: null },
  );
  const usage = summarizeEvaluationRecord(catalog, report).observations[0]
    .usage;
  assert.equal(usage.totalTokens, null);
  assert.equal(usage.unreportedExecutedRecords, 1);
  assert.equal(usage.bySemantics.length, 3);
  assert.equal(usage.bySemantics[0].records, 2);
  assert.equal(usage.bySemantics[0].distinctDeclaredReceiptDigests, 1);
  assert.equal(usage.bySemantics[0].inputTokens.reportedZero, 2);
  assert.equal(usage.bySemantics[0].outputTokens.observed, 0);
  assert.equal(usage.bySemantics[0].outputTokens.unknown, 2);
  assert.equal(usage.bySemantics[1].inputTokens.minimum, 7);
  assert.equal(usage.bySemantics[2].inputTokens.minimum, 20);
});

test("费用按币种保留精确十进制范围和零回执，共用账单摘要不能证明独立收费或总额", () => {
  const report = completedReport();
  report.records = [report.records[0]];
  const original = report.records[0];
  original.settledCost = {
    amount: "999999999999999.00000001",
    currency: "CNY",
    receiptDigest: hash,
  };
  report.records.push(
    {
      ...clone(original),
      recordId: "precise",
      settledCost: {
        ...original.settledCost,
        amount: "999999999999999.00000002",
      },
    },
    {
      ...clone(original),
      recordId: "zero",
      settledCost: { ...original.settledCost, amount: "0.00000000" },
    },
    {
      ...clone(original),
      recordId: "usd",
      settledCost: { ...original.settledCost, amount: "0.1", currency: "USD" },
    },
    { ...clone(original), recordId: "unknown-cost", settledCost: null },
  );
  const value = summarizeEvaluationRecord(catalog, report).observations[0]
    .settlement;
  assert.equal(value.totalCost, null);
  assert.equal(value.unreportedExecutedRecords, 1);
  assert.deepEqual(value.byCurrency, [
    {
      currency: "CNY",
      records: 3,
      distinctDeclaredReceiptDigests: 1,
      reportedZero: 1,
      minimumAmount: "0.00000000",
      maximumAmount: "999999999999999.00000002",
    },
    {
      currency: "USD",
      records: 1,
      distinctDeclaredReceiptDigests: 1,
      reportedZero: 0,
      minimumAmount: "0.1",
      maximumAmount: "0.1",
    },
  ]);
});

test("汇总先严格验证原记录，缺情境保持缺失，不输出模型／评议者／回执标签或原文", () => {
  const empty = { ...createTemplate(catalog), records: [] };
  assert.deepEqual(summarizeEvaluationRecord(catalog, empty).observations, []);
  assert.equal(
    summarizeEvaluationRecord(catalog, empty).missingCaseIds.length,
    10,
  );
  const report = completedReport();
  report.records[0].modelSnapshot.providerTag = "PRIVATE_PROVIDER_CANARY";
  assert.ok(
    !JSON.stringify(summarizeEvaluationRecord(catalog, report)).includes(
      "PRIVATE_PROVIDER_CANARY",
    ),
  );
  report.records[0].prompt = "PRIVATE_PROMPT_CANARY";
  assert.throws(
    () => summarizeEvaluationRecord(catalog, report),
    /invalid-record/,
  );
  delete report.records[0].prompt;
  report.records[0].inputDigest = "a".repeat(64);
  assert.throws(
    () => summarizeEvaluationRecord(catalog, report),
    /stale-input/,
  );
});

test("实际 Node CLI 仅离线读声明文件；成功是记录一致性，失败不打印正文或文件路径", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-evaluation-cli-"));
  const script = fileURLToPath(
    new URL("../product-evaluation.mjs", import.meta.url),
  );
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 10_000,
    });
  try {
    assert.equal(run("--help").status, 0);
    assert.equal(JSON.parse(run("catalog").stdout).cases.length, 10);
    const template = run("template");
    assert.equal(template.status, 0);
    const path = join(directory, "record.json");
    await writeFile(path, template.stdout);
    const validated = run("validate", path);
    assert.equal(validated.status, 0);
    assert.equal(
      JSON.parse(validated.stdout).qualityConclusion,
      "not-established",
    );
    const originalBytes = await readFile(path);
    const summarized = run("summarize", path);
    assert.equal(summarized.status, 0);
    assert.equal(JSON.parse(summarized.stdout).observations.length, 2);
    assert.equal(
      JSON.parse(summarized.stdout).recordDigest,
      evidenceDigest(JSON.parse(template.stdout)),
    );
    assert.deepEqual(await readFile(path), originalBytes);
    const completed = completedReport();
    completed.records[0].adopted = true;
    completed.records[0].revisionCount = 0;
    await writeFile(path, JSON.stringify(completed));
    const completedBytes = await readFile(path);
    const actualSummary = run("summarize", path);
    assert.equal(actualSummary.status, 0);
    const actualGroup = JSON.parse(actualSummary.stdout).observations.find(
      (item) => item.evidenceKind === "real-model",
    );
    assert.equal(actualGroup.adoption.ratioAmongDecisions, 1);
    assert.equal(actualGroup.adoptedRecordRevisions.reportedZero, 1);
    assert.equal(
      JSON.parse(actualSummary.stdout).independentlyVerifiedExternalEvidence,
      false,
    );
    assert.deepEqual(await readFile(path), completedBytes);
    await writeFile(path, '{"credential":"PRIVATE_CANARY_SECRET"}');
    const rejectedInput = run("validate", path);
    assert.equal(rejectedInput.status, 1);
    assert.ok(!rejectedInput.stderr.includes("PRIVATE_CANARY_SECRET"));
    assert.ok(!rejectedInput.stderr.includes(directory));
    const rejectedSummary = run("summarize", path);
    assert.equal(rejectedSummary.status, 1);
    assert.ok(!rejectedSummary.stderr.includes("PRIVATE_CANARY_SECRET"));
    assert.ok(!rejectedSummary.stderr.includes(directory));
    await writeFile(path, " ".repeat(1_048_577));
    assert.match(run("validate", path).stderr, /invalid-file/);
    assert.match(
      run("validate", join(directory, "missing.json")).stderr,
      /invalid-file-or-json/,
    );
    assert.equal(run("template", "extra").status, 1);
    assert.equal(run("summarize").status, 1);
    assert.equal(run("summarize", path, "extra").status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
