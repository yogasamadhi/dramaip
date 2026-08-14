const HIDDEN_PART_TYPES = new Set([
  "reasoning",
  "analysis",
  "step-start",
  "step-finish",
  "tool",
  "tool_call",
  "usage",
]);

const ENVELOPE_KEYS = [
  "parts",
  "output",
  "result",
  "response",
  "message",
  "messages",
  "choices",
  "data",
] as const;

/** Extract only the engine's user-facing answer, never runtime metadata. */
export function collectPublicAgentText(value: unknown): string {
  const fragments: string[] = [];
  const seen = new Set<object>();

  const visit = (current: unknown, depth: number): void => {
    if (depth > 12 || current === null || current === undefined) return;
    if (typeof current === "string") {
      if (current.trim()) fragments.push(current);
      return;
    }
    if (typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }

    const record = current as Record<string, unknown>;
    const partType =
      typeof record.type === "string" ? record.type.toLowerCase() : undefined;
    if (partType && HIDDEN_PART_TYPES.has(partType)) return;

    if (typeof record.text === "string") fragments.push(record.text);
    if (typeof record.content === "string") fragments.push(record.content);
    if (record.content && typeof record.content === "object")
      visit(record.content, depth + 1);
    for (const key of ENVELOPE_KEYS) {
      const nested = record[key];
      if (nested !== undefined) visit(nested, depth + 1);
    }
  };

  visit(value, 0);
  return [
    ...new Set(fragments.map((fragment) => fragment.trim()).filter(Boolean)),
  ].join("\n");
}
