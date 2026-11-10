import { useEffect, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { PropsLocale, PropsRuntime } from "@dramaip/infra-ui-slots";
import { Button, Modal } from "@dramaip/infra-ui-primitives";
import type {} from "@dramaip/infra-ui-settings/client";
import type { BackupsListResult } from "@dramaip/workspace-workspace/types";
import type {} from "@dramaip/workspace-workspace/remote";
import css from "./BackupSection.module.css";

/** Injected face: the `workspace` Remote namespace, and how to start over. */
export interface BackupSectionInjected {
  workspace: Context["remote"]["workspace"];
  /** Reload the app once a restore replaced its data. */
  reload: () => void;
}

/** Full component props of the backup settings section. */
export type BackupSectionProps = PropsRuntime<"settings.section"> &
  PropsLocale<"workspace"> &
  BackupSectionInjected;

type Backup = BackupsListResult[number];

/**
 * The local backups: create one, list them newest first, and restore one
 * after a confirmation. A restore replaces the current database, so the app
 * reloads to read its data again.
 */
export function BackupSection({ workspace, reload, t }: BackupSectionProps) {
  const [backups, setBackups] = useState<readonly Backup[]>([]);
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState<"create" | "restore">();
  const [confirming, setConfirming] = useState<Backup>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    void workspace.backupsList().then((result) => {
      if (!live) return;
      if (result.ok) setBackups(result.value);
      else setError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [workspace, revision]);
  const create = async () => {
    setWorking("create");
    setError(undefined);
    const result = await workspace.backupsCreate(
      undefined,
      crypto.randomUUID(),
    );
    setWorking(undefined);
    if (result.ok) setRevision((value) => value + 1);
    else setError(result.error.message);
  };
  const restore = async (backup: Backup) => {
    setConfirming(undefined);
    setWorking("restore");
    setError(undefined);
    const result = await workspace.backupsRestore(
      backup.id,
      undefined,
      crypto.randomUUID(),
    );
    setWorking(undefined);
    if (result.ok) reload();
    else setError(result.error.message);
  };
  const size = (bytes: number) =>
    bytes < 1024 * 1024
      ? t("backup.size.kb", { size: Math.max(1, Math.round(bytes / 1024)) })
      : t("backup.size.mb", { size: (bytes / (1024 * 1024)).toFixed(1) });
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <section className={css.card}>
      <div className={css.head}>
        <div>
          <h2 className={css.title}>{t("backup.title")}</h2>
          <p className={css.muted}>{t("backup.description")}</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={working !== undefined}
          onClick={() => void create()}
        >
          {t(working === "create" ? "backup.creating" : "backup.create")}
        </Button>
      </div>
      {error !== undefined && (
        <p className={css.danger}>{t("backup.failed", { message: error })}</p>
      )}
      <div className={css.list}>
        {backups.map((backup) => (
          <div key={backup.id} className={css.item}>
            <div>
              <p className={css.name}>{backup.name}</p>
              <p className={css.small}>
                {t("backup.meta", {
                  date: date.format(new Date(backup.createdAt)),
                  size: size(backup.size),
                })}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={working !== undefined}
              onClick={() => setConfirming(backup)}
            >
              {t(working === "restore" ? "backup.restoring" : "backup.restore")}
            </Button>
          </div>
        ))}
        {!backups.length && error === undefined && (
          <p className={css.muted}>{t("backup.empty")}</p>
        )}
      </div>
      <Modal
        open={confirming !== undefined}
        onClose={() => setConfirming(undefined)}
        title={t("backup.confirm.title")}
        description={t("backup.confirm.description")}
        closeLabel={t("backup.confirm.close")}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirming(undefined)}>
              {t("backup.confirm.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => confirming && void restore(confirming)}
            >
              {t("backup.confirm.restore")}
            </Button>
          </>
        }
      />
    </section>
  );
}
