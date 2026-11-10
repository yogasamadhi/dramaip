import { useCallback, useEffect, useRef, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/agents-agents/remote";
import type {} from "@dramaip/automation-automation/remote";
import type {
  ChangePreviewsGetResult,
  ChangePreviewsMergeResult,
  ChangePreviewsRevisionEffortResult,
  CreationExecutionResult,
  CreationGetResult,
  CreationMergeResult,
  CreationRebaseInput,
  CreationStartInput,
} from "@dramaip/automation-automation/types";
import type {} from "@dramaip/writing-writing/remote";

/** The `automation` Remote namespace: creation runs and their previews. */
export type AutomationRemote = Context["remote"]["automation"];
/** The `agents` Remote namespace: engine settings, run items and usage. */
export type AgentsRemote = Context["remote"]["agents"];
/** The `writing` Remote namespace: the chapter a draft revises. */
export type WritingRemote = Context["remote"]["writing"];
/** Copy of the creation workbench. */
export type Translate = TranslateNS<"creation">;

/** The Remote namespaces the workbench reads and writes. */
export interface CreationRemotes {
  automation: AutomationRemote;
  agents: AgentsRemote;
  writing: WritingRemote;
}

/** One creation run as its owner answers it. */
export type CreationWorkflow = CreationGetResult;
/** What starts a creation run. */
export type CreationInput = CreationStartInput;
/** The operation a creation run performs. */
export type CreationOperation = CreationInput["operation"];
/** The stage a creation run is in. */
export type CreationStage = CreationWorkflow["stage"];
/** One finding of a run's checks. */
export type CreationIssue = CreationWorkflow["issues"][number];
/** The change preview a run's draft waits in. */
export type ChangePreview = ChangePreviewsGetResult;
/** The three-way comparison of a chapter draft and the current text. */
export type ChapterMerge = ChangePreviewsMergeResult;
/** The block comparison of a script draft and the current script. */
export type CreationMerge = CreationMergeResult;
/** The choices that merge a script draft. */
export type CreationRebaseRequest = CreationRebaseInput;
/** The stage runs of one workflow attempt. */
export type CreationExecutionReceipt = CreationExecutionResult;
/** The saved revisions of one chapter draft. */
export type PreviewRevisionEffort = ChangePreviewsRevisionEffortResult;

/** A Remote answer: the value, or the failure. */
type Answer =
  | { ok: true; value: unknown }
  | {
      ok: false;
      error: { code?: string; message: string; data?: unknown };
    };

/** A failed Remote call, with the status and code its handler answered. */
export class RemoteFailure extends Error {
  /** The HTTP status of the handler's problem answer, if it had one. */
  readonly status: number | undefined;
  /** The problem code of the handler's answer, if it had one. */
  readonly code: string | undefined;

  constructor(error: { code?: string; message: string; data?: unknown }) {
    super(error.message);
    const data =
      error.data && typeof error.data === "object"
        ? (error.data as { status?: unknown; code?: unknown })
        : {};
    this.status = typeof data.status === "number" ? data.status : undefined;
    this.code = typeof data.code === "string" ? data.code : undefined;
  }
}

/**
 * The value of a Remote answer, or the failure as a {@link RemoteFailure}.
 * @param answer - pending Remote answer.
 * @returns its value, typed as the caller reads it.
 */
export async function value<T>(answer: Promise<Answer>): Promise<T> {
  const result = await answer;
  if (!result.ok) throw new RemoteFailure(result.error);
  return result.value as T;
}

/**
 * A failure's message.
 * @param cause - what was thrown.
 */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Only a start's validation or domain rejection proves no run began, so only
 * that failure frees its idempotency key; a lost answer or an idempotency
 * conflict does not.
 * @param cause - what the start threw.
 */
export function isDefiniteStartRejection(cause: unknown): boolean {
  return (
    cause instanceof RemoteFailure &&
    ((cause.status === 400 && cause.code === "VALIDATION_ERROR") ||
      (cause.status === 409 && cause.code === "CONFLICT"))
  );
}

/** One polled read's state. */
export interface Poll<T> {
  /** The last value this mount read; dropped when a read fails. */
  data: T | undefined;
  error: string | undefined;
  /** A read is running; `data` is the previous answer until it lands. */
  fetching: boolean;
  /** Read again now. */
  refresh: () => void;
}

/**
 * Read once `enabled` is true, again every `interval` milliseconds and on
 * `refresh`. A newer read drops an older answer; a failure drops the value,
 * so nothing unverified stays usable, while a read in flight keeps the
 * previous answer on screen. A change of `key` starts over.
 * @param key - what is read; a new key forgets the old value.
 * @param read - the read.
 * @param options.enabled - whether to read at all.
 * @param options.interval - milliseconds between reads, or none.
 */
export function usePoll<T>(
  key: string,
  read: () => Promise<T>,
  options: {
    enabled?: boolean;
    interval?:
      number | ((data: T | undefined) => number | undefined) | undefined;
  } = {},
): Poll<T> {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<{
    key: string;
    data?: T;
    error?: string;
    fetching: boolean;
  }>({ key, fetching: false });
  const [tick, setTick] = useState(0);
  const latest = useRef({ read, interval: options.interval });
  latest.current = { read, interval: options.interval };
  const generation = useRef(0);
  useEffect(() => {
    if (!enabled) {
      generation.current += 1;
      setState({ key, fetching: false });
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const run = () => {
      const current = ++generation.current;
      setState((previous) => ({
        ...(previous.key === key ? previous : { key }),
        fetching: true,
      }));
      latest.current.read().then(
        (data) => {
          if (generation.current !== current) return;
          setState({ key, data, fetching: false });
          schedule(data);
        },
        (cause: unknown) => {
          if (generation.current !== current) return;
          setState({ key, error: messageOf(cause), fetching: false });
          schedule(undefined);
        },
      );
    };
    const schedule = (data: T | undefined) => {
      if (stopped) return;
      const { interval } = latest.current;
      const delay = typeof interval === "function" ? interval(data) : interval;
      if (delay !== undefined) timer = setTimeout(run, delay);
    };
    run();
    return () => {
      stopped = true;
      generation.current += 1;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [key, enabled, tick]);
  const refresh = useCallback(() => setTick((count) => count + 1), []);
  const current: typeof state =
    state.key === key ? state : { key, fetching: enabled };
  return {
    data: current.data,
    error: current.error,
    fetching: current.fetching,
    refresh,
  };
}
