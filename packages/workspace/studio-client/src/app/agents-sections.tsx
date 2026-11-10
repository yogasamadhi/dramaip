/**
 * Transitional (P5-a): what this app still owns of the agents views: the
 * inspiration space's project conversion, which the agents client's space
 * lays out in its `agents.inspiration-conversion` slot, and the session's AI
 * action intent, which the agents client's new-task settings resume after
 * settings. The Studio client hands both over until project creation and the
 * session move (P6).
 */
import { useStudioSession } from "./studio-session";

export { InspirationConversion } from "./features/agents/inspiration-conversion";

/** The AI action intent the session keeps, as the Studio client hands it. */
export function useAssistantIntent() {
  const session = useStudioSession();
  const pending = session.pendingIntent;
  return {
    current: pending
      ? {
          actionId: pending.actionId,
          ...(pending.input ? { input: pending.input } : {}),
        }
      : undefined,
    clear: session.clearPendingIntent,
    save: (intent: {
      returnTo: string;
      projectId?: string;
      chapterId?: string;
      actionId: string;
      input?: string;
    }) => session.savePendingIntent({ kind: "ai-action", ...intent }),
  };
}
