import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDocx, novelDocx } from "./docx.js";

const documentXml = (bytes: Uint8Array) =>
  strFromU8(unzipSync(bytes)["word/document.xml"]!);

describe("buildDocx", () => {
  it("writes a Word package with the parts Word needs", () => {
    const files = unzipSync(buildDocx("标题", [{ text: "正文" }]));
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "word/_rels/document.xml.rels",
      "word/document.xml",
      "word/styles.xml",
    ]);
  });

  it("escapes markup and keeps line breaks", () => {
    const xml = documentXml(
      buildDocx("t", [{ text: "a < b & c\n第二行", style: "Dialogue" }]),
    );
    expect(xml).toContain("a &lt; b &amp; c");
    expect(xml).toContain("<w:br/>");
    expect(xml).toContain('<w:pStyle w:val="Dialogue"/>');
  });

  it("gives the same bytes for the same input", () => {
    expect(buildDocx("t", [{ text: "x" }])).toEqual(
      buildDocx("t", [{ text: "x" }]),
    );
  });
});

describe("novelDocx", () => {
  it("puts each chapter on its own page with its paragraphs", () => {
    const xml = documentXml(
      novelDocx({
        title: "旧书店",
        synopsis: "一句话简介",
        chapters: [
          { title: "第一章", content: "## 小标题\n\n第一段\r\n第二段" },
          { title: "第二章", content: "下一章" },
        ],
      }),
    );
    expect(xml.match(/<w:pageBreakBefore\/>/gu)).toHaveLength(2);
    expect(xml).toContain("一句话简介");
    expect(xml).toContain(">小标题<");
    expect(xml).not.toContain("##");
    expect(xml).toContain(">第二段<");
  });
});
