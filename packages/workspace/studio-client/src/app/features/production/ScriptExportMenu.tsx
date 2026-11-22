import type { ScreenplayExportFormat } from "@dramaip/contracts/production";
import { BareButton } from "@dramaip/infra-ui-primitives";
import { useState } from "react";
import { copyText } from "../../copy";
import { useStudio } from "../../studio-shared";
import styles from "./ScriptExportMenu.module.css";

/** The formats offered, in menu order. */
const FORMATS: readonly ScreenplayExportFormat[] = [
  "docx",
  "fountain",
  "fdx",
  "json",
];

const label = (format: ScreenplayExportFormat) =>
  format === "docx"
    ? copyText("app/features/production/ScriptExportMenu.2")
    : format === "fountain"
      ? copyText("app/features/production/ScriptExportMenu.3")
      : format === "fdx"
        ? copyText("app/features/production/ScriptExportMenu.4")
        : copyText("app/features/production/ScriptExportMenu.5");

/**
 * 「导出剧本」: saves the script as Word, Fountain, Final Draft or JSON,
 * asking where to save it.
 */
export function ScriptExportMenu(props: { scriptId: string }) {
  const client = useStudio();
  const [busy, setBusy] = useState<ScreenplayExportFormat>();
  const [notice, setNotice] = useState<{ ok: boolean; text: string }>();
  const save = async (format: ScreenplayExportFormat) => {
    setBusy(format);
    setNotice(undefined);
    try {
      const result = await client.screenplays.saveExport(
        props.scriptId,
        format,
      );
      setNotice(
        result.saved
          ? {
              ok: true,
              text: copyText("app/features/production/ScriptExportMenu.6", {
                p1: result.fileName,
              }),
            }
          : {
              ok: true,
              text: copyText("app/features/production/ScriptExportMenu.7"),
            },
      );
    } catch (error) {
      setNotice({
        ok: false,
        text: copyText("app/features/production/ScriptExportMenu.8", {
          p1: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <details className={styles.menu}>
      <summary className={styles.summary}>
        {copyText("app/features/production/ScriptExportMenu.1")}
      </summary>
      <div className={styles.items}>
        {FORMATS.map((format) => (
          <BareButton
            key={format}
            className={styles.item}
            disabled={Boolean(busy)}
            onClick={() => void save(format)}
          >
            {busy === format
              ? copyText("app/features/production/ScriptExportMenu.9")
              : label(format)}
          </BareButton>
        ))}
      </div>
      {notice ? (
        <p
          role={notice.ok ? "status" : "alert"}
          className={notice.ok ? styles.notice : styles.error}
        >
          {notice.text}
        </p>
      ) : null}
    </details>
  );
}
