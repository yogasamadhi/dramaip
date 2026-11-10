import { posix } from "node:path";
import { unzipSync } from "fflate";

export type GrantedDocumentFormat =
  "txt" | "markdown" | "docx" | "epub" | "script-json" | "fountain" | "fdx";

export interface GrantedDocument {
  name: string;
  format: GrantedDocumentFormat;
  content: string;
  size: number;
}

export interface DocumentImportLimits {
  maximumBytes: number;
  maximumExpandedBytes: number;
  maximumCharacters: number;
}

const DEFAULT_LIMITS: DocumentImportLimits = {
  maximumBytes: 32 * 1024 * 1024,
  maximumExpandedBytes: 64 * 1024 * 1024,
  maximumCharacters: 5_000_000,
};

export function extractGrantedDocument(
  name: string,
  source: Uint8Array,
  limits: Partial<DocumentImportLimits> = {},
): GrantedDocument {
  const resolvedLimits = { ...DEFAULT_LIMITS, ...limits };
  if (source.byteLength > resolvedLimits.maximumBytes)
    throw new Error("文件超过允许的大小");
  const extension = name.split(".").pop()?.toLowerCase();
  let format: GrantedDocumentFormat;
  let content: string;
  if (extension === "txt") {
    format = "txt";
    content = decodeUtf8(source);
  } else if (extension === "md" || extension === "markdown") {
    format = "markdown";
    content = decodeUtf8(source);
  } else if (extension === "json") {
    format = "script-json";
    content = decodeUtf8(source);
  } else if (extension === "fountain") {
    format = "fountain";
    content = decodeUtf8(source);
  } else if (extension === "fdx") {
    format = "fdx";
    content = decodeUtf8(source);
  } else if (extension === "docx") {
    format = "docx";
    content = extractDocx(source, resolvedLimits.maximumExpandedBytes);
  } else if (extension === "epub") {
    format = "epub";
    content = extractEpub(source, resolvedLimits.maximumExpandedBytes);
  } else {
    throw new Error("不支持此文件类型");
  }
  const normalized = normalizeDocument(content);
  if (!normalized) throw new Error("文件中没有可导入的正文");
  if (normalized.length > resolvedLimits.maximumCharacters)
    throw new Error("解析后的正文超过允许的长度");
  return { name, format, content: normalized, size: source.byteLength };
}

function decodeUtf8(source: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch {
    throw new Error("文件不是有效的 UTF-8 文本");
  }
}

function unzipDocument(
  source: Uint8Array,
  maximumExpandedBytes: number,
): Record<string, Uint8Array> {
  let expandedBytes = 0;
  const entries = unzipSync(source, {
    filter(entry) {
      const name = safeZipPath(entry.name);
      expandedBytes += entry.originalSize;
      if (expandedBytes > maximumExpandedBytes)
        throw new Error("压缩文件展开后超过允许的大小");
      return Boolean(name) && !entry.name.endsWith("/");
    },
  });
  const normalized: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(entries))
    normalized[safeZipPath(name)] = value;
  return normalized;
}

function safeZipPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized)
  )
    throw new Error("压缩文件包含非法路径");
  const resolved = posix.normalize(normalized);
  if (resolved === ".." || resolved.startsWith("../"))
    throw new Error("压缩文件包含非法路径");
  return resolved.replace(/^\.\//u, "");
}

function extractDocx(source: Uint8Array, maximumExpandedBytes: number): string {
  const entries = unzipDocument(source, maximumExpandedBytes);
  const document = entries["word/document.xml"];
  if (!document) throw new Error("DOCX 缺少 word/document.xml");
  const xml = decodeUtf8(document);
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu) ?? [];
  return paragraphs
    .map((paragraph) => {
      const style =
        paragraph.match(/<w:pStyle[^>]*w:val="([^"]+)"/u)?.[1] ?? "";
      const text = xmlFragmentText(paragraph);
      if (!text) return "";
      if (/^(?:Title|标题)$/iu.test(style)) return `# ${text}`;
      const heading = style.match(/^(?:Heading|标题)\s*([1-6])$/iu)?.[1];
      return heading
        ? `${"#".repeat(Math.min(6, Number(heading) + 1))} ${text}`
        : text;
    })
    .filter(Boolean)
    .join("\n\n");
}

