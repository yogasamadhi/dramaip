import { useCallback, useState } from "react";
import { Button, Modal } from "@dramaip/infra-ui-primitives";

/** The copy a confirmation reads. */
export interface ConfirmCopy {
  title: string;
  cancel: string;
  /** The dialog's close button, apart from the cancel action. */
  close: string;
  accept: string;
}

/**
 * One confirmation at a time: `ask` opens it and resolves with the answer;
 * `dialog` is rendered once by the tool.
 */
export function useConfirm(copy: ConfirmCopy) {
  const [request, setRequest] = useState<{
    description: string;
    resolve: (accepted: boolean) => void;
  }>();
  const ask = useCallback(
    (description: string) =>
      new Promise<boolean>((resolve) => setRequest({ description, resolve })),
    [],
  );
  const finish = (accepted: boolean) => {
    request?.resolve(accepted);
    setRequest(undefined);
  };
  const dialog = (
    <Modal
      open={Boolean(request)}
      onClose={() => finish(false)}
      title={copy.title}
      description={request?.description ?? ""}
      closeLabel={copy.close}
      footer={
        <>
          <Button variant="ghost" onClick={() => finish(false)}>
            {copy.cancel}
          </Button>
          <Button variant="primary" onClick={() => finish(true)}>
            {copy.accept}
          </Button>
        </>
      }
    />
  );
  return { ask, dialog };
}
