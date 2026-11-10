import { useCallback, useState } from "react";
import { Button, Modal } from "@dramaip/infra-ui-primitives";
import type { Translate } from "../task-config/copy.ts";
import css from "./Inspiration.module.css";

/** One field of a form dialog. */
export interface DialogField {
  name: string;
  label: string;
  kind: "text" | "textarea" | "select";
  initial?: string | undefined;
  options?: readonly { value: string; label: string }[];
}

interface Request {
  title: string;
  description?: string | undefined;
  fields: readonly DialogField[];
  resolve: (values: Record<string, string> | undefined) => void;
}

/**
 * A modal that asks either a yes or no question or a short form, one at a
 * time. `confirm` resolves `true` on accept; `form` resolves the trimmed
 * values, or `undefined` when cancelled.
 * @param t - the copy.
 */
export function useDialog(t: Translate) {
  const [request, setRequest] = useState<Request>();
  const [values, setValues] = useState<Record<string, string>>({});
  const form = useCallback(
    (input: Omit<Request, "resolve">) =>
      new Promise<Record<string, string> | undefined>((resolve) => {
        setValues(
          Object.fromEntries(
            input.fields.map((field) => [field.name, field.initial ?? ""]),
          ),
        );
        setRequest({ ...input, resolve });
      }),
    [],
  );
  const confirm = useCallback(
    async (description: string) =>
      Boolean(
        await form({ title: t("confirm.title"), description, fields: [] }),
      ),
    [form, t],
  );
  const finish = (accepted: boolean) => {
    request?.resolve(
      accepted
        ? Object.fromEntries(
            Object.entries(values).map(([name, value]) => [name, value.trim()]),
          )
        : undefined,
    );
    setRequest(undefined);
  };
  const dialog = (
    <Modal
      open={Boolean(request)}
      onClose={() => finish(false)}
      title={request?.title ?? ""}
      description={request?.description ?? ""}
      closeLabel={t("confirm.close")}
      footer={
        <>
          <Button variant="ghost" onClick={() => finish(false)}>
            {t("confirm.cancel")}
          </Button>
          <Button variant="primary" onClick={() => finish(true)}>
            {t("confirm.accept")}
          </Button>
        </>
      }
    >
      {request?.fields.length ? (
        <div className={css.formFields}>
          {request.fields.map((field, index) => {
            const common = {
              id: `inspiration-dialog-${field.name}`,
              value: values[field.name] ?? "",
              "data-modal-autofocus": index === 0 ? true : undefined,
            };
            const change = (next: string) =>
              setValues((current) => ({ ...current, [field.name]: next }));
            return (
              <label key={field.name} className={css.field}>
                {field.label}
                {field.kind === "textarea" ? (
                  <textarea
                    {...common}
                    className={css.textarea}
                    onChange={(event) => change(event.target.value)}
                  />
                ) : field.kind === "select" ? (
                  <select
                    {...common}
                    className={css.select}
                    onChange={(event) => change(event.target.value)}
                  >
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...common}
                    className={css.input}
                    onChange={(event) => change(event.target.value)}
                  />
                )}
              </label>
            );
          })}
        </div>
      ) : null}
    </Modal>
  );
  return { form, confirm, dialog };
}
