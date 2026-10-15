import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  InlineNotice,
  Input,
  Textarea,
  NativeSelect,
} from "@dramaip/ui-shared";
import { useMemo, useState } from "react";
import { useStudioClient } from "../../runtime-connection";

type Field = {
  id: string;
  label: string;
  type: "boolean" | "number" | "select" | "text" | "textarea";
  required?: boolean;
  options?: string[];
};

type Contribution = {
  pluginId: string;
  id: string;
  kind: "command" | "form" | "menu" | "panel" | "settings" | "table";
  slot:
    | "project.tools"
    | "settings.extensions"
    | "shell.commands"
    | "workspace.panels";
  title: string;
  description?: string;
  icon?: "box" | "command" | "file" | "settings" | "sparkles";
  command?: string;
  fields?: Field[];
  columns?: string[];
};

const KINDS = new Set([
  "command",
  "form",
  "menu",
  "panel",
  "settings",
  "table",
]);
const SLOTS = new Set([
  "project.tools",
  "settings.extensions",
  "shell.commands",
  "workspace.panels",
]);

function safeContribution(value: unknown): Contribution | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const item = value as Record<string, unknown>;
  if (
    typeof item.pluginId !== "string" ||
    typeof item.id !== "string" ||
    typeof item.kind !== "string" ||
    !KINDS.has(item.kind) ||
    typeof item.slot !== "string" ||
    !SLOTS.has(item.slot) ||
    typeof item.title !== "string" ||
    item.title.length > 100 ||
    (item.description !== undefined &&
      (typeof item.description !== "string" ||
        item.description.length > 500)) ||
    (item.command !== undefined && typeof item.command !== "string")
  )
    return undefined;
  return item as unknown as Contribution;
}

export default function DeclarativeExtensionUi(props: {
  slot: Contribution["slot"];
}) {
  const client = useStudioClient();
  const contributions = useQuery({
    queryKey: ["extensions", "ui-contributions"],
    queryFn: client.extensions.uiContributions,
  });
  const safe = useMemo(
    () =>
      (contributions.data ?? [])
        .map(safeContribution)
        .filter((item): item is Contribution => Boolean(item))
        .filter((item) => item.slot === props.slot),
    [contributions.data, props.slot],
  );
  if (!safe.length) return null;
  return (
    <section
      className="mt-5 grid gap-3 lg:grid-cols-2"
      aria-label="隔离扩展贡献"
    >
      {safe.map((contribution) => (
        <DeclarativeContribution
          key={`${contribution.pluginId}:${contribution.id}`}
          contribution={contribution}
        />
      ))}
    </section>
  );
}

function DeclarativeContribution(props: { contribution: Contribution }) {
  const client = useStudioClient();
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [result, setResult] = useState<string>();
  const invoke = useMutation({
    mutationFn: () => {
      if (!props.contribution.command)
        return Promise.reject(new Error("该声明式视图没有授权命令"));
      return client.extensions.invokeCommand(
        props.contribution.pluginId,
        props.contribution.command,
        values,
      );
    },
    onSuccess: (value) =>
      setResult(JSON.stringify(value, null, 2).slice(0, 4_000)),
    onError: (error) =>
      setResult(error instanceof Error ? error.message : String(error)),
  });
  return (
    <article className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <p className="studio-eyebrow">隔离扩展 · {props.contribution.pluginId}</p>
      <h3 className="mt-1 font-semibold">{props.contribution.title}</h3>
      {props.contribution.description ? (
        <p className="mt-1 text-sm text-muted">
          {props.contribution.description}
        </p>
      ) : null}
      <div className="mt-3 space-y-3">
        {(props.contribution.fields ?? []).map((field) => (
          <label key={field.id} className="grid gap-1 text-sm text-muted">
            {field.label}
            {field.type === "textarea" ? (
              <Textarea
                required={field.required}
                value={String(values[field.id] ?? "")}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.id]: event.target.value,
                  }))
                }
              />
            ) : field.type === "boolean" ? (
              <input
                type="checkbox"
                checked={values[field.id] === true}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.id]: event.target.checked,
                  }))
                }
              />
            ) : field.type === "select" ? (
              <NativeSelect
                className="w-auto"
                value={String(values[field.id] ?? "")}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.id]: event.target.value,
                  }))
                }
              >
                <option value="">请选择</option>
                {(field.options ?? []).map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                type={field.type === "number" ? "number" : "text"}
                required={field.required}
                value={String(values[field.id] ?? "")}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.id]: event.target.value,
                  }))
                }
              />
            )}
          </label>
        ))}
      </div>
      {props.contribution.kind === "table" &&
      props.contribution.columns?.length ? (
        <div className="mt-3 overflow-auto rounded-md border border-line">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                {props.contribution.columns.map((column) => (
                  <th key={column} className="px-3 py-2">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
      ) : null}
      {props.contribution.command ? (
        <Button
          className="mt-3"
          size="sm"
          disabled={invoke.isPending}
          onClick={() => invoke.mutate()}
        >
          {invoke.isPending ? "正在执行…" : "执行扩展命令"}
        </Button>
      ) : null}
      {result ? (
        <InlineNotice className="mt-3">
          <pre className="whitespace-pre-wrap text-xs">{result}</pre>
        </InlineNotice>
      ) : null}
    </article>
  );
}
