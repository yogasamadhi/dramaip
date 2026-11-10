import { useEffect, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { PropsLocale, PropsRuntime } from "@dramaip/infra-ui-slots";
import { Button } from "@dramaip/infra-ui-primitives";
import type {} from "@dramaip/infra-ui-settings/client";
import type { JsonValue } from "@dramaip/infra-values";
import type { SystemDiagnostics } from "@dramaip/system-system/types";
import type {} from "@dramaip/system-system/remote";
import css from "./DiagnosticsSection.module.css";

/** Injected face: the `system` Remote namespace. */
export interface DiagnosticsSectionInjected {
  system: Context["remote"]["system"];
}

/** Full component props of the diagnostics section. */
export type DiagnosticsSectionProps = PropsRuntime<"settings.section"> &
  PropsLocale<"system"> &
  DiagnosticsSectionInjected;

const count = (value: JsonValue | undefined): number =>
  Array.isArray(value) ? value.length : 0;

function hostHealthy(report: SystemDiagnostics): boolean {
  const host = report.host;
  return (
    typeof host === "object" &&
    host !== null &&
    !Array.isArray(host) &&
    host.healthy === true
  );
}

/**
 * Collect the redacted runtime diagnostics, show their summary and export
 * them through the Host's save dialog, beside the credential vault state.
 */
export function DiagnosticsSection({ system, t }: DiagnosticsSectionProps) {
  const [vault, setVault] = useState<boolean>();
  const [report, setReport] = useState<SystemDiagnostics>();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    let live = true;
    void system.credentialStatus().then((result) => {
      if (live) setVault(result.ok && result.value.available);
    });
    return () => {
      live = false;
    };
  }, [system]);
  const run = async (action: () => Promise<string | undefined>) => {
    setWorking(true);
    setNotice(undefined);
    try {
      setNotice(await action());
    } finally {
      setWorking(false);
    }
  };
  const collect = () =>
    run(async () => {
      const result = await system.diagnostics();
      if (!result.ok)
        return t("diagnostics.failed", { message: result.error.message });
      setReport(result.value);
      return undefined;
    });
  const exportReport = (value: SystemDiagnostics) =>
    run(async () => {
      const result = await system.saveTextFile({
        suggestedName: t("diagnostics.fileName"),
        content: JSON.stringify(value, null, 2),
      });
      if (!result.ok)
        return t("diagnostics.failed", { message: result.error.message });
      return t(
        result.value.saved ? "diagnostics.exported" : "diagnostics.cancelled",
      );
    });
  const vaultState =
    vault === undefined
      ? t("diagnostics.vault.checking")
      : t(
          vault
            ? "diagnostics.vault.available"
            : "diagnostics.vault.unavailable",
        );
  return (
    <section className={css.card}>
      <div className={css.head}>
        <div>
          <h2 className={css.title}>{t("diagnostics.title")}</h2>
          <p className={css.muted}>{t("diagnostics.description")}</p>
        </div>
        <div className={css.actions}>
          {report && (
            <Button
              variant="outline"
              size="sm"
              disabled={working}
              onClick={() => void exportReport(report)}
            >
              {t("diagnostics.export")}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={working}
            onClick={() => void collect()}
          >
            {t(working ? "diagnostics.collecting" : "diagnostics.collect")}
          </Button>
        </div>
      </div>
      <p className={css.line}>
        {t("diagnostics.vault", { state: vaultState })}
      </p>
      {report && (
        <dl className={css.summary} aria-label={t("diagnostics.summary")}>
          <div>
            <dt className={css.term}>{t("diagnostics.plugins")}</dt>
            <dd className={css.value}>{count(report.plugins)}</dd>
          </div>
          <div>
            <dt className={css.term}>{t("diagnostics.migrations")}</dt>
            <dd className={css.value}>{count(report.migrations)}</dd>
          </div>
          <div>
            <dt className={css.term}>{t("diagnostics.consumers")}</dt>
            <dd className={css.value}>{count(report.eventConsumers)}</dd>
          </div>
          <div>
            <dt className={css.term}>{t("diagnostics.host")}</dt>
            <dd className={css.value}>
              {t(
                hostHealthy(report)
                  ? "diagnostics.host.healthy"
                  : "diagnostics.host.unavailable",
              )}
            </dd>
          </div>
        </dl>
      )}
      {notice && <p className={css.muted}>{notice}</p>}
    </section>
  );
}
