import { DOMParser } from "@xmldom/xmldom";
import type {
  ScreenplayBlock,
  ScreenplayLossReport,
} from "@dramaip/contracts/production";

export interface ParsedScreenplay {
  blocks: ScreenplayBlock[];
  lossReport: ScreenplayLossReport;
}

const sourceLocation = (line: number) => ({ line, column: 1 });

function block(
  line: number,
  value:
    | Omit<
        Extract<ScreenplayBlock, { type: "scene_heading" }>,
        "id" | "sourceLocation"
      >
    | Omit<
        Extract<ScreenplayBlock, { type: "action" }>,
        "id" | "sourceLocation"
      >
    | Omit<
        Extract<ScreenplayBlock, { type: "character" }>,
        "id" | "sourceLocation"
      >
    | Omit<
        Extract<ScreenplayBlock, { type: "dialogue" }>,
        "id" | "sourceLocation"
      >
    | Omit<
        Extract<ScreenplayBlock, { type: "parenthetical" }>,
        "id" | "sourceLocation"
      >
    | Omit<
        Extract<ScreenplayBlock, { type: "transition" }>,
        "id" | "sourceLocation"
      >
    | Omit<Extract<ScreenplayBlock, { type: "note" }>, "id" | "sourceLocation">
    | Omit<
        Extract<ScreenplayBlock, { type: "page_break" }>,
        "id" | "sourceLocation"
      >,
): ScreenplayBlock {
  return {
    id: crypto.randomUUID(),
    sourceLocation: sourceLocation(line),
    ...value,
  } as ScreenplayBlock;
}

