import { useCallback, useEffect, useRef, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import type {} from "@dramaip/agents-agents/remote";
import type {} from "@dramaip/insights-insights/remote";

/** The `insights` Remote namespace. */
export type InsightsRemote = Context["remote"]["insights"];
/** The `agents` Remote namespace, whose usage observations a run shows. */
export type AgentsRemote = Context["remote"]["agents"];
/** Copy of the insights namespace. */
export type Translate = TranslateNS<"insights">;

/** A Remote answer: the value, or the failure's message. */
type Answer =
  { ok: true; value: unknown } | { ok: false; error: { message: string } };

/**
 * The value of a Remote answer, or the failure as an `Error`.
 * @param answer - pending Remote answer.
 * @returns its value, typed as the caller reads it.
 */
export async function value<T>(answer: Promise<Answer>): Promise<T> {
  const result = await answer;
  if (!result.ok) throw new Error(result.error.message);
  return result.value as T;
}

/**
 * A failure's message.
 * @param cause - what was thrown.
 */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** One read's state: the latest value, its failure and whether it runs. */
export interface Read<T> {
  data: T | undefined;
  error: string | undefined;
  /** A read is running. */
  pending: boolean;
  /** Read again. */
  refresh: () => void;
  /** Drop the value and stop the running read. */
  reset: () => void;
}

/**
 * Read once `enabled` is true and again on `refresh`. A newer read drops the
 * answer of an older one; a failure drops the previous value, so nothing
 * unverified stays on screen.
 * @param read - the read.
 * @param enabled - whether to read at all.
 */
export function useRead<T>(read: () => Promise<T>, enabled = true): Read<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  const latest = useRef(read);
  latest.current = read;
  const generation = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const current = ++generation.current;
    setPending(true);
    latest.current().then(
      (next) => {
        if (generation.current !== current) return;
        setData(next);
        setError(undefined);
        setPending(false);
      },
      (cause: unknown) => {
        if (generation.current !== current) return;
        setData(undefined);
        setError(messageOf(cause));
        setPending(false);
      },
    );
  }, [enabled, tick]);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const refresh = useCallback(() => setTick((count) => count + 1), []);
  const reset = useCallback(() => {
    generation.current += 1;
    setData(undefined);
    setError(undefined);
    setPending(false);
  }, []);
  return { data, error, pending, refresh, reset };
}

/** A paged read: the pages so far, and the next one on demand. */
export interface Paged<P> {
  pages: readonly P[];
  error: string | undefined;
  /** The first page is being read, or a refresh. */
  pending: boolean;
  /** A later page is being read. */
  pendingMore: boolean;
  /** A later page exists. */
  hasMore: boolean;
  /** Read the first page again, dropping the later ones. */
  refresh: () => void;
  /** Read the next page. */
  more: () => void;
}

/**
 * Read the first page once `enabled` is true, then each next page on demand.
 * @param read - read the page after `cursor`, or the first page.
 * @param next - the cursor after a page, or `undefined` on the last.
 * @param enabled - whether to read at all.
 */
export function usePaged<P, C>(
  read: (cursor: C | undefined) => Promise<P>,
  next: (page: P) => C | undefined,
  enabled = true,
): Paged<P> {
  const [pages, setPages] = useState<readonly P[]>([]);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [pendingMore, setPendingMore] = useState(false);
  const [tick, setTick] = useState(0);
  const latest = useRef({ read, next });
  latest.current = { read, next };
  const generation = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const current = ++generation.current;
    setPending(true);
    setPendingMore(false);
    latest.current.read(undefined).then(
      (page) => {
        if (generation.current !== current) return;
        setPages([page]);
        setError(undefined);
        setPending(false);
      },
      (cause: unknown) => {
        if (generation.current !== current) return;
        setPages([]);
        setError(messageOf(cause));
        setPending(false);
      },
    );
  }, [enabled, tick]);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const last = pages.at(-1);
  const cursor = last === undefined ? undefined : latest.current.next(last);
  const more = () => {
    if (cursor === undefined || pendingMore) return;
    const current = generation.current;
    setPendingMore(true);
    latest.current.read(cursor).then(
      (page) => {
        if (generation.current !== current) return;
        setPages((previous) => [...previous, page]);
        setPendingMore(false);
      },
      (cause: unknown) => {
        if (generation.current !== current) return;
        setError(messageOf(cause));
        setPendingMore(false);
      },
    );
  };
  return {
    pages,
    error,
    pending,
    pendingMore,
    hasMore: cursor !== undefined,
    refresh: () => setTick((count) => count + 1),
    more,
  };
}

/**
 * A ratio as a percentage with one decimal.
 * @param ratio - a ratio between 0 and 1.
 */
export const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

/**
 * A recorded time, in the reader's locale.
 * @param at - an ISO time.
 */
export const when = (at: string) => new Date(at).toLocaleString();

/**
 * A duration in seconds, or the clock's failure.
 * @param t - copy.
 * @param ms - milliseconds, or `null` when the clock was inconsistent.
 */
export const seconds = (t: Translate, ms: number | null) =>
  ms === null
    ? t("outcomes.duration.unknown")
    : t("outcomes.duration.seconds", { value: (ms / 1000).toFixed(1) });

/** A requested model configuration, as the run recorded it. */
export type RecordedModel =
  | {
      status: "recorded";
      modelId: string;
      providerId?: string;
      profileId?: string;
    }
  | { status: "unrecorded" }
  | { status: "invalid" };
