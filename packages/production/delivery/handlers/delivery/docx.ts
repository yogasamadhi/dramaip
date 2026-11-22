import { strToU8, zipSync } from "fflate";

/** The MIME type of a Word document. */
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** How a paragraph is laid out: prose, headings, or screenplay elements. */
export type DocxStyle =
  | "Title"
  | "Subtitle"
  | "Heading1"
  | "Normal"
  | "SceneHeading"
  | "Action"
  | "Character"
  | "Parenthetical"
  | "Dialogue"
  | "Transition";

export interface DocxParagraph {
  text: string;
  style?: DocxStyle;
  /** Starts the paragraph on a new page. */
  pageBreak?: boolean;
}

const escape = (value: string) =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    // Characters XML 1.0 cannot carry are dropped, not written broken.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "");

function paragraph(item: DocxParagraph): string {
  const lines = item.text.split("\n");
  const runs = lines
    .map(
      (line, index) =>
        `${index ? "<w:br/>" : ""}<w:t xml:space="preserve">${escape(line)}</w:t>`,
    )
    .join("");
  const properties = [
    item.style && item.style !== "Normal"
      ? `<w:pStyle w:val="${item.style}"/>`
      : "",
    item.pageBreak ? "<w:pageBreakBefore/>" : "",
  ].join("");
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}<w:r>${runs}</w:r></w:p>`;
}

const style = (
  id: DocxStyle,
  name: string,
  paragraphProps: string,
  runProps: string,
) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${paragraphProps}</w:pPr><w:rPr>${runProps}</w:rPr></w:style>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:sz w:val="24"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLineChars="200" w:firstLine="480"/></w:pPr></w:style>${[
  style(
    "Title",
    "Title",
    '<w:jc w:val="center"/><w:spacing w:before="2400" w:after="480"/><w:ind w:firstLine="0" w:firstLineChars="0"/>',
    '<w:b/><w:sz w:val="44"/>',
  ),
  style(
    "Subtitle",
    "Subtitle",
    '<w:jc w:val="center"/><w:ind w:firstLine="0" w:firstLineChars="0"/>',
    '<w:color w:val="555555"/>',
  ),
  style(
    "Heading1",
    "heading 1",
    '<w:keepNext/><w:jc w:val="center"/><w:spacing w:before="480" w:after="360"/><w:ind w:firstLine="0" w:firstLineChars="0"/><w:outlineLvl w:val="0"/>',
    '<w:b/><w:sz w:val="32"/>',
  ),
  style(
    "SceneHeading",
    "Scene Heading",
    '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:ind w:firstLine="0" w:firstLineChars="0"/>',
    "<w:b/><w:caps/>",
  ),
  style(
    "Action",
    "Action",
    '<w:ind w:firstLine="0" w:firstLineChars="0"/>',
    "",
  ),
  style(
    "Character",
    "Character",
    '<w:keepNext/><w:spacing w:before="240" w:after="0"/><w:ind w:left="3600" w:firstLine="0" w:firstLineChars="0"/>',
    "<w:caps/>",
  ),
  style(
    "Parenthetical",
    "Parenthetical",
    '<w:keepNext/><w:spacing w:after="0"/><w:ind w:left="3024" w:right="2304" w:firstLine="0" w:firstLineChars="0"/>',
    "<w:i/>",
  ),
  style(
    "Dialogue",
    "Dialogue",
    '<w:ind w:left="2160" w:right="1440" w:firstLine="0" w:firstLineChars="0"/>',
    "",
  ),
  style(
    "Transition",
    "Transition",
    '<w:jc w:val="right"/><w:spacing w:before="240"/><w:ind w:firstLine="0" w:firstLineChars="0"/>',
    "<w:caps/>",
  ),
].join("")}</w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

/** Every zip entry gets the same time, so equal input gives equal bytes. */
const FIXED_TIME = new Date(Date.UTC(2020, 0, 1));

/**
 * A minimal Word document: the paragraphs in order, with built-in styles
 * for the title page, chapter headings and screenplay elements.
 * @param title - the document title, also written to its properties.
 * @param paragraphs - the body, in reading order.
 */
export function buildDocx(
  title: string,
  paragraphs: readonly DocxParagraph[],
): Uint8Array {
  const body = paragraphs.map(paragraph).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escape(title)}</dc:title></cp:coreProperties>`;
  const entry = (text: string) =>
    [strToU8(text), { mtime: FIXED_TIME }] as [Uint8Array, { mtime: Date }];
  return zipSync({
    "[Content_Types].xml": entry(CONTENT_TYPES),
    "_rels/.rels": entry(ROOT_RELS),
    "word/document.xml": entry(document),
    "word/_rels/document.xml.rels": entry(DOCUMENT_RELS),
    "word/styles.xml": entry(STYLES),
    "docProps/core.xml": entry(core),
  });
}

/**
 * A novel as a Word document: a title page with the synopsis, then each
 * chapter on its own page with its heading and paragraphs.
 */
export function novelDocx(input: {
  title: string;
  synopsis?: string;
  chapters: readonly { title: string; content: string }[];
}): Uint8Array {
  const paragraphs: DocxParagraph[] = [
    { text: input.title, style: "Title" },
    ...(input.synopsis?.trim()
      ? [{ text: input.synopsis.trim(), style: "Subtitle" as const }]
      : []),
  ];
  for (const chapter of input.chapters) {
    paragraphs.push({
      text: chapter.title,
      style: "Heading1",
      pageBreak: true,
    });
    for (const text of chapter.content
      .replace(/\r\n?/gu, "\n")
      .split(/\n+/u)
      .map((line) => line.trim())
      .filter(Boolean))
      paragraphs.push({ text: text.replace(/^#{1,6}\s+/u, "") });
  }
  return buildDocx(input.title, paragraphs);
}
