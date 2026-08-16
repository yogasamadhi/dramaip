import assert from "node:assert/strict";
import test from "node:test";

import { ApiProblem } from "@dramaip/http";

import { parseSourceImport } from "./source-import.ts";

test("source import validates format and extracts five reviewable candidate groups", () => {
  const preview = parseSourceImport(
    crypto.randomUUID(),
    "长篇.md",
    Buffer.from(
      "# 第一章 雨夜\n林默：别回头。\n【旧车站】里响起《倒计时》。\n\n# 第二章 回声\n苏遥：来不及了。",
    ),
  );
  assert.equal(preview.sourceType, "markdown");
  assert.equal(preview.chapters.length, 2);
  assert.deepEqual(
    preview.candidates.map((candidate) => candidate.kind),
    ["character", "scene", "prop", "chapter-summary", "adaptation-suggestion"],
  );
  assert.match(preview.checksum, /^[a-f0-9]{64}$/u);
});

test("source import rejects unsupported local content before persistence", () => {
  assert.throws(
    () =>
      parseSourceImport(
        crypto.randomUUID(),
        "malware.exe",
        Buffer.from("not a novel"),
      ),
    (error) =>
      error instanceof ApiProblem &&
      error.code === "SOURCE_IMPORT_FORMAT_UNSUPPORTED",
  );
});
