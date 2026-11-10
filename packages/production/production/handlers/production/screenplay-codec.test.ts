import { describe, expect, test } from "vitest";
import {
  exportFdx,
  exportFountain,
  parseFdx,
  parseFountain,
} from "./screenplay-codec";

describe("Screenplay AST codecs", () => {
  test("preserves Fountain scene numbers, notes and dialogue blocks", () => {
    const parsed = parseFountain(`INT. 茶馆 - 夜 #12#

[[伏笔：怀表停在十一点]]

林夏
(压低声音)
别回头。

CUT TO:`);
    expect(parsed.blocks.map((item) => item.type)).toEqual([
      "scene_heading",
      "note",
      "character",
      "parenthetical",
      "dialogue",
      "transition",
    ]);
    expect(parsed.blocks[0]).toMatchObject({ sceneNumber: "12" });
    expect(exportFountain(parsed.blocks)).toContain("#12#");
  });

  test("parses and exports safe FDX without external entities", () => {
    const source = `<?xml version="1.0"?><FinalDraft><Content>
      <Paragraph Type="Scene Heading" Number="4"><Text>EXT. 码头 - 日</Text></Paragraph>
      <Paragraph Type="Action"><Text>雨水打在旧船票上。</Text></Paragraph>
    </Content></FinalDraft>`;
    const parsed = parseFdx(source);
    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.blocks[0]).toMatchObject({
      type: "scene_heading",
      sceneNumber: "4",
    });
    expect(parseFdx(exportFdx(parsed.blocks)).blocks).toHaveLength(2);
    expect(() =>
      parseFdx(
        `<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]><FinalDraft/>`,
      ),
    ).toThrow("forbidden");
  });
});