export function parseFountain(source: string): ParsedScreenplay {
  const normalized = source
    .replace(
      /\/\*([\s\S]*?)\*\//gu,
      (_match, value: string) => `\n[[${value.trim()}]]\n`,
    )
    .replace(/\r\n?/gu, "\n");
  const lines = normalized.split("\n");
  const blocks: ScreenplayBlock[] = [];
  let dialogueMode = false;
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]!.trim();
    if (!text) {
      dialogueMode = false;
      continue;
    }
    const line = index + 1;
    if (/^={3,}$/u.test(text)) {
      blocks.push(block(line, { type: "page_break" }));
      dialogueMode = false;
      continue;
    }
    const note = /^\[\[([\s\S]*)\]\]$/u.exec(text);
    if (note) {
      blocks.push(block(line, { type: "note", text: note[1]!.trim() }));
      continue;
    }
    const forcedScene = text.startsWith(".") && !text.startsWith("..");
    const sceneText = forcedScene ? text.slice(1).trim() : text;
    if (forcedScene || /^(?:INT|EXT|EST|I\/E|INT\/EXT)\.?\s/u.test(sceneText)) {
      const numbered = /^(.*?)(?:\s+#([^#]+)#)\s*$/u.exec(sceneText);
      blocks.push(
        block(line, {
          type: "scene_heading",
          text: (numbered?.[1] ?? sceneText).trim(),
          ...(numbered?.[2] ? { sceneNumber: numbered[2].trim() } : {}),
        }),
      );
      dialogueMode = false;
      continue;
    }
    if (
      text.startsWith(">") ||
      (/^[A-Z0-9 '\-().]+:$/u.test(text) && text.endsWith("TO:"))
    ) {
      blocks.push(
        block(line, {
          type: "transition",
          text: text.replace(/^>\s*/u, "").replace(/\s*<$/u, ""),
        }),
      );
      dialogueMode = false;
      continue;
    }
    if (dialogueMode && /^\(.+\)$/u.test(text)) {
      blocks.push(block(line, { type: "parenthetical", text }));
      continue;
    }
    const forcedCharacter = text.startsWith("@");
    const candidate = forcedCharacter ? text.slice(1).trim() : text;
    const next = lines
      .slice(index + 1)
      .find((value) => value.trim())
      ?.trim();
    if (
      forcedCharacter ||
      (candidate === candidate.toUpperCase() &&
        /^[\p{L}0-9 '\-().]+$/u.test(candidate) &&
        Boolean(next) &&
        !/^(?:INT|EXT|EST|I\/E|INT\/EXT)\.?\s/u.test(next!))
    ) {
      blocks.push(block(line, { type: "character", text: candidate }));
      dialogueMode = true;
      continue;
    }
    if (dialogueMode) {
      blocks.push(block(line, { type: "dialogue", text }));
      continue;
    }
    blocks.push(block(line, { type: "action", text }));
  }
  return {
    blocks,
    lossReport: {
      unsupported: [],
      warnings: [],
      preserved: ["scene_numbers", "notes", "page_breaks", "basic_formatting"],
    },
  };
}

function elementText(element: Element): string {
  const values: string[] = [];
  const texts = element.getElementsByTagName("Text");
  for (let index = 0; index < texts.length; index += 1)
    values.push(texts.item(index)?.textContent ?? "");
  return values.join("").trim();
}

export function parseFdx(source: string): ParsedScreenplay {
  if (/<!DOCTYPE|<!ENTITY/iu.test(source))
    throw new Error("FDX external entities and document types are forbidden");
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message) => errors.push(String(message)),
      fatalError: (message) => errors.push(String(message)),
    },
  }).parseFromString(source, "application/xml");
  if (errors.length || document.getElementsByTagName("parsererror").length)
    throw new Error("FDX is not well-formed XML");
  const paragraphs = document.getElementsByTagName("Paragraph");
  const blocks: ScreenplayBlock[] = [];
  const unsupported = new Set<string>();
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs.item(index);
    if (!paragraph) continue;
    const type = paragraph.getAttribute("Type")?.trim() ?? "Action";
    const text = elementText(paragraph);
    const line = index + 1;
    if (paragraph.getAttribute("DualDialogue") === "Yes")
      unsupported.add("dual_dialogue_layout");
    if (type === "Scene Heading")
      blocks.push(
        block(line, {
          type: "scene_heading",
          text,
          ...(paragraph.getAttribute("Number")
            ? { sceneNumber: paragraph.getAttribute("Number")! }
            : {}),
        }),
      );
    else if (type === "Character")
      blocks.push(block(line, { type: "character", text }));
    else if (type === "Dialogue")
      blocks.push(block(line, { type: "dialogue", text }));
    else if (type === "Parenthetical")
      blocks.push(block(line, { type: "parenthetical", text }));
    else if (type === "Transition")
      blocks.push(block(line, { type: "transition", text }));
    else if (type === "ScriptNote" || type === "General")
      blocks.push(block(line, { type: "note", text }));
    else if (type === "Page Break")
      blocks.push(block(line, { type: "page_break" }));
    else if (["Action", "Shot"].includes(type))
      blocks.push(block(line, { type: "action", text }));
    else {
      unsupported.add(`paragraph_type:${type}`);
      blocks.push(block(line, { type: "note", text: `[${type}] ${text}` }));
    }
  }
  return {
    blocks,
    lossReport: {
      unsupported: [...unsupported],
      warnings: unsupported.size
        ? ["部分 FDX 专有排版已转为可见注释，提交前请检查。"]
        : [],
      preserved: ["scene_numbers", "paragraph_types", "text_content"],
    },
  };
}

export function exportFountain(blocks: readonly ScreenplayBlock[]): string {
  return blocks
    .map((item) => {
      if (item.type === "page_break") return "===";
      if (item.type === "note") return `[[${item.text}]]`;
      if (item.type === "scene_heading")
        return `${item.text}${item.sceneNumber ? ` #${item.sceneNumber}#` : ""}`;
      return item.text;
    })
    .join("\n\n");
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function exportFdx(blocks: readonly ScreenplayBlock[]): string {
  const type = (item: ScreenplayBlock): string => {
    if (item.type === "scene_heading") return "Scene Heading";
    if (item.type === "character") return "Character";
    if (item.type === "dialogue") return "Dialogue";
    if (item.type === "parenthetical") return "Parenthetical";
    if (item.type === "transition") return "Transition";
    if (item.type === "note") return "ScriptNote";
    if (item.type === "page_break") return "Page Break";
    return "Action";
  };
  const paragraphs = blocks
    .map((item) => {
      const number =
        item.type === "scene_heading" && item.sceneNumber
          ? ` Number="${xml(item.sceneNumber)}"`
          : "";
      const content =
        item.type === "page_break" ? "" : `<Text>${xml(item.text)}</Text>`;
      return `<Paragraph Type="${type(item)}"${number}>${content}</Paragraph>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><FinalDraft DocumentType="Script" Template="No" Version="1"><Content>${paragraphs}</Content></FinalDraft>`;
}
