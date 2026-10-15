import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AudioResolution,
  AudioResolutionInput,
  TimelineManifest,
  TimelineClip,
} from "@dramaip/contracts/timeline";
import { BareButton, NativeSelect } from "@dramaip/ui-shared";
import { AudioRevisionClipView } from "./AudioRevisionPanel";
import { message, useStudio } from "../../studio-shared";
const button =
  "rounded border border-line px-2 py-1 text-xs disabled:opacity-50";
const field = "min-w-0 w-full rounded border border-line px-2 py-1 text-xs";
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
    <div className="space-y-1 break-words rounded bg-surface-muted p-2">
      <p>
        {clip.name} · 片段 {clip.id}
      </p>
      <p className="whitespace-pre-wrap">{clip.text || "没有文本"}</p>
      <p>
        起点 {clip.startFrame} 帧 · 时长 {clip.durationFrames} 帧 · 源偏移{" "}
        {clip.sourceOffsetFrame} 帧
      </p>
      <p>
        音量 {clip.volume ?? 1} · 淡入 {clip.fadeInFrames ?? 0} · 淡出{" "}
        {clip.fadeOutFrames ?? 0} · 降音 {clip.duckingGain ?? "无"}
      </p>
      <p>
        {clip.locked ? "锁定保留" : "未锁定"} ·{" "}
        {clip.manuallyEdited ? "人工编辑" : "原装配"} · 原轨 {clip.audioTrackId}{" "}
        · v{clip.audioTrackVersion ?? "未核验"}
      </p>
      <p>
        源片段 {clip.sourceClipId ?? "未核验"} · 镜头 {clip.shotId ?? "无"} ·
        素材 {clip.assetId ?? "无"}
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
      className="space-y-2 rounded-xl border border-line bg-page p-3"
      aria-label="人工音轨换源与冲突处理"
      data-testid={`audio-resolution-${timeline.id}`}
    >
      <h3 className="font-medium">人工片段换源／移除</h3>
      <p className="text-xs text-muted">
        逐片段明确审查；不自动替换人工编辑，不解除锁定，不删除源轨／文件。只沿实际修订映射提供来源，不猜对应关系。
      </p>
      <BareButton className={button} onClick={() => setOpened(!opened)}>
        {opened ? "收起人工片段来源审查" : "审查人工片段来源"}
      </BareButton>
      {opened && (
        <div className="space-y-3 text-xs" data-testid="audio-resolution-panel">
          <p>
            当前时间线 v{options.data?.timelineVersion ?? "…"} · 编辑基准{" "}
            {baseVersion === undefined ? "尚未选择动作" : `v${baseVersion}`}
            。默认保留；音频和字幕分别选择，字幕文本不会自动改写。
          </p>
          {options.data?.items.map((item) => {
            const choice = choices[item.clip.id] ?? emptyChoice;
            return (
              <fieldset
                key={item.clip.id}
                className="space-y-2 rounded border border-line p-2"
                data-testid={`audio-resolution-clip-${item.clip.id}`}
              >
                <legend>
                  {labels[item.kind]} · {item.clip.name} ·{" "}
                  {item.clip.id.slice(0, 8)} ·{" "}
                  {item.sourceState === "current" ? "来源当前" : "旧来源需处理"}
                </legend>
                <ClipSnapshot clip={item.clip} />
                {item.reasons.map((reason) => (
                  <p key={reason} className="text-warning-strong">
                    {reason}
                  </p>
                ))}
                <label>
                  片段处理方式
                  <NativeSelect
                    aria-label="片段处理方式"
                    value={choice.action}
                    onChange={(event) =>
                      update(item.clip.id, {
                        action: event.target.value as Choice["action"],
                      })
                    }
                  >
                    <option value="keep">保留，不处理</option>
                    <option value="replace">明确换源，保留人工参数</option>
                    <option value="remove">明确移除本时间线引用</option>
                  </NativeSelect>
                </label>
                {choice.action === "replace" && (
                  <>
                    <label>
                      明确替换片段
                      <NativeSelect
                        aria-label="明确替换片段"
                        value={choice.target}
                        onChange={(event) =>
                          update(item.clip.id, { target: event.target.value })
                        }
                      >
                        <option value="">请选择实际对应片段</option>
                        {item.replacements.map((target) => (
                          <option
                            key={`${target.track.id}:${target.sourceClipId}`}
                            value={`${target.track.id}:${target.sourceClipId}`}
                          >
                            {target.track.label} · v{target.track.version} ·
                            片段 {target.sourceClipId.slice(0, 8)} · 可用{" "}
                            {target.availableFrames} 帧
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                    {!item.replacements.length && (
                      <p className="text-warning-strong">
                        没有满足来源、类型、对应谱系及源偏移＋时长的有效采用片段。请先明确修订并采用音轨，或裁切后重新审查；不会自动缩短或猜映射。
                      </p>
                    )}
                    {item.kind === "subtitle" && (
                      <label>
                        字幕文本选择
                        <NativeSelect
                          aria-label="字幕文本选择"
                          value={choice.subtitleText}
                          onChange={(event) =>
                            update(item.clip.id, {
                              subtitleText: event.target
                                .value as Choice["subtitleText"],
                            })
                          }
                        >
                          <option value="keep">保留人工字幕文本</option>
                          <option value="replacement">明确使用新源文本</option>
                        </NativeSelect>
                      </label>
                    )}
                  </>
                )}
                {choice.action === "remove" && (
                  <label>
                    明确移除理由
                    <textarea
                      className={`${field} min-h-16`}
                      aria-label="明确移除理由"
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
            <p>
              本时间线没有引用音轨的音频／字幕片段；不会处理普通视频或猜测关联。
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <BareButton
              className={button}
              disabled={busy || changed || baseVersion === undefined}
              onClick={() => void preview()}
            >
              冻结人工换源差异预览
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
              清空未确认选择并重新核对
            </BareButton>
          </div>
          {changed && (
            <p role="alert">
              时间线已经变化，旧编辑基准不会自动换成最新版本。请明确清空未确认选择后重新审查；已保存预览仍保留。
            </p>
          )}
          <h4 className="font-medium">换源／移除历史</h4>
          <div className="flex flex-wrap gap-2">
            {history.data?.map((item) => (
              <BareButton
                key={item.id}
                className={button}
                onClick={() => select(item.id)}
              >
                差异 {item.id.slice(0, 8)} ·{" "}
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
            <div className="space-y-3" data-testid="audio-resolution-diff">
              <p>
                冻结预览 {value.id} ·{" "}
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
                明确处理 {value.changes.length} 个片段 · 原时间线 v
                {value.before.version} ·{" "}
                {value.resultTimelineVersion !== undefined
                  ? `已写入 v${value.resultTimelineVersion}`
                  : "尚未写入"}
              </p>
              {value.warnings.map((warning) => (
                <p key={warning} className="text-muted">
                  {warning}
                </p>
              ))}
              {value.reasons.map((reason) => (
                <p key={reason} className="text-warning-strong">
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
                  <div
                    key={change.before.id}
                    className="space-y-2 rounded border border-line p-2"
                  >
                    <h5 className="font-medium">
                      {labels[change.kind]} ·{" "}
                      {change.input.action === "remove"
                        ? "明确移除"
                        : "明确换源"}
                    </h5>
                    <div className="grid min-w-0 gap-3 md:grid-cols-2">
                      <div className="min-w-0 space-y-2">
                        <p>原时间线片段冻结快照</p>
                        <ClipSnapshot clip={change.before} />
                        {original && (
                          <>
                            <p>原音轨参考内容（不是当前有效性声明）</p>
                            <AudioRevisionClipView
                              clip={original}
                              projectId={timeline.projectId}
                            />
                          </>
                        )}
                      </div>
                      <div className="min-w-0 space-y-2">
                        {change.after ? (
                          <>
                            <p>换源后保留人工参数</p>
                            <ClipSnapshot clip={change.after} />
                            {replacement && (
                              <>
                                <p>
                                  新采用轨 v{change.target!.track.version} ·
                                  实际来源／文本
                                </p>
                                <AudioRevisionClipView
                                  clip={replacement}
                                  projectId={timeline.projectId}
                                />
                              </>
                            )}
                            <p className="break-words">
                              实际修订回执链：
                              {change.target?.lineageReviewIds.join(" → ") ||
                                "明确重绑本轨当前片段"}
                            </p>
                            <p>
                              字幕选择：
                              {change.input.action === "replace" &&
                              change.input.subtitleText === "replacement"
                                ? "明确使用新源文本"
                                : "原文本保留"}
                            </p>
                          </>
                        ) : (
                          <p className="whitespace-pre-wrap break-words text-warning-strong">
                            仅移除此时间线引用：
                            {change.input.action === "remove"
                              ? change.input.reason
                              : ""}
                            。原轨／文件保留；确认后可撤销。
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {value.state === "pending" && (
                <>
                  <div className="space-y-2">
                    {declarations.map((label, index) => (
                      <label key={label} className="flex items-start gap-2">
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
                  <div className="flex flex-wrap gap-2">
                    <BareButton
                      className={button}
                      disabled={
                        busy ||
                        value.sourceState !== "current" ||
                        !reviewed.every(Boolean)
                      }
                      onClick={() => void transition("confirm")}
                    >
                      确认所选人工片段换源／移除
                    </BareButton>
                    <BareButton
                      className={button}
                      disabled={busy}
                      onClick={() => void transition("discard")}
                    >
                      放弃此换源预览
                    </BareButton>
                  </div>
                </>
              )}
              {value.confirmation && (
                <p>
                  三声明确认时间：{value.confirmation.confirmedAt}
                  。撤销保留回执，不自动恢复旧来源有效性。
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
            <p
              className="whitespace-pre-wrap break-words text-brand"
              role="status"
            >
              {notice}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