function extractEpub(source: Uint8Array, maximumExpandedBytes: number): string {
  const entries = unzipDocument(source, maximumExpandedBytes);
  const container = entries["META-INF/container.xml"];
  if (!container) throw new Error("EPUB 缺少 META-INF/container.xml");
  const containerXml = decodeUtf8(container);
  const packagePath = decodeXmlEntities(
    containerXml.match(/<rootfile[^>]*full-path="([^"]+)"/iu)?.[1] ?? "",
  );
  if (!packagePath) throw new Error("EPUB 未声明内容清单");
  const safePackagePath = safeZipPath(packagePath);
  const packageEntry = entries[safePackagePath];
  if (!packageEntry) throw new Error("EPUB 内容清单不存在");
  const packageXml = decodeUtf8(packageEntry);
  const base = posix.dirname(safePackagePath);
  const manifest = new Map<string, string>();
  for (const tag of packageXml.match(/<item\b[^>]*>/giu) ?? []) {
    const id = attribute(tag, "id");
    const href = attribute(tag, "href");
    if (id && href) manifest.set(id, resolveArchivePath(base, href));
  }
  const spine = (packageXml.match(/<itemref\b[^>]*>/giu) ?? [])
    .map((tag) => attribute(tag, "idref"))
    .flatMap((id) => (id && manifest.has(id) ? [manifest.get(id)!] : []));
  const documents = spine.length
    ? spine
    : Object.keys(entries)
        .filter((name) => /\.(?:xhtml?|html?)$/iu.test(name))
        .sort();
  const sections = documents.flatMap((documentPath, index) => {
    const entry = entries[documentPath];
    if (!entry) return [];
    const html = decodeUtf8(entry);
    const title =
      html.match(/<h[1-2]\b[^>]*>([\s\S]*?)<\/h[1-2]>/iu)?.[1] ??
      html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ??
      `第 ${index + 1} 章`;
    const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1] ?? html;
    const markdown = htmlToMarkdown(body);
    if (!markdown) return [];
    return [`## ${stripMarkup(title) || `第 ${index + 1} 章`}\n\n${markdown}`];
  });
  if (!sections.length) throw new Error("EPUB 中没有可读取的章节");
  const bookTitle = stripMarkup(
    packageXml.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/iu)?.[1] ?? "",
  );
  return [bookTitle ? `# ${bookTitle}` : "", ...sections]
    .filter(Boolean)
    .join("\n\n");
}

function resolveArchivePath(base: string, href: string): string {
  const withoutFragment = decodeXmlEntities(href).split(/[?#]/u, 1)[0] ?? "";
  return safeZipPath(posix.join(base, withoutFragment));
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "iu"))?.[1];
}

function xmlFragmentText(value: string): string {
  return decodeXmlEntities(
    value
      .replace(/<w:tab\s*\/>/giu, "\t")
      .replace(/<w:br\s*\/>/giu, "\n")
      .replace(/<[^>]+>/gu, ""),
  ).trim();
}

function htmlToMarkdown(value: string): string {
  return decodeXmlEntities(
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
      .replace(
        /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu,
        (_, level, text) =>
          `\n\n${"#".repeat(Number(level))} ${stripMarkup(text)}\n\n`,
      )
      .replace(/<li\b[^>]*>/giu, "\n- ")
      .replace(/<(?:br|hr)\s*\/?>/giu, "\n")
      .replace(/<\/(?:p|div|section|article|li|blockquote)>/giu, "\n\n")
      .replace(/<[^>]+>/gu, ""),
  );
}

function stripMarkup(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]+>/gu, "")).trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#([0-9]+);/gu, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function normalizeDocument(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
