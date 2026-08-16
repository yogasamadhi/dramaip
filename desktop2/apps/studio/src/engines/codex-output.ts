export type CodexStructuredOutput = {
  summary: string;
  content?: string;
  data?: unknown;
};

export function normalizeCodexOutput(
  text: string,
  metadata: { turnId?: string; status: string },
): CodexStructuredOutput & {
  engineMetadata: { codex: { turnId?: string; status: string } };
} {
  const normalizedText = text.trim();
  const structured = parseStructuredOutput(normalizedText);
  return {
    ...(structured ?? {
      summary: normalizedText.slice(0, 500) || "Codex 已完成任务",
      content: normalizedText,
    }),
    engineMetadata: { codex: metadata },
  };
}

function parseStructuredOutput(
  text: string,
): CodexStructuredOutput | undefined {
  const candidates = [text];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))
    if (match[1]) candidates.push(match[1]);
  const object = /\{[\s\S]*\}/.exec(text)?.[0];
  if (object) candidates.push(object);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim()) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        continue;
      const record = parsed as Record<string, unknown>;
      if (typeof record.summary !== "string") continue;
      return {
        summary: record.summary,
        ...(typeof record.content === "string"
          ? { content: record.content }
          : {}),
        ...(record.data !== undefined ? { data: record.data } : {}),
      };
    } catch {
      // Natural-language replies are the expected path for general chat.
    }
  }
  return undefined;
}
