import type { UnitOfWorkTransaction } from "@dramaip/plugin-api/internal";

/** The original user message remains the title source even after a failed first run. */
export function pendingConversationTitle(
  transaction: UnitOfWorkTransaction,
  sessionId: string,
) {
  const session = transaction.get<{ title_status: string }>(
    "SELECT title_status FROM agent_assistant_sessions WHERE id = ?",
    sessionId,
  );
  if (session?.title_status !== "pending") return;
  return transaction.get<{ id: string; user_message: string }>(
    "SELECT id, user_message FROM agent_assistant_turns WHERE session_id = ? ORDER BY rowid LIMIT 1",
    sessionId,
  );
}

/** A late model result cannot overwrite an explicit rename or a different first turn. */
export function applyConversationTitle(
  transaction: UnitOfWorkTransaction,
  sessionId: string,
  firstTurnId: string,
  result: unknown,
  now: string,
): void {
  if (!result || typeof result !== "object" || Array.isArray(result)) return;
  const raw = (result as Record<string, unknown>).conversationTitle;
  if (typeof raw !== "string") return;
  const title = raw.trim();
  if (!title || /[\p{Cc}\p{Cf}]/u.test(title) || Array.from(title).length > 32)
    return;
  if (pendingConversationTitle(transaction, sessionId)?.id !== firstTurnId)
    return;
  transaction.run(
    "UPDATE agent_assistant_sessions SET title = ?, title_status = 'generated', updated_at = ? WHERE id = ? AND title_status = 'pending'",
    title,
    now,
    sessionId,
  );
  transaction.append({
    type: "agents.assistant-session-updated.v1",
    pluginId: "agents",
    aggregateType: "assistant-session",
    aggregateId: sessionId,
    aggregateVersion: 1,
    payload: { sessionId, title },
  });
}
