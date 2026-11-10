import type { StoryboardSourceReviewReceipt } from "@dramaip/contracts/production";
import styles from "./StoryboardSourceReviewReceiptView.module.css";
import { copyText } from "../../copy";
export function StoryboardSourceReviewReceiptView({
  value,
}: {
  value: StoryboardSourceReviewReceipt;
}) {
  return (
    <details
      aria-label={copyText(
        "app/features/production/StoryboardSourceReviewReceiptView.1",
      )}
      className={styles.c1}
    >
      <summary>
        {copyText(
          "app/features/production/StoryboardSourceReviewReceiptView.2",
        )}
      </summary>
      <p className={styles.c2}>
        {copyText(
          "app/features/production/StoryboardSourceReviewReceiptView.3",
        )}
        {value.storyboard.id}
        {copyText(
          "app/features/production/StoryboardSourceReviewReceiptView.4",
        )}
        {value.storyboard.version}
        {copyText(
          "app/features/production/StoryboardSourceReviewReceiptView.5",
        )}{" "}
        {value.review.attribution.id}
        {copyText(
          "app/features/production/StoryboardSourceReviewReceiptView.4",
        )}
        {value.review.attribution.version}
      </p>
      <p className={styles.c2}>
        {copyText(
          "app/features/production/StoryboardSourceReviewReceiptView.6",
        )}
        {value.review.impactHash}
        {copyText(
          "app/features/production/StoryboardSourceReviewReceiptView.7",
        )}{" "}
        {value.impactContentHash}
        {copyText(
          "app/features/production/StoryboardSourceReviewReceiptView.8",
        )}
        {value.scopeHash}
      </p>
      <p>
        {copyText(
          "app/features/production/StoryboardSourceReviewReceiptView.9",
        )}
      </p>
      {value.review.shots.map((shot) => (
        <p key={shot.shotId} className={styles.c2}>
          {copyText(
            "app/features/production/StoryboardSourceReviewReceiptView.10",
          )}
          {shot.sceneId}
          {copyText(
            "app/features/production/StoryboardSourceReviewReceiptView.11",
          )}
          {shot.shotId}
          {copyText(
            "app/features/production/StoryboardSourceReviewReceiptView.12",
          )}
          {shot.record.id}
          {copyText(
            "app/features/production/StoryboardSourceReviewReceiptView.13",
          )}
          {shot.record.version} ·{" "}
          {shot.observedState === "unassociated"
            ? "未关联（不是未变化）"
            : shot.observedState === "affected"
              ? "机械受影响"
              : shot.observedState === "unresolved"
                ? "范围未核全"
                : "未观察到关联变化（不是语义安全）"}{" "}
          {copyText(
            "app/features/production/StoryboardSourceReviewReceiptView.14",
          )}
          {shot.decision === "redo" ? "重做" : "保留"}
        </p>
      ))}
    </details>
  );
}
