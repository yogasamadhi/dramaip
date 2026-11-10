import type { EpisodeDevelopmentImpact } from "@dramaip/contracts/production";
import styles from "./ConfirmedSourceTransitionView.module.css";
import { copyText } from "../../copy";

export function ConfirmedSourceTransitionView({
  value,
}: {
  value: EpisodeDevelopmentImpact["confirmedSourceTransition"];
}) {
  if (!value) return null;
  return (
    <details
      aria-label={copyText(
        "app/features/production/ConfirmedSourceTransitionView.1",
      )}
      className={styles.c1}
    >
      <summary>
        {copyText("app/features/production/ConfirmedSourceTransitionView.2")}
      </summary>
      <p>
        {copyText("app/features/production/ConfirmedSourceTransitionView.3")}
      </p>
      <p className={styles.c2}>
        {copyText("app/features/production/ConfirmedSourceTransitionView.4")}
        {value.originalOutline.id}
        {copyText("app/features/production/ConfirmedSourceTransitionView.5")}
        {value.originalOutline.version}
        {copyText("app/features/production/ConfirmedSourceTransitionView.6")}
        {value.currentOutline.id}
        {copyText("app/features/production/ConfirmedSourceTransitionView.5")}
        {value.currentOutline.version}
      </p>
      <p className={styles.c2}>
        {copyText("app/features/production/ConfirmedSourceTransitionView.7")}
        {value.originalScript.id}
        {copyText("app/features/production/ConfirmedSourceTransitionView.5")}
        {value.originalScript.version}
        {copyText("app/features/production/ConfirmedSourceTransitionView.8")}
        {value.currentScript.id}
        {copyText("app/features/production/ConfirmedSourceTransitionView.5")}
        {value.currentScript.version}
      </p>
      <p className={styles.c2}>
        {copyText("app/features/production/ConfirmedSourceTransitionView.9")}
        {value.document.id}
        {copyText("app/features/production/ConfirmedSourceTransitionView.10")}
        {value.document.scriptId}
        {copyText("app/features/production/ConfirmedSourceTransitionView.11")}
        {value.document.version}
        {copyText("app/features/production/ConfirmedSourceTransitionView.12")}
        {value.document.contentHash}
      </p>
      {value.confirmationPreviews.map((preview) => (
        <p key={preview.id} className={styles.c2}>
          {copyText("app/features/production/ConfirmedSourceTransitionView.13")}
          {preview.id}
          {copyText("app/features/production/ConfirmedSourceTransitionView.5")}
          {preview.version}
        </p>
      ))}
      <p>
        {copyText("app/features/production/ConfirmedSourceTransitionView.14")}
      </p>
    </details>
  );
}
