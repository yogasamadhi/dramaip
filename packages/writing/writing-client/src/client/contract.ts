/**
 * Factory contract of the writing client: the narrative context picker, which
 * any domain client renders where an AI run is explicitly given prior text,
 * higher summaries and narrative declarations.
 * @module @dramaip/writing-writing-client/client/contract
 */
import type {} from "@dramaip/infra-ui-slots";
import type {
  ContextPickerProps,
  ContextPickerRemotes,
} from "./context/ContextPicker.tsx";
import type { zh } from "./context/locale.ts";

export type { ContextPickerProps } from "./context/ContextPicker.tsx";
export type {
  Chapter,
  ContextChapterSelection,
  NarrativeContextRequest,
  NarrativeStorySelection,
} from "./context/types.ts";

declare module "@dramaip/infra-ui-slots" {
  interface LocaleNamespaceMap {
    /** The narrative context picker. */
    narrative: keyof typeof zh;
  }
  interface SlotFactoryMap {
    /** The sources one AI run is explicitly given, scoped by its props. */
    "writing.context-picker": {
      scope: "root";
      props: ContextPickerProps;
      inject: ContextPickerRemotes;
      locale: "narrative";
    };
  }
}
