import { Parser } from "htmlparser2";
import TurndownService from "turndown";

const BLOCKED_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "embed",
  "form",
  "nav",
  "meta",
  "link",
  "template",
  "svg",
  "canvas",
  "img",
  "title",
]);

function hidden(attributes: Record<string, string>): boolean {
  if (Object.hasOwn(attributes, "hidden")) return true;
  if (Object.hasOwn(attributes, "inert")) return true;
  if (attributes["aria-hidden"]?.toLowerCase() === "true") return true;
  if (/(?:^|\s)hidden(?:\s|$)/u.test(attributes.class ?? "")) return true;
  if (attributes.type?.toLowerCase() === "hidden") return true;
  const style = attributes.style?.replace(/\s+/gu, "").toLowerCase() ?? "";
  return /(?:^|;)(?:display:none|visibility:hidden)(?:;|$)/u.test(style);
}

function escapedText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function extractSafeWebPage(html: string): {
  title?: string;
  markdown: string;
} {
  let title = "";
  let titleDepth = 0;
  let blockedDepth = 0;
  let sanitizedHtml = "";
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === "title") titleDepth += 1;
        if (blockedDepth > 0) {
          blockedDepth += 1;
          return;
        }
        if (BLOCKED_ELEMENTS.has(name) || hidden(attributes)) {
          blockedDepth = 1;
          return;
        }
        if (name === "a") {
          const href = safeHref(attributes.href);
          sanitizedHtml += href ? `<a href="${href}">` : "<a>";
          return;
        }
        sanitizedHtml += `<${name}>`;
      },
      ontext(value) {
        if (titleDepth > 0) title += value;
        if (blockedDepth === 0) sanitizedHtml += escapedText(value);
      },
      onclosetag(name) {
        if (name === "title" && titleDepth > 0) titleDepth -= 1;
        if (blockedDepth > 0) {
          blockedDepth -= 1;
          return;
        }
        sanitizedHtml += name === "a" ? "</a>" : `</${name}>`;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();

  const converter = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  const normalizedTitle = title.replace(/\s+/gu, " ").trim();
  return {
    ...(normalizedTitle ? { title: normalizedTitle.slice(0, 500) } : {}),
    markdown: converter
      .turndown(sanitizedHtml)
      .replace(/\n{4,}/gu, "\n\n\n")
      .trim(),
  };
}
