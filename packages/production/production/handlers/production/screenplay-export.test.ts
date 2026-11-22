import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { ScreenplayBlock } from "@dramaip/contracts/production";
import { exportDocx, exportJson } from "./screenplay-codec.js";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const blocks: ScreenplayBlock[] = [
  { id: id(1), type: "scene_heading", text: "内景 书店 夜", sceneNumber: "1" },
  {
    id: id(2),
    type: "action",
    text: "雨声。",
    sourceLocation: { line: 2, column: 1 },
  },
  { id: id(3), type: "character", text: "林晚" },
  { id: id(4), type: "dialogue", text: "有人吗？" },
  { id: id(5), type: "page_break" },
  { id: id(6), type: "transition", text: "切至：" },
];

describe("screenplay export", () => {
  it("lays the script out in screenplay styles", () => {
    const xml = strFromU8(
      unzipSync(exportDocx("第一集", blocks))["word/document.xml"]!,
    );
    expect(xml).toContain('<w:pStyle w:val="SceneHeading"/>');
    expect(xml).toContain(">1. 内景 书店 夜<");
    expect(xml).toContain('<w:pStyle w:val="Character"/>');
    expect(xml).toContain('<w:pStyle w:val="Dialogue"/>');
    // The title page, then the scene and the page break each start a page.
    expect(xml.match(/<w:pageBreakBefore\/>/gu)).toHaveLength(2);
  });

  it("writes the structured blocks without source locations", () => {
    const value = JSON.parse(exportJson("第一集", blocks)) as {
      title: string;
      blocks: Record<string, unknown>[];
    };
    expect(value.title).toBe("第一集");
    expect(value.blocks).toHaveLength(6);
    expect(value.blocks[1]).toEqual({
      id: id(2),
      type: "action",
      text: "雨声。",
    });
  });
});
