import { describe, expect, test } from "vitest";
import { strToU8, zipSync } from "fflate";
import { extractGrantedDocument } from "./document-import";

describe("granted document extraction", () => {
  test("reads UTF-8 text, markdown, and structured JSON", () => {
    expect(
      extractGrantedDocument("story.txt", strToU8("第一章\n正文")).format,
    ).toBe("txt");
    expect(
      extractGrantedDocument("story.md", strToU8("# 故事\n\n## 第一章\n正文"))
        .format,
    ).toBe("markdown");
    expect(
      extractGrantedDocument(
        "script.json",
        strToU8('{"episodes":[{"episodeNumber":1,"content":"正文"}]}'),
      ).format,
    ).toBe("script-json");
    expect(
      extractGrantedDocument(
        "pilot.fountain",
        strToU8("INT. 旧车站 - 夜\n\n林晚\n信不是寄给我的。"),
      ).format,
    ).toBe("fountain");
    expect(
      extractGrantedDocument(
        "pilot.fdx",
        strToU8(
          '<FinalDraft DocumentType="Script"><Content><Paragraph Type="Action"><Text>雨夜</Text></Paragraph></Content></FinalDraft>',
        ),
      ).format,
    ).toBe("fdx");
  });

  test("extracts DOCX paragraphs and heading styles", () => {
    const source = zipSync({
      "word/document.xml": strToU8(
        '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章</w:t></w:r></w:p><w:p><w:r><w:t>正文内容</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    const result = extractGrantedDocument("story.docx", source);
    expect(result.format).toBe("docx");
    expect(result.content).toContain("## 第一章");
    expect(result.content).toContain("正文内容");
  });

  test("extracts EPUB documents in spine order", () => {
    const source = zipSync({
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
      ),
      "OPS/book.opf": strToU8(
        '<package><metadata><dc:title>测试书</dc:title></metadata><manifest><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
      ),
      "OPS/one.xhtml": strToU8(
        "<html><body><h1>第一章</h1><p>EPUB 正文</p></body></html>",
      ),
    });
    const result = extractGrantedDocument("story.epub", source);
    expect(result.format).toBe("epub");
    expect(result.content).toContain("# 测试书");
    expect(result.content).toContain("EPUB 正文");
  });

  test("rejects invalid UTF-8, unsafe archive paths, and expansion overflow", () => {
    expect(() =>
      extractGrantedDocument("bad.txt", new Uint8Array([0xff, 0xfe])),
    ).toThrow(/UTF-8/u);
    expect(() =>
      extractGrantedDocument(
        "bad.docx",
        zipSync({ "../word/document.xml": strToU8("bad") }),
      ),
    ).toThrow(/非法路径/u);
    expect(() =>
      extractGrantedDocument(
        "large.docx",
        zipSync({ "word/document.xml": strToU8("x".repeat(2048)) }),
        { maximumExpandedBytes: 1024 },
      ),
    ).toThrow(/展开后/u);
  });
});
