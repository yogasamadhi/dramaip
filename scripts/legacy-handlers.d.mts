/** A Kernel-era plugin handler a domain Host package carries. */
export interface LegacyHandler {
  readonly id: string;
  /** Relative to the desktop root. */
  readonly directory: string;
}
export function legacyHandlers(root: string): LegacyHandler[];
export function legacyHandlerDirectory(root: string, id: string): string;
