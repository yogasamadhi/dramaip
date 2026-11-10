import { Fragment, type ReactNode } from "react";
import css from "./Assistant.module.css";

/**
 * An assistant message as light Markdown: fenced code, headings, rules,
 * tables, lists, quotes and paragraphs, with bold, italic and inline code.
 * Nothing is read as HTML.
 */
export function MessageContent({ content }: { content?: string | undefined }) {
  const text = content?.trim();
  if (!text) return null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith("```")) {
        code.push(lines[index]!);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre
          key={`code-${index}`}
          className={css.code}
          data-language={language || undefined}
        >
          {code.join("\n")}
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (heading) {
      blocks.push(
        <p
          key={`heading-${index}`}
          className={heading[1]!.length <= 2 ? css.heading : css.subheading}
        >
          {inline(heading[2]!)}
        </p>,
      );
      index += 1;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={`rule-${index}`} className={css.rule} />);
      index += 1;
      continue;
    }

    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      isTableDivider(lines[index + 1]!)
    ) {
      const header = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.includes("|")) {
        rows.push(tableCells(lines[index]!));
        index += 1;
      }
      blocks.push(
        <div key={`table-${index}`} className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {header.map((_, cellIndex) => (
                    <td key={cellIndex}>{inline(row[cellIndex] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const list = listBlock(lines, index, /^\s*[-*+]\s+(.+)$/);
    if (list) {
      index = list.next;
      blocks.push(
        <ul key={`list-${index}`} className={css.list}>
          {list.items.map((item, itemIndex) => (
            <li key={itemIndex}>{inline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const ordered = listBlock(lines, index, /^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      index = ordered.next;
      blocks.push(
        <ol key={`ordered-${index}`} className={css.ordered}>
          {ordered.items.map((item, itemIndex) => (
            <li key={itemIndex}>{inline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) {
        quote.push(lines[index]!.replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`} className={css.quote}>
          {inline(quote.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index]!.trim()) {
      const next = lines[index]!;
      if (startsBlock(next, lines[index + 1])) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`} className={css.paragraph}>
        {inline(paragraph.join("\n"))}
      </p>,
    );
  }

  return <div className={css.message}>{blocks}</div>;
}

function listBlock(
  lines: readonly string[],
  start: number,
  pattern: RegExp,
): { items: string[]; next: number } | undefined {
  const items: string[] = [];
  let index = start;
  while (index < lines.length) {
    const match = pattern.exec(lines[index]!);
    if (!match) break;
    items.push(match[1]!);
    index += 1;
  }
  return items.length ? { items, next: index } : undefined;
}

function startsBlock(line: string, next?: string): boolean {
  const value = line.trim();
  return (
    value.startsWith("```") ||
    /^#{1,4}\s+/.test(value) ||
    /^(?:-{3,}|\*{3,}|_{3,})$/.test(value) ||
    /^[-*+]\s+/.test(value) ||
    /^\d+[.)]\s+/.test(value) ||
    /^>\s?/.test(value) ||
    (line.includes("|") && Boolean(next && isTableDivider(next)))
  );
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function inline(value: string): ReactNode[] {
  return value
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g)
    .map((token, index) => {
      if (token.startsWith("**") && token.endsWith("**"))
        return <strong key={index}>{token.slice(2, -2)}</strong>;
      if (token.startsWith("`") && token.endsWith("`"))
        return (
          <code key={index} className={css.inlineCode}>
            {token.slice(1, -1)}
          </code>
        );
      if (token.startsWith("*") && token.endsWith("*"))
        return <em key={index}>{token.slice(1, -1)}</em>;
      return <Fragment key={index}>{token}</Fragment>;
    });
}
