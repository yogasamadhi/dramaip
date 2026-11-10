import type {
  EpisodeUpstreamConstraint,
  EpisodeUpstreamConstraints,
  EpisodeConstraintSnapshot,
} from "@dramaip/contracts/production";
import styles from "./EpisodeConstraintObservations.module.css";
import { copyText } from "../../copy";

const kinds: Record<EpisodeUpstreamConstraint["kind"], string> = {
  "season-plan": "整季方案",
  "adaptation-diagnosis": "改编诊断",
  "adaptation-strategy": "独立策略",
  "author-intent": "作者意图",
  "story-bible": "已批准故事圣经",
  "episode-outline": "正式单集大纲",
  "episode-script": "正式标准剧本",
  "direct-project": "直写项目简报",
  "direct-episode": "直写实际分集",
  "direct-source-script": "直写原剧本",
};
const changes: Record<EpisodeUpstreamConstraint["change"], string> = {
  "same-reference": "身份／版本未观察变化",
  changed: "版本、顺序或已知指纹变化",
  replaced: "当前正式头已替换",
  added: "当前集合新增",
  removed: "当前记录或正式头已缺失",
  unavailable: "实际读取未核全",
  unverified: "原绑定未核全",
};
function Snapshot({
  value,
  label,
  missing,
}: {
  value: EpisodeConstraintSnapshot | null;
  label: string;
  missing: string;
}) {
  if (!value) return <span>{missing}</span>;
  return (
    <div className={styles.c1}>
      <p>
        {value.id}
        {copyText("app/features/production/EpisodeConstraintObservations.1")}
        {value.version}
      </p>
      {value.position !== undefined && (
        <p>
          {copyText("app/features/production/EpisodeConstraintObservations.2")}
          {value.position + 1}
        </p>
      )}
      {value.documentVersion !== undefined && (
        <p>
          {copyText("app/features/production/EpisodeConstraintObservations.3")}
          {value.documentVersion === null
            ? "未记录"
            : `v${value.documentVersion}`}
        </p>
      )}
      {value.contentHash ? (
        <details>
          <summary>
            {label}
            {copyText(
              "app/features/production/EpisodeConstraintObservations.4",
            )}
          </summary>
          <code className={styles.c2}>{value.contentHash}</code>
        </details>
      ) : (
        <p className={styles.c3}>
          {copyText("app/features/production/EpisodeConstraintObservations.5")}
        </p>
      )}
    </div>
  );
}
export function EpisodeConstraintObservations({
  value,
}: {
  value?: EpisodeUpstreamConstraints;
}) {
  return (
    <section
      aria-label={copyText(
        "app/features/production/EpisodeConstraintObservations.6",
      )}
      className={styles.c4}
    >
      <h4 className={styles.c5}>
        {copyText("app/features/production/EpisodeConstraintObservations.6")}
      </h4>
      <p className={styles.c3}>
        {copyText("app/features/production/EpisodeConstraintObservations.7")}
      </p>
      {!value ? (
        <p role="status">
          {copyText("app/features/production/EpisodeConstraintObservations.8")}
        </p>
      ) : (
        <>
          <p>
            {copyText(
              "app/features/production/EpisodeConstraintObservations.9",
            )}
            {value.approvedStoryBible.frozenCount}
            {copyText(
              "app/features/production/EpisodeConstraintObservations.10",
            )}
            {value.approvedStoryBible.currentCount ?? "未核全"}
            {copyText(
              "app/features/production/EpisodeConstraintObservations.11",
            )}
            {value.approvedStoryBible.readState === "available"
              ? "本次实际集合已读取"
              : "本次实际集合读取未核全"}
            。
          </p>
          <table className={styles.c6}>
            <caption className={styles.c7}>
              {copyText(
                "app/features/production/EpisodeConstraintObservations.12",
              )}
            </caption>
            <thead>
              <tr>
                <th className={styles.c8}>
                  {copyText(
                    "app/features/production/EpisodeConstraintObservations.13",
                  )}
                </th>
                <th className={styles.c8}>
                  {copyText(
                    "app/features/production/EpisodeConstraintObservations.14",
                  )}
                </th>
                <th className={styles.c8}>
                  {copyText(
                    "app/features/production/EpisodeConstraintObservations.15",
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {value.items.map((item) => (
                <tr
                  key={`${item.kind}:${item.frozen?.id ?? item.current?.id ?? "unavailable"}`}
                  data-constraint-kind={item.kind}
                  data-constraint-id={item.frozen?.id ?? item.current?.id}
                  className={styles.c9}
                >
                  <th className={styles.c10}>
                    <p>{kinds[item.kind]}</p>
                    <p>{changes[item.change]}</p>
                  </th>
                  <td className={styles.c11}>
                    <Snapshot
                      value={item.frozen}
                      label="原冻结"
                      missing="原清单未绑定此记录"
                    />
                  </td>
                  <td className={styles.c11}>
                    <Snapshot
                      value={item.current}
                      label="当前实际"
                      missing={
                        item.readState === "unavailable"
                          ? "当前读取未核全"
                          : "当前记录或正式头不存在"
                      }
                    />
                    <p className={styles.c3}>
                      {item.currentSourceState === "stale"
                        ? "来源服务报告当前来源失效"
                        : item.currentSourceState === "current"
                          ? "来源服务报告当前来源有效"
                          : "单项来源状态未单独核验"}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
