import type { TranslateNS } from "@dramaip/infra-ui-slots";
import { zh } from "../../src/client/locale.ts";

/** The Chinese copy, interpolated as the locale runtime does. */
export const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params?.[name]),
  )) as unknown as TranslateNS<"insights">;
