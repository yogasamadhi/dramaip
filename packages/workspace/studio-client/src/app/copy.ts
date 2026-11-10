import { zh } from "./locale";

/** A key of the Studio copy. */
export type StudioCopyKey = keyof typeof zh;

type Translate = (
  key: StudioCopyKey,
  params?: Record<string, unknown>,
) => string;

let translate: Translate | undefined;

/**
 * Read copy through the locale service from now on (the client entry binds
 * the `studio` namespace); unbound, as in tests, the Chinese copy answers.
 * @param t - the namespace's translate function.
 * @returns the unbind function.
 */
export function bindStudioCopy(t: Translate): () => void {
  translate = t;
  return () => {
    if (translate === t) translate = undefined;
  };
}

/**
 * The text of one copy key in the active language, with its `{name}`
 * placeholders filled from `params`.
 */
export function copyText(
  key: StudioCopyKey,
  params?: Record<string, unknown>,
): string {
  if (translate) return translate(key, params);
  const template: string = zh[key];
  return params
    ? template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      )
    : template;
}
