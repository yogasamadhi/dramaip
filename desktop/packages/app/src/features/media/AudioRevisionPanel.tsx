import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AudioRevision,
  AudioRevisionInput,
  AudioTrack,
} from "@dramaip/contracts/media";
import { BareButton } from "@dramaip/ui-shared";
import { message, useStudio } from "../../studio-shared";
import { MediaPlaybackPanel } from "./MediaPlaybackPanel";

const button =
  "rounded border border-line px-2 py-1 text-xs disabled:opacity-50";
const field = "min-w-0 w-full rounded border border-line px-2 py-1 text-xs";
const checks = [
  "已审查候选实际文本／音频及新旧差异",
  "已核对新增、删除和旧→新片段映射",
  "已核对作者意图与权利限制（声明不代替授权证明）",
];

/** Only the exact frozen asset version may be auditioned here; never substitute the latest bytes. */
export function AudioRevisionClipView({
  clip,
  projectId,
}: {
  clip: AudioTrack["clips"][number];
  projectId: string;
}) {
  const client = useStudio();
  const asset = useQuery({
    queryKey: ["audio-revision-asset", projectId, clip.assetId],
    enabled: Boolean(clip.assetId),
    queryFn: () => client.resources.get("assets", clip.assetId!),
    refetchInterval: 5000,
  });
  const expected = clip.sourceVersions?.find(
    (source) => source.kind === "asset" && source.id === clip.assetId,
  )?.version;
  const available =
    expected !== undefined &&
    !asset.error &&
    asset.data?.projectId === projectId &&
    asset.data?.version === expected;
  return (
    <div className="space-y-1 break-words rounded bg-surface-muted p-2">
      <p>
        片段 {clip.id.slice(0, 8)} · 起点 {clip.startSeconds}s · 时长{" "}
        {clip.durationSeconds}s
      </p>
      <p className="whitespace-pre-wrap">{clip.text || "无文本"}</p>
      <p>
        镜头 {clip.shotId || "无"} · 素材 {clip.assetId || "无"} · 音色{" "}
        {clip.voiceProfileId || "无"}
      </p>
      <p>
        {clip.sourceVersions
          ?.map(
            (source) =>
              `${source.kind} ${source.id.slice(0, 8)} · v${source.version}`,
          )
          .join("；") || "手工文本／没有外部素材版本"}
      </p>
      {available && (
        <MediaPlaybackPanel
          recordId={clip.assetId!}
          projectId={projectId}
          version={expected!}
          expectedKind="audio"
        />
      )}
      {clip.assetId && !available && (
        <p className="text-amber-700">
          没有与项目归属及冻结版本一致的实际音频；不能用当前素材冒充原音频。请另行审阅实际文件，未审阅时不要确认。
        </p>
      )}
      {!clip.assetId && (
        <p className="text-muted">这是文本片段，不代表已生成或试听音频。</p>
      )}
      {asset.error && <p role="alert">{message(asset.error)}</p>}
    </div>
  );
}

