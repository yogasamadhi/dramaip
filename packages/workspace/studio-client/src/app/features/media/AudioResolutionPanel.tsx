import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import type {
  AudioResolution,
  AudioResolutionInput,
  TimelineManifest,
  TimelineClip,
} from "@dramaip/contracts/timeline";
import { BareButton, NativeSelect } from "@dramaip/infra-ui-primitives";
import { AudioRevisionClipView } from "./AudioRevisionPanel";
import { message, useStudio } from "../../studio-shared";
import styles from "./AudioResolutionPanel.module.css";
import { copyText } from "../../copy";
import { clsx } from "clsx";
const button = styles.c1;
const field = styles.c2;
const labels = {
  video: "视频",
  dialogue: "对白",
  narration: "旁白",
  bgm: "配乐",
  sfx: "音效",
  subtitle: "字幕",
};
const declarations = [
  "已审查所有选中片段的实际新旧内容与差异",
  "已核对人工／锁定／裁切／分割片段并授权这些具体改动",
  "已核对作者意图、字幕选择与权利限制（声明不等于授权证明）",
];
type Choice = {
  action: "keep" | "replace" | "remove";
  target: string;
  subtitleText: "keep" | "replacement";
  reason: string;
};
const emptyChoice: Choice = {
  action: "keep",
  target: "",
  subtitleText: "keep",
  reason: "",
};
function ClipSnapshot({ clip }: { clip: TimelineClip }) {
  return (
    <div className={styles.c3}>
      <p>
        {clip.name}
        {copyText("app/features/media/AudioResolutionPanel.1")}
        {clip.id}
      </p>
      <p className={styles.c4}>{clip.text || "没有文本"}</p>
      <p>
        {copyText("app/features/media/AudioResolutionPanel.2")}
        {clip.startFrame}
        {copyText("app/features/media/AudioResolutionPanel.3")}
        {clip.durationFrames}
        {copyText("app/features/media/AudioResolutionPanel.4")}{" "}
        {clip.sourceOffsetFrame}
        {copyText("app/features/media/AudioResolutionPanel.5")}
      </p>
      <p>
        {copyText("app/features/media/AudioResolutionPanel.6")}
        {clip.volume ?? 1}
        {copyText("app/features/media/AudioResolutionPanel.7")}
        {clip.fadeInFrames ?? 0}
        {copyText("app/features/media/AudioResolutionPanel.8")}{" "}
        {clip.fadeOutFrames ?? 0}
        {copyText("app/features/media/AudioResolutionPanel.9")}
        {clip.duckingGain ?? "无"}
      </p>
      <p>
        {clip.locked ? "锁定保留" : "未锁定"} ·{" "}
        {clip.manuallyEdited ? "人工编辑" : "原装配"}
        {copyText("app/features/media/AudioResolutionPanel.10")}
        {clip.audioTrackId}{" "}
        {copyText("app/features/media/AudioResolutionPanel.11")}
        {clip.audioTrackVersion ?? "未核验"}
      </p>
      <p>
        {copyText("app/features/media/AudioResolutionPanel.12")}
        {clip.sourceClipId ?? "未核验"}
        {copyText("app/features/media/AudioResolutionPanel.13")}
        {clip.shotId ?? "无"}
        {copyText("app/features/media/AudioResolutionPanel.14")}
        {clip.assetId ?? "无"}
      </p>
    </div>
  );
}

