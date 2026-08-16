import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";

import { ApiProblem } from "@dramaip/http";

import type {
  SourceImportCandidate,
  SourceImportPreview,
} from "./contracts.ts";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_CHARS = 5_000_000;

export function parseSourceImport(
  projectId: string,
  fileName: string,
  buffer: Buffer,
): SourceImportPreview {
  if (!buffer.length || buffer.length > MAX_SOURCE_BYTES)
    throw new ApiProblem(
      400,
      "SOURCE_IMPORT_SIZE_INVALID",
      "导入文件必须小于 20MB 且不能为空",
    );
  const extension = extname(fileName).toLowerCase();
  const sourceType =
    extension === ".docx"
      ? "docx"
      : extension === ".md" || extension === ".markdown"
        ? "markdown"
        : extension === ".txt"
          ? "txt"
          : undefined;
  if (!sourceType)
    throw new ApiProblem(
      400,
      "SOURCE_IMPORT_FORMAT_UNSUPPORTED",
      "仅支持 .txt、.md 和 .docx 文件",
    );
  const raw =
    sourceType === "docx" ? docxText(buffer) : decodeSourceText(buffer);
  const content = normalizeText(raw);
  if (!content || content.length > MAX_SOURCE_CHARS)
    throw new ApiProblem(
      400,
      "SOURCE_IMPORT_CONTENT_INVALID",
      "导入正文为空或超过 500 万字符",
    );
  const chapters = splitChapters(content);
  const candidates = buildCandidates(chapters, content);
  const now = new Date();
  return {
    id: randomUUID(),
    projectId,
    fileName,
    sourceType,
    checksum: createHash("sha256").update(buffer).digest("hex"),
    charCount: content.length,
    chapters,
    candidates,
    warnings: chapters
      .filter((chapter) => chapter.wordCount > 25_000)
      .map((chapter) => `「${chapter.title}」超过 2.5 万字，已完整保留。`),
    status: "preview",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
  };
}

function splitChapters(content: string): SourceImportPreview["chapters"] {
  const heading =
    /^(?:#{1,3}\s*)?(第[零一二三四五六七八九十百千万\d]+[章节卷]|序章|楔子|番外)[：:\s-]*(.*)$/gmu;
  const matches = [...content.matchAll(heading)];
  if (!matches.length) {
    return [
      {
        id: "chapter-0",
        title: "第 1 章",
        content,
        ordinal: 0,
        wordCount: countWords(content),
      },
    ];
  }
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const bodyStart = start + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    const body = content.slice(bodyStart, end).trim();
    return {
      id: `chapter-${index}`,
      title: `${match[1]}${match[2]?.trim() ? ` ${match[2].trim()}` : ""}`,
      content: body,
      ordinal: index,
      wordCount: countWords(body),
    };
  });
}

function buildCandidates(
  chapters: SourceImportPreview["chapters"],
  content: string,
): SourceImportCandidate[] {
  const dialogueNames = new Map<string, number>();
  for (const match of content.matchAll(/^([\p{L}]{2,8})[：:]/gmu)) {
    const name = match[1]!;
    dialogueNames.set(name, (dialogueNames.get(name) ?? 0) + 1);
  }
  const names = [...dialogueNames.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([name]) => name);
  const sceneNames = [...content.matchAll(/[【[]([^】\]\n]{2,80})[】\]]/gu)]
    .map((match) => match[1]!.trim())
    .filter(Boolean)
    .slice(0, 20);
  const props = [...content.matchAll(/[“「《]([^”」》\n]{2,30})[”」》]/gu)]
    .map((match) => match[1]!.trim())
    .filter(Boolean)
    .slice(0, 20);
  const summary = chapters.slice(0, 100).map((chapter) => ({
    chapterId: chapter.id,
    title: chapter.title,
    summary: chapter.content.slice(0, 240),
  }));
  const candidate = (
    kind: SourceImportCandidate["kind"],
    title: string,
    data: Record<string, unknown>,
  ): SourceImportCandidate => ({
    id: randomUUID(),
    kind,
    title,
    data,
    selectedByDefault: true,
  });
  return [
    candidate("character", "人物候选", { names }),
    candidate("scene", "场景候选", { names: sceneNames }),
    candidate("prop", "道具候选", { names: props }),
    candidate("chapter-summary", "章节摘要候选", { chapters: summary }),
    candidate("adaptation-suggestion", "改编建议", {
      suggestion: `原文共 ${chapters.length} 章，建议先确认人物关系与章节钩子，再进入短剧改编。`,
    }),
  ];
}

function countWords(value: string): number {
  return [...value.replace(/\s/gu, "")].length;
}

function normalizeText(value: string): string {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\0")
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function decodeSourceText(buffer: Buffer): string {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
    return buffer.subarray(3).toString("utf8");
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])))
    return buffer.subarray(2).toString("utf16le");
  if (buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8");
}

function docxText(buffer: Buffer): string {
  const entry = readZipEntry(buffer, "word/document.xml");
  if (!entry)
    throw new ApiProblem(400, "DOCX_BODY_UNREADABLE", "无法读取 Word 文档正文");
  const xml = entry.toString("utf8");
  const output: string[] = [];
  const expression =
    /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<\/w:p>/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(xml))) {
    if (match[1] !== undefined) output.push(decodeXml(match[1]));
    else if (match[0].startsWith("<w:tab")) output.push("\t");
    else output.push("\n");
  }
  return output.join("");
}

function readZipEntry(buffer: Buffer, wanted: string): Buffer | undefined {
  const end = findZipEnd(buffer);
  if (end < 0) return undefined;
  const entries = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < entries; index += 1) {
    if (
      offset + 46 > buffer.length ||
      buffer.readUInt32LE(offset) !== 0x02014b50
    )
      return undefined;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");
    if (name === wanted) {
      if (
        localOffset + 30 > buffer.length ||
        buffer.readUInt32LE(localOffset) !== 0x04034b50
      )
        return undefined;
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(start, start + compressedSize);
      if (method === 0) return Buffer.from(compressed);
      if (method === 8) return inflateRawSync(compressed);
      return undefined;
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return undefined;
}

function findZipEnd(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let index = buffer.length - 22; index >= minimum; index -= 1)
    if (buffer.readUInt32LE(index) === 0x06054b50) return index;
  return -1;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}
