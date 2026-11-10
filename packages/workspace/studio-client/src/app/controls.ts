/**
 * The Studio app's bindings of the shared controls: their localized texts and
 * the confirm wording rule.
 */
import {
  confirmDialog as presentConfirm,
  type ConfirmDialogOptions,
  type ControlLabels,
} from "@dramaip/infra-ui-primitives";
import { copyText } from "./copy";

/** The shared controls' texts in the active language. */
export function controlLabels(): ControlLabels {
  return {
    close: copyText("app/controls.close"),
    closeDrawer: copyText("app/controls.closeDrawer"),
    dismiss: copyText("app/controls.dismiss"),
    notification: copyText("app/controls.notification"),
    notifications: copyText("app/controls.notifications"),
    loading: copyText("app/controls.loading"),
    confirmTitle: copyText("app/controls.confirmTitle"),
    confirm: copyText("app/controls.confirm"),
    cancel: copyText("app/controls.cancel"),
    dangerTitle: copyText("app/controls.dangerTitle"),
    dangerConfirm: copyText("app/controls.dangerConfirm"),
  };
}

/** Wording that marks an action as destructive when no tone is given. */
const DESTRUCTIVE = /删除|撤销|替换|放弃|回收站|否决/;

/**
 * Ask the user to confirm an action; a description that deletes, reverts,
 * replaces or discards work confirms with the danger texts.
 * @returns true when the user confirms.
 */
export function confirmDialog(
  value: string | ConfirmDialogOptions,
): Promise<boolean> {
  const options = typeof value === "string" ? { description: value } : value;
  return presentConfirm(
    options.tone === undefined && DESTRUCTIVE.test(options.description)
      ? { ...options, tone: "danger" }
      : options,
  );
}
