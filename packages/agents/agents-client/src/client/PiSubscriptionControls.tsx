import { useEffect, useId, useState } from "react";
import { Button } from "@dramaip/infra-ui-primitives";
import type { TranslateNS } from "@dramaip/infra-ui-slots";
import { messageOf, value, type SystemRemote } from "./ai-settings.ts";
import css from "./AiSection.module.css";

type Remote = SystemRemote["piSubscription"];
type Status = Extract<Awaited<ReturnType<Remote>>, { ok: true }>["value"];
type Action = Parameters<Remote>[1];
type Answer = Parameters<Remote>[2];
type Translate = TranslateNS<"agents">;

export function usePiSubscription(system: SystemRemote, provider?: string) {
  const [state, setState] = useState<{ provider: string; status: Status }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!provider) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await value<Status>(
          system.piSubscription(provider, "status", undefined),
        );
        if (!active) return;
        setState({ provider, status });
        if (status.pending) timer = setTimeout(() => void poll(), 750);
      } catch (cause) {
        if (active) {
          setState(undefined);
          setError(messageOf(cause));
        }
      }
    };
    setError(undefined);
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [provider, revision, system]);

  const perform = async (action: Action, answer?: Answer) => {
    if (!provider || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const status = await value<Status>(
        system.piSubscription(provider, action, answer),
      );
      setState({ provider, status });
      setRevision((current) => current + 1);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  return {
    status: state?.provider === provider ? state?.status : undefined,
    busy,
    error,
    perform,
    open: (url: string) =>
      void value(system.openExternal(url)).catch((cause: unknown) =>
        setError(messageOf(cause)),
      ),
    async copy(code: string) {
      try {
        await navigator.clipboard.writeText(code);
      } catch (cause) {
        setError(messageOf(cause));
      }
    },
  };
}

type Interaction = ReturnType<typeof usePiSubscription>;

function Notice({
  t,
  event,
  open,
  copy,
}: {
  t: Translate;
  event: Status["notices"][number];
  open: Interaction["open"];
  copy: Interaction["copy"];
}) {
  const link = (url: string, label: string) => (
    <Button size="sm" variant="outline" onClick={() => open(url)}>
      {label}
    </Button>
  );
  switch (event.type) {
    case "auth_url":
      return (
        <div className={css.row}>
          {link(event.url, t("providers.pi.openBrowser"))}
          {event.instructions && (
            <span className={css.small}>{event.instructions}</span>
          )}
        </div>
      );
    case "device_code":
      return (
        <div className={css.row}>
          <span>{t("providers.pi.deviceCode")}</span>
          <code>{event.userCode}</code>
          {event.copyCodeOnConfirm !== false && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy(event.userCode)}
            >
              {t("providers.pi.copyCode")}
            </Button>
          )}
          {event.openBrowserOnConfirm === false ? (
            <span>{event.verificationUri}</span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (event.copyCodeOnConfirm !== false)
                  void copy(event.userCode);
                open(event.verificationUri);
              }}
            >
              {t("providers.pi.openBrowser")}
            </Button>
          )}
        </div>
      );
    case "info":
      return (
        <div className={css.row}>
          <span>{event.message}</span>
          {event.links?.map(({ url, label }) => (
            <span key={url}>{link(url, label ?? url)}</span>
          ))}
        </div>
      );
    case "progress":
      return <p className={css.small}>{event.message}</p>;
  }
}

function Prompt({
  t,
  prompt,
  busy,
  answer,
}: {
  t: Translate;
  prompt: NonNullable<Status["prompt"]>;
  busy: boolean;
  answer: (value: string) => void;
}) {
  const labelId = useId();
  const [input, setInput] = useState("");
  if (prompt.type === "select")
    return (
      <div aria-labelledby={labelId} role="group">
        <p id={labelId}>{prompt.message}</p>
        <div className={css.row}>
          {prompt.options?.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant="outline"
              disabled={busy}
              title={option.description}
              onClick={() => answer(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    );
  const manual = prompt.type === "manual_code";
  const form = (
    <form
      className={css.row}
      onSubmit={(event) => {
        event.preventDefault();
        answer(input);
      }}
    >
      <label className={css.field}>
        {manual ? t("providers.pi.code") : prompt.message}
        <input
          className={css.control}
          type={prompt.type === "text" ? "text" : "password"}
          autoComplete="off"
          placeholder={prompt.placeholder}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </label>
      <Button
        size="sm"
        variant="outline"
        type="submit"
        disabled={busy || (prompt.type !== "text" && !input.trim())}
      >
        {t("providers.pi.submit")}
      </Button>
    </form>
  );
  return manual ? (
    <details>
      <summary>{t("providers.pi.manual")}</summary>
      {form}
    </details>
  ) : (
    form
  );
}

export function PiSubscriptionControls({
  t,
  subscription,
  loginLabel,
}: {
  t: Translate;
  subscription: Interaction;
  loginLabel?: string | undefined;
}) {
  const { status, busy, error, perform, open, copy } = subscription;
  const prompt = status?.prompt;
  return (
    <div className={css.editing}>
      <div className={css.row}>
        <span role="status">
          {t(
            status?.pending
              ? "providers.pi.pending"
              : status?.signedIn
                ? "providers.pi.connected"
                : "providers.pi.signedOut",
          )}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void perform(status?.pending ? "cancel" : "start")}
        >
          {status?.pending
            ? t("ai.cancel")
            : status?.signedIn
              ? t("providers.pi.reauthorize")
              : (loginLabel ?? t("providers.pi.signIn"))}
        </Button>
        {status?.signedIn && !status.pending && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void perform("logout")}
          >
            {t("providers.pi.signOut")}
          </Button>
        )}
      </div>
      {status?.notices.map((event) => (
        <Notice key={event.type} t={t} event={event} open={open} copy={copy} />
      ))}
      {prompt && (
        <Prompt
          key={prompt.id}
          t={t}
          prompt={prompt}
          busy={busy}
          answer={(value) =>
            void perform("answer", { promptId: prompt.id, value })
          }
        />
      )}
      {status?.signedIn && !status.pending && !status.modelIds.length && (
        <p className={css.small}>{t("providers.pi.noModels")}</p>
      )}
      {(error || status?.failed) && (
        <p className={css.danger} role="alert">
          {error ??
            (status?.failureReason === "exchange" && status.exchangeStatus
              ? t("providers.pi.failed.exchange", {
                  status: status.exchangeStatus,
                })
              : status?.failureReason === "network"
                ? t("providers.pi.failed.network")
                : status?.failureReason === "storage"
                  ? t("providers.pi.failed.storage")
                  : t("providers.pi.failed"))}
        </p>
      )}
    </div>
  );
}
