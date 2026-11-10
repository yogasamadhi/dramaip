import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "@dramaip/infra-ui-primitives";
import type { Translate } from "./remote.ts";

interface Request {
  description: string;
  danger: boolean;
  resolve: (accepted: boolean) => void;
}

/** Descriptions that ask for an irreversible or replacing step. */
const DESTRUCTIVE = /删除|撤销|替换|放弃|回收站|否决/;

/**
 * One in-page confirmation at a time: `ask` opens it with a description and
 * resolves with the author's answer; a newer question declines the older.
 * A description naming a destructive step asks as a dangerous one.
 * @param t - the confirmation copy.
 * @returns the dialog to render, and `ask`.
 */
export function useConfirm(t: Translate): {
  dialog: ReactNode;
  ask: (
    description: string,
    options?: { danger?: boolean },
  ) => Promise<boolean>;
} {
  const [request, setRequest] = useState<Request>();
  const current = useRef<Request>();
  const ask = useCallback(
    (description: string, options: { danger?: boolean } = {}) =>
      new Promise<boolean>((resolve) => {
        current.current?.resolve(false);
        const next = {
          description,
          danger: Boolean(options.danger) || DESTRUCTIVE.test(description),
          resolve,
        };
        current.current = next;
        setRequest(next);
      }),
    [],
  );
  const finish = (accepted: boolean) => {
    request?.resolve(accepted);
    current.current = undefined;
    setRequest(undefined);
  };
  return {
    ask,
    dialog: (
      <Modal
        open={Boolean(request)}
        onClose={() => finish(false)}
        title={t(request?.danger ? "confirm.titleDanger" : "confirm.title")}
        description={request?.description ?? ""}
        closeLabel={t("confirm.cancel")}
        footer={
          <>
            <Button variant="ghost" onClick={() => finish(false)}>
              {t("confirm.cancel")}
            </Button>
            <Button variant="primary" onClick={() => finish(true)}>
              {t(request?.danger ? "confirm.continue" : "confirm.accept")}
            </Button>
          </>
        }
      />
    ),
  };
}
