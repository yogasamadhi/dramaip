import type { StoryboardPackageContent } from "@dramaip/contracts/production";
import styles from "./StoryboardContentView.module.css";
import { copyText } from "../../copy";

export function StoryboardContentView({
  content,
}: {
  content: StoryboardPackageContent;
}) {
  return (
    <div
      className={styles.c1}
      aria-label={copyText("app/features/production/StoryboardContentView.1")}
    >
      <p>
        {copyText("app/features/production/StoryboardContentView.2")}
        {content.visualDirection}
      </p>
      <p className={styles.c2}>
        {copyText("app/features/production/StoryboardContentView.3")}
      </p>
      {content.productionNotes.map((note, index) => (
        <p key={index}>{note}</p>
      ))}
      <details>
        <summary>
          {copyText("app/features/production/StoryboardContentView.4")}
          {content.assets.length}
          {copyText("app/features/production/StoryboardContentView.5")}
        </summary>
        {content.assets.map((asset) => (
          <p key={asset.id} className={styles.c3}>
            {asset.title}（{asset.kind}）：{asset.description}
          </p>
        ))}
      </details>
      {content.scenes.map((scene, index) => (
        <section key={scene.sceneId} className={styles.c4}>
          <h4 className={styles.c5}>
            {copyText("app/features/production/StoryboardContentView.6")}
            {index + 1} · {scene.shots.length}
            {copyText("app/features/production/StoryboardContentView.7")}{" "}
            {scene.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0)}{" "}
            {copyText("app/features/production/StoryboardContentView.8")}
          </h4>
          {scene.shots.map((shot) => (
            <div key={shot.id} className={styles.c6}>
              <p className={styles.c5}>
                {copyText("app/features/production/StoryboardContentView.9")}
                {shot.orderIndex + 1} · {shot.durationSeconds}
                {copyText("app/features/production/StoryboardContentView.10")}
                {shot.visualAction}
              </p>
              <p>
                {copyText("app/features/production/StoryboardContentView.11")}
                {shot.composition}
                {copyText("app/features/production/StoryboardContentView.12")}
                {shot.camera}
                {copyText("app/features/production/StoryboardContentView.13")}
                {shot.movement}
              </p>
              <p>
                {copyText("app/features/production/StoryboardContentView.14")}
                {shot.sound}
              </p>
              <p className={styles.c7}>
                {copyText("app/features/production/StoryboardContentView.15")}
                {shot.prompt}
              </p>
              <p className={styles.c7}>
                {copyText("app/features/production/StoryboardContentView.16")}
                {shot.negativePrompt}
              </p>
              <p>
                {copyText("app/features/production/StoryboardContentView.17")}
                {shot.assetIds
                  .map(
                    (id) =>
                      content.assets.find((asset) => asset.id === id)?.title ??
                      id,
                  )
                  .join("、")}
              </p>
              {content.subtitles
                .filter((item) => item.shotId === shot.id)
                .map((item) => (
                  <p key={item.id}>
                    {copyText(
                      "app/features/production/StoryboardContentView.18",
                    )}
                    {item.startSeconds}–{item.endSeconds}
                    {copyText(
                      "app/features/production/StoryboardContentView.10",
                    )}
                    {item.text}
                  </p>
                ))}
              <details>
                <summary>
                  {copyText("app/features/production/StoryboardContentView.19")}
                </summary>
                <p className={styles.c8}>{shot.sourceBlockIds.join("、")}</p>
              </details>
            </div>
          ))}
        </section>
      ))}
      <h4 className={styles.c5}>
        {copyText("app/features/production/StoryboardContentView.20")}
      </h4>
      {content.costRisks.length ? (
        content.costRisks.map((risk, index) => (
          <p key={index}>
            {risk.severity} · {risk.reason}
            {copyText("app/features/production/StoryboardContentView.21")}
            {risk.mitigation}
          </p>
        ))
      ) : (
        <p>{copyText("app/features/production/StoryboardContentView.22")}</p>
      )}
      <h4 className={styles.c5}>
        {copyText("app/features/production/StoryboardContentView.23")}
      </h4>
      {content.externalDependencies.length ? (
        content.externalDependencies.map((item, index) => (
          <p key={index}>{item}</p>
        ))
      ) : (
        <p>{copyText("app/features/production/StoryboardContentView.24")}</p>
      )}
    </div>
  );
}
