import { describe, expect, it } from "vitest";
import type { ScreenplayBlock } from "@dramaip/contracts/production";
import {
  directScriptSourceContent,
  type DirectScriptSourceDocument,
} from "./direct-script-source.js";

const blocks: ScreenplayBlock[] = [
  {
    id: crypto.randomUUID(),
    type: "scene_heading",
    text: "INT. 书房 - NIGHT",
    sceneNumber: "1A",
    sourceLocation: { line: 2, column: 1 },
  },
  {
    id: crypto.randomUUID(),
    type: "action",
    text: "林晚记录警告。",
    sourceLocation: { line: 4, column: 1 },
  },
  { id: crypto.randomUUID(), type: "note", text: "作者要求保留求证动机。" },
  { id: crypto.randomUUID(), type: "page_break" },
];
const lossReport = {
  unsupported: ["dual_dialogue_layout"],
  warnings: ["请人工核对双栏对白排版。"],
  preserved: ["scene_numbers", "text_content"],
};
const document = (
  source_format = "fdx",
  actualBlocks: ScreenplayBlock[] = blocks,
): DirectScriptSourceDocument => ({
  version: 0,
  blocks_json: JSON.stringify(actualBlocks),
  source_format,
  loss_report_json: JSON.stringify(lossReport),
});

describe("direct saved screenplay sources", () => {
  it("preserves nonempty legacy text and its exact frozen reference shape", () => {
    const text = "  作者原稿，不能重新导出覆盖。\r\n";
    expect(directScriptSourceContent(text)).toEqual({ content: text });
    expect(directScriptSourceContent(text, document())).toEqual({
      content: text,
      blocks,
    });
  });

  it.each(["fountain", "fdx"])(
    "reads %s AST-only originals without changing IDs, locations or stored bytes",
    (format) => {
      const saved = document(format);
      const before = structuredClone(saved);
      const actual = directScriptSourceContent(undefined, saved);
      expect(actual).toEqual({
        content:
          "INT. 书房 - NIGHT #1A#\n\n林晚记录警告。\n\n[[作者要求保留求证动机。]]\n\n===",
        blocks,
        contentRepresentation: "saved-screenplay-ast-fountain",
        sourceFormat: format,
        lossReport,
      });
      expect(directScriptSourceContent(" ", saved)).toEqual(actual);
      expect(directScriptSourceContent(undefined, saved)).toEqual(actual);
      expect(saved).toEqual(before);
    },
  );

  it("does not invent content for absent documents, empty AST or layout-only imports", () => {
    for (const body of [undefined, null, "", " ", 0, {}])
      expect(directScriptSourceContent(body)).toBeUndefined();
    for (const nonStory of [
      [],
      [blocks[0]!, blocks[2]!, blocks[3]!],
      [{ id: crypto.randomUUID(), type: "character" as const, text: "林晚" }],
      [{ id: crypto.randomUUID(), type: "action" as const, text: "  " }],
    ])
      expect(
        directScriptSourceContent(undefined, document("fdx", nonStory)),
      ).toBeUndefined();
  });

  it("fails closed for corrupt JSON, malformed blocks or duplicate stable identities", () => {
    for (const blocks_json of [
      "{",
      "null",
      JSON.stringify([{ ...blocks[1], id: "not-stable" }]),
      JSON.stringify([{ ...blocks[1], type: "unknown" }]),
      JSON.stringify([blocks[1], blocks[1]]),
    ]) {
      const bad = { ...document(), blocks_json };
      expect(directScriptSourceContent(undefined, bad)).toBeUndefined();
      expect(
        directScriptSourceContent("旧正文不能掩盖损坏的真实块", bad),
      ).toBeUndefined();
    }
  });

  it("retains fallback format and loss provenance and rejects corrupt provenance", () => {
    for (const bad of [
      { ...document(), source_format: "unknown" },
      { ...document(), loss_report_json: "{" },
      { ...document(), loss_report_json: "{}" },
    ])
      expect(directScriptSourceContent(undefined, bad)).toBeUndefined();
    expect(directScriptSourceContent("原正文", document())).not.toHaveProperty(
      "contentRepresentation",
    );
  });

  it("uses the exact saved AST, not a round-trip parser or normalized location defaults", () => {
    const raw = [{ ...blocks[1], sourceLocation: { line: 4 } }];
    const saved = { ...document(), blocks_json: JSON.stringify(raw) };
    expect(directScriptSourceContent("原正文", saved)).toEqual({
      content: "原正文",
      blocks: raw,
    });
    expect(directScriptSourceContent(undefined, saved)?.blocks).toEqual(raw);
  });
});