/** Preview/confirmation only creates a new draft. Adoption and Timeline replacement remain separate decisions. */
export function AudioRevisionPanel({
  track,
  requestedReviewId,
}: {
  track: AudioTrack;
  requestedReviewId?: string;
}) {
  const client = useStudio();
  const cache = useQueryClient();
  const [opened, setOpened] = useState(Boolean(requestedReviewId));
  const [input, setInput] = useState<AudioRevisionInput>(() => ({
    sourceVersion: track.version,
    label: `${track.label} · 修订`,
    kind: track.kind,
    clips: track.clips.map(
      ({
        id,
        sourceVersions: _versions,
        sourceFingerprint: _fingerprint,
        ...clip
      }) => ({ ...clip, previousClipId: id }),
    ),
  }));
  const [selectedId, setSelectedId] = useState<string | undefined>(
    requestedReviewId,
  );
  const [reviewed, setReviewed] = useState([false, false, false]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const keys = useRef(new Map<string, string>());
  const selectionKey = `dramaip.audio-revision.selected:${track.id}`;
  useEffect(() => {
    if (requestedReviewId) {
      setOpened(true);
      setSelectedId(requestedReviewId);
      setReviewed([false, false, false]);
      return;
    }
    try {
      setSelectedId(localStorage.getItem(selectionKey) || undefined);
    } catch {
      /* Storage may be disabled; SQL history still restores previews. */
    }
  }, [selectionKey, requestedReviewId]);
  const select = (id: string) => {
    setSelectedId(id);
    setReviewed([false, false, false]);
    try {
      localStorage.setItem(selectionKey, id);
    } catch {
      /* No business state depends on browser storage. */
    }
  };
  const keyFor = async (action: string, value: unknown) => {
    const bytes = new TextEncoder().encode(
      JSON.stringify([track.id, action, value]),
    );
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (keys.current.has(digest)) return keys.current.get(digest)!;
    const storageKey = `dramaip.audio-revision.request:${track.id}:${action}:${digest}`;
    let key: string | null = null;
    try {
      key = localStorage.getItem(storageKey);
    } catch {
      /* In-memory replay is still retained. */
    }
    key ||= crypto.randomUUID();
    keys.current.set(digest, key);
    try {
      localStorage.setItem(storageKey, key);
    } catch {
      /* Browser storage is optional, not an adoption receipt. */
    }
    return key;
  };
  const assets = useQuery({
    queryKey: ["resource", "assets", track.projectId],
    enabled: opened,
    queryFn: () => client.resources.list("assets", track.projectId),
  });
  const voices = useQuery({
    queryKey: ["voice-profiles", track.projectId],
    enabled: opened,
    queryFn: () => client.episodeMedia.listVoiceProfiles(track.projectId),
  });
  const history = useQuery({
    queryKey: ["audio-revisions", track.id],
    enabled: opened,
    refetchInterval: 5000,
    queryFn: async () => {
      const items: AudioRevision[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.audioRevisions.list(track.id, cursor, 100);
        items.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new Error("音轨修订历史游标重复，未读取完整历史。");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return items;
    },
  });
  const selected = useQuery({
    queryKey: ["audio-revision", selectedId],
    enabled: opened && Boolean(selectedId),
    queryFn: () => client.audioRevisions.get(selectedId!),
    refetchInterval: 5000,
  });
  useEffect(() => {
    setReviewed([false, false, false]);
  }, [selectedId, selected.data?.stateVersion, selected.data?.sourceState]);
  useEffect(() => {
    if (opened && !selectedId && !requestedReviewId) {
      const pending = history.data?.find((item) => item.state === "pending");
      if (pending) select(pending.id);
    }
  }, [opened, selectedId, history.data, requestedReviewId]);
  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ["audio-revisions", track.id] }),
      cache.invalidateQueries({ queryKey: ["audio-revision"] }),
      cache.invalidateQueries({ queryKey: ["audio-tracks", track.episodeId] }),
      cache.invalidateQueries({ queryKey: ["audio-assembly"] }),
      cache.invalidateQueries({ queryKey: ["timeline-delivery-warnings"] }),
      cache.invalidateQueries({ queryKey: ["pending-confirmations"] }),
      cache.invalidateQueries({ queryKey: ["media-review-return"] }),
    ]);
  const preview = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      const value = await client.audioRevisions.preview(
        track.id,
        input,
        await keyFor("preview", input),
      );
      select(value.id);
      await refresh();
      setNotice("已冻结新旧差异预览，尚未创建新音轨、采用或改动时间线。");
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const transition = async (action: "confirm" | "discard") => {
    const value = selected.data;
    if (!value || value.sourceTrackId !== track.id) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const key = await keyFor(action, [value.id, value.stateVersion]);
      if (action === "confirm")
        await client.audioRevisions.confirm(
          value.id,
          value.stateVersion,
          {
            contentReviewed: true,
            mappingsReviewed: true,
            authorIntentAndRightsReviewed: true,
          },
          key,
        );
      else
        await client.audioRevisions.discard(value.id, value.stateVersion, key);
      setReviewed([false, false, false]);
      await refresh();
      setNotice(
        action === "confirm"
          ? "已明确确认并生成独立新草稿；请另行采用。旧轨与时间线均未改动。"
          : "已放弃本预览；原轨和素材不变。",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const updateClip = (
    index: number,
    patch: Partial<AudioRevisionInput["clips"][number]>,
  ) =>
    setInput((current) => ({
      ...current,
      clips: current.clips.map((clip, position) =>
        position === index ? { ...clip, ...patch } : clip,
      ),
    }));
  const value =
    selected.data?.sourceTrackId === track.id ? selected.data : undefined;
  return (
    <section
      className="mt-3 space-y-2 border-t border-line pt-2"
      data-testid={`audio-revision-${track.id}`}
    >
      {track.revision && (
        <p className="break-words text-muted">
          修订自 {track.revision.sourceTrackId} · v
          {track.revision.sourceVersion}；确认回执 {track.revision.reviewId}
        </p>
      )}
      {track.supersededBy && (
        <p className="break-words text-amber-700">
          另行采用的新轨：{track.supersededBy}
          。旧轨保留，旧时间线引用仍须单独处理。
        </p>
      )}
      <BareButton className={button} onClick={() => setOpened(!opened)}>
        {opened ? "收起音轨修订" : "审查并修订此音轨"}
      </BareButton>
      {opened && (
        <div
          className="space-y-3 rounded border border-line p-3"
          data-testid="audio-revision-panel"
        >
          <p>
            修订只生成新的草稿，不调用模型、不修改旧素材、不自动采用，也不替换／删除任何时间线片段。来源核对与作者声明不等于质量或授权证明。
          </p>
          <p>
            编辑基准 v{input.sourceVersion} · 当前原轨 v{track.version}
            。候选会重新核对实际来源版本，不用旧 ID 证明来源有效。
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            <label>
              修订音轨名称
              <input
                className={field}
                value={input.label}
                onChange={(event) =>
                  setInput({ ...input, label: event.target.value })
                }
              />
            </label>
            <label>
              修订音轨类型
              <select
                className={field}
                value={input.kind}
                onChange={(event) =>
                  setInput({
                    ...input,
                    kind: event.target.value as AudioRevisionInput["kind"],
                  })
                }
              >
                {[
                  ["dialogue", "对白"],
                  ["narration", "旁白"],
                  ["bgm", "配乐"],
                  ["sfx", "音效"],
                ].map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {input.clips.map((clip, index) => (
            <fieldset
              key={clip.previousClipId || `added-${index}`}
              className="space-y-2 rounded border border-line p-2"
            >
              <legend>
                修订片段 {index + 1} ·{" "}
                {clip.previousClipId
                  ? `映射旧片段 ${clip.previousClipId.slice(0, 8)}`
                  : "新增（不映射旧片段）"}
              </legend>
              <div className="grid gap-2 md:grid-cols-3">
                <label>
                  镜头 ID
                  <input
                    className={field}
                    value={clip.shotId ?? ""}
                    onChange={(event) =>
                      updateClip(index, {
                        shotId: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label>
                  音频素材
                  <select
                    className={field}
                    value={clip.assetId ?? ""}
                    onChange={(event) =>
                      updateClip(index, {
                        assetId: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">不绑定素材（文本草稿）</option>
                    {clip.assetId &&
                      !assets.data?.some(
                        (asset) => asset.id === clip.assetId,
                      ) && (
                        <option value={clip.assetId}>
                          原引用 {clip.assetId}
                        </option>
                      )}
                    {assets.data?.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.title} · v{asset.version}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  修订音色
                  <select
                    className={field}
                    value={clip.voiceProfileId ?? ""}
                    onChange={(event) =>
                      updateClip(index, {
                        voiceProfileId: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">不绑定音色</option>
                    {clip.voiceProfileId &&
                      !voices.data?.some(
                        (voice) => voice.id === clip.voiceProfileId,
                      ) && (
                        <option value={clip.voiceProfileId}>
                          原引用 {clip.voiceProfileId}
                        </option>
                      )}
                    {voices.data?.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.title} · v{voice.version}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  修订起点（秒）
                  <input
                    className={field}
                    type="number"
                    min="0"
                    step="0.1"
                    value={clip.startSeconds}
                    onChange={(event) =>
                      updateClip(index, {
                        startSeconds: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  修订时长（秒）
                  <input
                    className={field}
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={clip.durationSeconds}
                    onChange={(event) =>
                      updateClip(index, {
                        durationSeconds: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <label className="block">
                修订文本
                <textarea
                  aria-label="修订文本"
                  className={`${field} min-h-20`}
                  value={clip.text ?? ""}
                  onChange={(event) =>
                    updateClip(index, { text: event.target.value || undefined })
                  }
                />
              </label>
              <BareButton
                className={button}
                disabled={input.clips.length <= 1}
                onClick={() =>
                  setInput({
                    ...input,
                    clips: input.clips.filter(
                      (_clip, position) => position !== index,
                    ),
                  })
                }
              >
                从候选移除此片段
              </BareButton>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <BareButton
              className={button}
              disabled={input.clips.length >= 500}
              onClick={() =>
                setInput({
                  ...input,
                  clips: [
                    ...input.clips,
                    { startSeconds: 0, durationSeconds: 3 },
                  ],
                })
              }
            >
              新增候选片段
            </BareButton>
            <BareButton
              className={button}
              disabled={
                busy ||
                input.sourceVersion !== track.version ||
                !input.label.trim()
              }
              onClick={() => void preview()}
            >
              冻结音轨修订预览
            </BareButton>
          </div>
          {input.sourceVersion !== track.version && (
            <p role="alert">
              原轨版本已变化。请收起并重新进入此分集，核对新版本后重新编辑；不会静默重绑编辑基准。
            </p>
          )}
          <h4 className="font-medium">音轨修订历史（只读打开不会确认）</h4>
          <div className="flex flex-wrap gap-2">
            {history.data?.map((item) => (
              <BareButton
                key={item.id}
                className={button}
                onClick={() => select(item.id)}
              >
                修订 {item.id.slice(0, 8)} ·{" "}
                {item.state === "pending"
                  ? "待确认"
                  : item.state === "confirmed"
                    ? "已确认"
                    : "已放弃"}
                {item.sourceState === "stale" ? " · 来源已变" : ""}
              </BareButton>
            ))}
          </div>
          {value && (
            <div className="space-y-3" data-testid="audio-revision-diff">
              <p>
                当前预览 {value.id} ·{" "}
                {value.state === "pending"
                  ? "待确认"
                  : value.state === "confirmed"
                    ? "已确认"
                    : "已放弃"}{" "}
                ·{" "}
                {value.sourceState === "current"
                  ? "冻结来源版本一致"
                  : "来源或竞争头已变，禁止确认"}
              </p>
              {value.reasons.map((reason) => (
                <p key={reason} className="text-amber-700">
                  {reason}
                </p>
              ))}
              <p>
                旧→新映射 {value.clipLinks.length} 项 · 明确删除{" "}
                {value.removedClipIds.length} 项 · 新增{" "}
                {value.addedClipIds.length} 项
              </p>
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <h5 className="font-medium">
                    原轨冻结快照 · {value.original.label} · v
                    {value.original.version} · {value.original.kind}
                  </h5>
                  {value.original.clips.map((clip) => (
                    <AudioRevisionClipView
                      key={clip.id}
                      clip={clip}
                      projectId={track.projectId}
                    />
                  ))}
                </div>
                <div className="min-w-0 space-y-2">
                  <h5 className="font-medium">
                    候选冻结快照 · {value.candidate.label} ·{" "}
                    {value.candidate.kind}
                  </h5>
                  {value.candidate.clips.map((clip) => (
                    <div key={clip.id}>
                      <p>
                        {value.clipLinks.find(
                          (link) => link.nextClipId === clip.id,
                        )?.previousClipId || "新增（无旧映射）"}{" "}
                        → {clip.id}
                      </p>
                      <AudioRevisionClipView
                        clip={clip}
                        projectId={track.projectId}
                      />
                    </div>
                  ))}
                </div>
              </div>
              {value.removedClipIds.length > 0 && (
                <p className="break-words">
                  候选明确移除的旧片段：{value.removedClipIds.join("；")}
                  （原轨／时间线未删除）
                </p>
              )}
              {value.state === "pending" && (
                <>
                  <div className="space-y-2">
                    {checks.map((label, index) => (
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
                      确认修订并生成新草稿
                    </BareButton>
                    <BareButton
                      className={button}
                      disabled={busy}
                      onClick={() => void transition("discard")}
                    >
                      放弃此音轨修订预览
                    </BareButton>
                  </div>
                </>
              )}
              {value.targetTrackId && (
                <p className="break-words">
                  新草稿 {value.targetTrackId}
                  。请在音轨版本列表另行采用；旧时间线引用需独立审查，不能自动覆盖人工编辑。
                </p>
              )}
              {value.confirmation && (
                <p>
                  明确确认时间：{value.confirmation.confirmedAt}
                  。三项人工声明已记录，不代替实际授权或质量验收。
                </p>
              )}
            </div>
          )}
          {[assets.error, voices.error, history.error, selected.error]
            .filter(Boolean)
            .map((error, index) => (
              <p key={index} role="alert">
                {message(error)}
              </p>
            ))}
          {notice && (
            <p
              role="status"
              className="whitespace-pre-wrap break-words text-brand"
            >
              {notice}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
