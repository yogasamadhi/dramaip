/** One problem an opening check found, as the report lists it. */
export interface OpeningIssue {
  /** The chapter number the problem is in (1-based), when the report says. */
  chapter?: number;
  summary: string;
  quote: string;
  suggestion: string;
}

const DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 「12」, 「十二」 or 「一百零三」 as a number. */
export function chapterNumber(value: string): number | undefined {
  const text = value.trim();
  if (/^\d+$/u.test(text)) return Number(text);
  if (!/^[零〇一二两三四五六七八九十百]+$/u.test(text)) return undefined;
  let total = 0;
  let digit = 0;
  for (const char of text) {
    if (char === "百") {
      total += (digit || 1) * 100;
      digit = 0;
    } else if (char === "十") {
      total += (digit || 1) * 10;
      digit = 0;
    } else digit = DIGITS[char] ?? 0;
  }
  return total + digit || undefined;
}

const clean = (value: string) =>
  value
    .trim()
    .replace(/^[「“"『]+|[」”"』]+$/gu, "")
    .trim();

/**
 * The numbered problems of an opening check report: each 「N. 【第X章】…」
 * item with its 原文 quote and 建议. Items without a suggestion are left out.
 */
export function parseOpeningIssues(report: string): OpeningIssue[] {
  const items = report
    .replace(/\r\n?/gu, "\n")
    .split(/\n(?=\s*(?:\*\*)?\d+[.、．)]\s*)/u)
    .filter((item) => /^\s*(?:\*\*)?\d+[.、．)]/u.test(item));
  return items.flatMap((item) => {
    const lines = item.split("\n").map((line) => line.trim());
    const head = lines[0]!.replace(/^(?:\*\*)?\d+[.、．)]\s*/u, "");
    const chapter = /第\s*([0-9零〇一二两三四五六七八九十百]+)\s*章/u.exec(
      head,
    );
    const field = (name: string) => {
      const at = lines.findIndex((line) =>
        new RegExp(
          `^(?:[-*]\\s*)?(?:\\*\\*)?${name}(?:\\*\\*)?\\s*[:：]`,
          "u",
        ).test(line),
      );
      if (at < 0) return "";
      const first = lines[at]!.replace(/^[^:：]*[:：]\s*/u, "");
      const rest: string[] = [];
      for (const line of lines.slice(at + 1)) {
        if (/^(?:[-*]\s*)?(?:\*\*)?(原文|建议)(?:\*\*)?\s*[:：]/u.test(line))
          break;
        rest.push(line);
      }
      return [first, ...rest].join("\n").trim();
    };
    const suggestion = field("建议");
    if (!suggestion) return [];
    return [
      {
        ...(chapter ? { chapter: chapterNumber(chapter[1]!) } : {}),
        summary: head
          .replace(/【[^】]*】/u, "")
          .replace(/\*\*/gu, "")
          .trim(),
        quote: clean(field("原文")),
        suggestion: clean(suggestion),
      },
    ];
  });
}

/** What to ask the chapter AI so it fixes just this one problem. */
export function openingFixInstruction(issue: OpeningIssue): string {
  return [
    `只修改以下问题：${issue.summary ? `${issue.summary}。` : ""}${issue.suggestion}`,
    issue.quote ? `原文：「${issue.quote}」` : "",
    "其余内容保持不变。",
  ]
    .filter(Boolean)
    .join("\n");
}
