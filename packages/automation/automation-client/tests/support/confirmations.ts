import type { Translate } from "../../src/client/confirmations/remote.ts";
import { failureText } from "../../src/client/confirmations/remote.ts";
import { zh } from "../../src/client/locale.ts";

/** A Remote answer carrying `value`. */
export const ok = <T>(value: T) =>
  Promise.resolve({ ok: true as const, value });

/** A failed Remote answer. */
export const failed = (message: string) =>
  Promise.resolve({ ok: false as const, error: { message } });

/** The Chinese copy, interpolated as the locale runtime does. */
export const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as Translate;

/**
 * A read whose failure is rethrown with the text it is shown with.
 * @param read - the read.
 */
export const shown = <T>(read: Promise<T>): Promise<T> =>
  read.catch((cause: unknown) => {
    throw new Error(failureText(t, cause));
  });
