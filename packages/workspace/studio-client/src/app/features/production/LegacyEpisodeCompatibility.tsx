import type { ReactNode } from "react";
import styles from "./LegacyEpisodeCompatibility.module.css";
import { copyText } from "../../copy";

/** Presentation only: opting into compatibility never starts or migrates work. */
export function LegacyEpisodeCompatibility(props: {
  children: ReactNode;
  explicit?: boolean;
}) {
  return (
    <details
      key={String(Boolean(props.explicit))}
      open={props.explicit || undefined}
      aria-label={copyText(
        "app/features/production/LegacyEpisodeCompatibility.1",
      )}
      className={styles.c1}
    >
      <summary className={styles.c2}>
        {copyText("app/features/production/LegacyEpisodeCompatibility.2")}
      </summary>
      <p className={styles.c3}>
        {copyText("app/features/production/LegacyEpisodeCompatibility.3")}
      </p>
      {props.children}
    </details>
  );
}