export function AudioResolutionPanel({
  timeline,
  requestedReviewId,
}: {
  timeline: TimelineManifest;
  requestedReviewId?: string;
}) {
  const client = useStudio();
  const cache = useQueryClient();
  const [opened, setOpened] = useState(Boolean(requestedReviewId));
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [baseVersion, setBaseVersion] = useState<number>();
  const [selectedId, setSelectedId] = useState<string | undefined>(
    requestedReviewId,
  );
  const [reviewed, setReviewed] = useState([false, false, false]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const keys = useRef(new Map<string, string>());
  const storageKey = `dramaip.audio-resolution.selected:${timeline.id}`;
  useEffect(() => {
    setChoices({});
    setBaseVersion(undefined);
    setReviewed([false, false, false]);
    setNotice(undefined);
    keys.current.clear();
    if (requestedReviewId) {
      setOpened(true);
      setSelectedId(requestedReviewId);
      return;
    }
    try {
      setSelectedId(localStorage.getItem(storageKey) || undefined);
    } catch {
      /* SQL history remains authoritative. */
    }
  }, [storageKey, requestedReviewId]);
  const select = (id: string) => {
    setSelectedId(id);
    setReviewed([false, false, false]);
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      /* Optional local selection, never consent. */
    }
  };
  const keyFor = async (action: string, input: unknown) => {
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify([timeline.id, action, input]),
          ),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (keys.current.has(digest)) return keys.current.get(digest)!;
    const keyName = `dramaip.audio-resolution.request:${digest}`;
    let key: string | null = null;
    try {
      key = localStorage.getItem(keyName);
    } catch {
      /* In-memory keys still retain unknown outcomes. */
    }
    key ||= crypto.randomUUID();
    keys.current.set(digest, key);
    try {
      localStorage.setItem(keyName, key);
    } catch {
      /* No business state depends on browser storage. */
    }
    return key;
  };
  const options = useQuery({
    queryKey: ["audio-resolution-options", timeline.id],
    enabled: opened,
    queryFn: () => client.audioResolutions.options(timeline.id),
    refetchInterval: 5000,
  });
  const history = useQuery({
    queryKey: ["audio-resolutions", timeline.id],
    enabled: opened,
    refetchInterval: 5000,
    queryFn: async () => {
      const items: AudioResolution[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await client.audioResolutions.list(
          timeline.id,
          cursor,
          100,
        );
        items.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new Error("换源历史游标重复，未读取完整历史。");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return items;
    },
  });
  const selected = useQuery({
    queryKey: ["audio-resolution", selectedId],
    enabled: opened && Boolean(selectedId),
    queryFn: () => client.audioResolutions.get(selectedId!),
    refetchInterval: 5000,
  });
  useEffect(() => {
    setReviewed([false, false, false]);
  }, [selectedId, selected.data?.stateVersion, selected.data?.sourceState]);
  useEffect(() => {
    if (opened && !selectedId && !requestedReviewId) {
      const pending = history.data?.find((value) => value.state === "pending");
      if (pending) select(pending.id);
    }
  }, [opened, selectedId, history.data, requestedReviewId]);
  const update = (id: string, patch: Partial<Choice>) => {
    if (baseVersion === undefined)
      setBaseVersion(options.data?.timelineVersion);
    setChoices((current) => ({
      ...current,
      [id]: { ...(current[id] ?? emptyChoice), ...patch },
    }));
  };
  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ["timeline"] }),
      cache.invalidateQueries({
        queryKey: ["audio-resolution-options", timeline.id],
      }),
      cache.invalidateQueries({ queryKey: ["audio-resolutions", timeline.id] }),
      cache.invalidateQueries({ queryKey: ["audio-resolution"] }),
      cache.invalidateQueries({ queryKey: ["pending-confirmations"] }),
    ]);
  const preview = async () => {
    if (!options.data || baseVersion === undefined) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const changes: AudioResolutionInput["changes"] = Object.entries(
        choices,
      ).flatMap<AudioResolutionInput["changes"][number]>(([clipId, choice]) => {
        if (choice.action === "keep") return [];
        if (choice.action === "remove") {
          if (!choice.reason.trim()) throw new Error("请填写明确移除理由。");
          return [
            { action: "remove" as const, clipId, reason: choice.reason.trim() },
          ];
        }
        const entry = options.data!.items.find(
          (item) => item.clip.id === clipId,
        );
        const target = entry?.replacements.find(
          (item) => `${item.track.id}:${item.sourceClipId}` === choice.target,
        );
        if (!target) throw new Error("请明确选择当前可用且对应的替换片段。");
        return [
          {
            action: "replace" as const,
            clipId,
            audioTrackId: target.track.id,
            sourceClipId: target.sourceClipId,
            subtitleText: choice.subtitleText,
          },
        ];
      });
      if (!changes.length)
        throw new Error("请明确选择至少一个换源或移除动作。");
      const input = { timelineVersion: baseVersion, changes };
      const value = await client.audioResolutions.preview(
        timeline.id,
        input,
        await keyFor("preview", input),
      );
      select(value.id);
      await refresh();
      setNotice("差异已冻结，时间线尚未改动；请审查并明确确认。");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const transition = async (action: "confirm" | "discard") => {
    const value = selected.data;
    if (!value || value.timelineId !== timeline.id) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const key = await keyFor(action, [value.id, value.stateVersion]);
      if (action === "confirm")
        await client.audioResolutions.confirm(
          value.id,
          value.stateVersion,
          {
            differencesReviewed: true,
            protectedEditsReviewed: true,
            authorIntentAndRightsReviewed: true,
          },
          key,
        );
      else
        await client.audioResolutions.discard(
          value.id,
          value.stateVersion,
          key,
        );
      setChoices({});
      setBaseVersion(undefined);
      setReviewed([false, false, false]);
      await refresh();
      setNotice(
        action === "confirm"
          ? "已确认所选片段换源／移除，人工参数与选择外片段保留；可以撤销。源轨和原文件未修改。"
          : "已放弃本次预览；时间线和原素材未修改。",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const value =
    selected.data?.timelineId === timeline.id ? selected.data : undefined;
  const changed =
    baseVersion !== undefined && baseVersion !== options.data?.timelineVersion;
  return (
    <section
      className={styles.c5}
      aria-label={copyText("app/features/media/AudioResolutionPanel.15")}
      data-testid={`audio-resolution-${timeline.id}`}
    >
      <h3 className={styles.c6}>
        {copyText("app/features/media/AudioResolutionPanel.16")}
      </h3>
      <p className={styles.c7}>
        {copyText("app/features/media/AudioResolutionPanel.17")}
      </p>
      <BareButton className={button} onClick={() => setOpened(!opened)}>
        {opened ? "收起人工片段来源审查" : "审查人工片段来源"}
      </BareButton>
      {opened && (
        <div className={styles.c8} data-testid="audio-resolution-panel">
          <p>
            {copyText("app/features/media/AudioResolutionPanel.18")}
            {options.data?.timelineVersion ?? "…"}
            {copyText("app/features/media/AudioResolutionPanel.19")}{" "}
            {baseVersion === undefined ? "尚未选择动作" : `v${baseVersion}`}
            {copyText("app/features/media/AudioResolutionPanel.20")}
          </p>
          {options.data?.items.map((item) => {
            const choice = choices[item.clip.id] ?? emptyChoice;
            return (
              <fieldset
                key={item.clip.id}
                className={styles.c9}
                data-testid={`audio-resolution-clip-${item.clip.id}`}
              >
                <legend>
                  {labels[item.kind]} · {item.clip.name} ·{" "}
                  {item.clip.id.slice(0, 8)} ·{" "}
                  {item.sourceState === "current" ? "来源当前" : "旧来源需处理"}
                </legend>
                <ClipSnapshot clip={item.clip} />
                {item.reasons.map((reason) => (
                  <p key={reason} className={styles.c10}>
                    {reason}
                  </p>
                ))}
                <label>
                  {copyText("app/features/media/AudioResolutionPanel.21")}
                  <NativeSelect
                    aria-label={copyText(
                      "app/features/media/AudioResolutionPanel.21",
                    )}
                    value={choice.action}
                    onChange={(event) =>
                      update(item.clip.id, {
                        action: event.target.value as Choice["action"],
                      })
                    }
                  >
                    <option value="keep">
                      {copyText("app/features/media/AudioResolutionPanel.22")}
                    </option>
                    <option value="replace">
                      {copyText("app/features/media/AudioResolutionPanel.23")}
                    </option>
                    <option value="remove">
                      {copyText("app/features/media/AudioResolutionPanel.24")}
                    </option>
                  </NativeSelect>
                </label>
                {choice.action === "replace" && (
                  <>
                    <label>
                      {copyText("app/features/media/AudioResolutionPanel.25")}
                      <NativeSelect
                        aria-label={copyText(
                          "app/features/media/AudioResolutionPanel.25",
                        )}
                        value={choice.target}
                        onChange={(event) =>
                          update(item.clip.id, { target: event.target.value })
                        }
                      >
                        <option value="">
                          {copyText(
                            "app/features/media/AudioResolutionPanel.26",
                          )}
                        </option>
                        {item.replacements.map((target) => (
                          <option
                            key={`${target.track.id}:${target.sourceClipId}`}
                            value={`${target.track.id}:${target.sourceClipId}`}
                          >
                            {target.track.label}
                            {copyText(
                              "app/features/media/AudioResolutionPanel.27",
                            )}
                            {target.track.version}
                            {copyText(
                              "app/features/media/AudioResolutionPanel.1",
                            )}
                            {target.sourceClipId.slice(0, 8)}
                            {copyText(
                              "app/features/media/AudioResolutionPanel.28",
                            )}{" "}
                            {target.availableFrames}
                            {copyText(
                              "app/features/media/AudioResolutionPanel.5",
                            )}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                    {!item.replacements.length && (
                      <p className={styles.c10}>
                        {copyText("app/features/media/AudioResolutionPanel.29")}
                      </p>
                    )}
                    {item.kind === "subtitle" && (
                      <label>
                        {copyText("app/features/media/AudioResolutionPanel.30")}
                        <NativeSelect
                          aria-label={copyText(
                            "app/features/media/AudioResolutionPanel.30",
                          )}
                          value={choice.subtitleText}
                          onChange={(event) =>
                            update(item.clip.id, {
                              subtitleText: event.target
                                .value as Choice["subtitleText"],
                            })
                          }
                        >
                          <option value="keep">
                            {copyText(
                              "app/features/media/AudioResolutionPanel.31",
                            )}
                          </option>
                          <option value="replacement">
                            {copyText(
                              "app/features/media/AudioResolutionPanel.32",
                            )}
                          </option>
                        </NativeSelect>
                      </label>
                    )}
                  </>
                )}
                {choice.action === "remove" && (
                  <label>
                    {copyText("app/features/media/AudioResolutionPanel.33")}
                    <textarea
                      className={clsx(field, styles.c11)}
                      aria-label={copyText(
                        "app/features/media/AudioResolutionPanel.33",
                      )}
                      value={choice.reason}
                      onChange={(event) =>
                        update(item.clip.id, { reason: event.target.value })
                      }
                    />
                  </label>
                )}
              </fieldset>
            );
          })}
          {!options.data?.items.length && (
            <p>{copyText("app/features/media/AudioResolutionPanel.34")}</p>
          )}
          <div className={styles.c12}>
            <BareButton
              className={button}
              disabled={busy || changed || baseVersion === undefined}
              onClick={() => void preview()}
            >
              {copyText("app/features/media/AudioResolutionPanel.35")}
            </BareButton>
            <BareButton
              className={button}
              disabled={busy}
              onClick={() => {
                setChoices({});
                setBaseVersion(undefined);
                setReviewed([false, false, false]);
              }}
            >
              {copyText("app/features/media/AudioResolutionPanel.36")}
            </BareButton>
          </div>
          {changed && (
            <p role="alert">
              {copyText("app/features/media/AudioResolutionPanel.37")}
            </p>
          )}
          <h4 className={styles.c6}>
            {copyText("app/features/media/AudioResolutionPanel.38")}
          </h4>
          <div className={styles.c12}>
            {history.data?.map((item) => (
              <BareButton
                key={item.id}
                className={button}
                onClick={() => select(item.id)}
              >
                {copyText("app/features/media/AudioResolutionPanel.39")}
                {item.id.slice(0, 8)} ·{" "}
                {item.state === "pending"
                  ? "待确认"
                  : item.state === "confirmed"
                    ? "已确认"
                    : "已放弃"}
                {item.sourceState === "stale" ? " · 已变化／历史" : ""}
              </BareButton>
            ))}
          </div>
          {value && (
            <div className={styles.c13} data-testid="audio-resolution-diff">
              <p>
                {copyText("app/features/media/AudioResolutionPanel.40")}
                {value.id} ·{" "}
                {value.state === "pending"
                  ? "待确认"
                  : value.state === "confirmed"
                    ? "已确认"
                    : "已放弃"}{" "}
                ·{" "}
                {value.sourceState === "current"
                  ? "冻结条件一致"
                  : "来源或时间线已变，禁止旧确认"}
              </p>
              <p>
                {copyText("app/features/media/AudioResolutionPanel.41")}
                {value.changes.length}
                {copyText("app/features/media/AudioResolutionPanel.42")}
                {value.before.version} ·{" "}
                {value.resultTimelineVersion !== undefined
                  ? `已写入 v${value.resultTimelineVersion}`
                  : "尚未写入"}
              </p>
              {value.warnings.map((warning) => (
                <p key={warning} className={styles.c14}>
                  {warning}
                </p>
              ))}
              {value.reasons.map((reason) => (
                <p key={reason} className={styles.c10}>
                  {reason}
                </p>
              ))}
              {value.changes.map((change) => {
                const original = change.originalSource?.clips.find(
                  (clip) => clip.id === change.before.sourceClipId,
                );
                const replacement = change.target?.track.clips.find(
                  (clip) => clip.id === change.target?.sourceClipId,
                );
                return (
                  <div key={change.before.id} className={styles.c9}>
                    <h5 className={styles.c6}>
                      {labels[change.kind]} ·{" "}
                      {change.input.action === "remove"
                        ? "明确移除"
                        : "明确换源"}
                    </h5>
                    <div className={styles.c15}>
                      <div className={styles.c16}>
                        <p>
                          {copyText(
                            "app/features/media/AudioResolutionPanel.43",
                          )}
                        </p>
                        <ClipSnapshot clip={change.before} />
                        {original && (
                          <>
                            <p>
                              {copyText(
                                "app/features/media/AudioResolutionPanel.44",
                              )}
                            </p>
                            <AudioRevisionClipView
                              clip={original}
                              projectId={timeline.projectId}
                            />
                          </>
                        )}
                      </div>
                      <div className={styles.c16}>
                        {change.after ? (
                          <>
                            <p>
                              {copyText(
                                "app/features/media/AudioResolutionPanel.45",
                              )}
                            </p>
                            <ClipSnapshot clip={change.after} />
                            {replacement && (
                              <>
                                <p>
                                  {copyText(
                                    "app/features/media/AudioResolutionPanel.46",
                                  )}
                                  {change.target!.track.version}
                                  {copyText(
                                    "app/features/media/AudioResolutionPanel.47",
                                  )}
                                </p>
                                <AudioRevisionClipView
                                  clip={replacement}
                                  projectId={timeline.projectId}
                                />
                              </>
                            )}
                            <p className={styles.c17}>
                              {copyText(
                                "app/features/media/AudioResolutionPanel.48",
                              )}
                              {change.target?.lineageReviewIds.join(" → ") ||
                                "明确重绑本轨当前片段"}
                            </p>
                            <p>
                              {copyText(
                                "app/features/media/AudioResolutionPanel.49",
                              )}
                              {change.input.action === "replace" &&
                              change.input.subtitleText === "replacement"
                                ? "明确使用新源文本"
                                : "原文本保留"}
                            </p>
                          </>
                        ) : (
                          <p className={styles.c18}>
                            {copyText(
                              "app/features/media/AudioResolutionPanel.50",
                            )}
                            {change.input.action === "remove"
                              ? change.input.reason
                              : ""}
                            {copyText(
                              "app/features/media/AudioResolutionPanel.51",
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {value.state === "pending" && (
                <>
                  <div className={styles.c19}>
                    {declarations.map((label, index) => (
                      <label key={label} className={styles.c20}>
                        <input
                          type="checkbox"
                          checked={reviewed[index]}
                          disabled={busy || value.sourceState !== "current"}
                          onChange={(event) =>
                            setReviewed(
                              reviewed.map((checked, position) =>
                                position === index
                                  ? event.target.checked
                                  : checked,
                              ),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className={styles.c12}>
                    <BareButton
                      className={button}
                      disabled={
                        busy ||
                        value.sourceState !== "current" ||
                        !reviewed.every(Boolean)
                      }
                      onClick={() => void transition("confirm")}
                    >
                      {copyText("app/features/media/AudioResolutionPanel.52")}
                    </BareButton>
                    <BareButton
                      className={button}
                      disabled={busy}
                      onClick={() => void transition("discard")}
                    >
                      {copyText("app/features/media/AudioResolutionPanel.53")}
                    </BareButton>
                  </div>
                </>
              )}
              {value.confirmation && (
                <p>
                  {copyText("app/features/media/AudioResolutionPanel.54")}
                  {value.confirmation.confirmedAt}
                  {copyText("app/features/media/AudioResolutionPanel.55")}
                </p>
              )}
            </div>
          )}
          {[options.error, history.error, selected.error]
            .filter(Boolean)
            .map((error, index) => (
              <p key={index} role="alert">
                {message(error)}
              </p>
            ))}
          {notice && (
            <p className={styles.c21} role="status">
              {notice}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
