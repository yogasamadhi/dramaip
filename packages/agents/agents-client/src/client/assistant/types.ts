/**
 * The assistant conversation records the timeline and the inspiration space
 * read, as the `agents` Remote answers them.
 */

/** Whether a conversation may search the public web. */
export type WebAccessMode = "auto" | "off";

/** One assistant conversation. */
export interface AssistantConversation {
  id: string;
  title?: string | undefined;
  creativeMode?: string | undefined;
  webAccessMode: WebAccessMode;
}

/** One user turn and how the assistant routed it. */
export interface AssistantTurn {
  id: string;
  runId?: string | undefined;
  userMessage: string;
  status: string;
  projectId?: string | undefined;
  chapterId?: string | undefined;
  routingInputTokens?: number | undefined;
  routingOutputTokens?: number | undefined;
  route?:
    | {
        kind?: string | undefined;
        workflowId?: string | undefined;
        clarification?: string | undefined;
      }
    | undefined;
}

/** One run a turn started. */
export interface AssistantRun {
  id: string;
  status: string;
}

/** One item a run produced: a stage, a message, a tool call or its result. */
export interface AssistantItem {
  id: string;
  runId: string;
  type: string;
  status: string;
  content?: string | undefined;
  payload?: unknown;
}

/** A conversation with its turns, runs and items. */
export interface AssistantDetail {
  conversation: AssistantConversation;
  turns: AssistantTurn[];
  runs: AssistantRun[];
  items: AssistantItem[];
}

/**
 * The run of a conversation that is still queued or running.
 * @param detail - the conversation.
 */
export function activeRun(
  detail: AssistantDetail | undefined,
): AssistantRun | undefined {
  return detail?.runs.find((run) => ["queued", "running"].includes(run.status));
}

/**
 * A plain object, or `undefined` for anything else.
 * @param value - the value.
 */
export function recordValue(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
