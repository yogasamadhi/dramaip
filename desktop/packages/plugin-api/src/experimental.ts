/** APIs in this module may change before the next public plugin SDK major. */
export interface ExperimentalPluginReload {
  readonly revision: string;
  reload(): Promise<void>;
}
