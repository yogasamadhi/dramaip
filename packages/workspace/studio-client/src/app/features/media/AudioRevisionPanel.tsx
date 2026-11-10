import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import type {
  AudioRevision,
  AudioRevisionInput,
  AudioTrack,
} from "@dramaip/contracts/media";
import { BareButton, NativeSelect } from "@dramaip/infra-ui-primitives";
import { message, useStudio } from "../../studio-shared";
import { MediaPlaybackPanel } from "./MediaPlaybackPanel";
import styles from "./AudioRevisionPanel.module.css";
import { copyText } from "../../copy";
import { clsx } from "clsx";

const button = styles.c1;
const field = styles.c2;
const checks = [
  "已审查 AI 草稿实际文本／音频及新旧差异",
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
    <div className={styles.c3}>
      <p>
        {copyText("app/features/media/AudioRevisionPanel.1")}
        {clip.id.slice(0, 8)}
        {copyText("app/features/media/AudioRevisionPanel.2")}
        {clip.startSeconds}
        {copyText("app/features/media/AudioRevisionPanel.3")}{" "}
        {clip.durationSeconds}
        {copyText("app/features/media/AudioRevisionPanel.4")}
      </p>
      <p className={styles.c4}>{clip.text || "无文本"}</p>
      <p>
        {copyText("app/features/media/AudioRevisionPanel.5")}
        {clip.shotId || "无"}
        {copyText("app/features/media/AudioRevisionPanel.6")}
        {clip.assetId || "无"}
        {copyText("app/features/media/AudioRevisionPanel.7")}{" "}
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
        <p className={styles.c5}>
          {copyText("app/features/media/AudioRevisionPanel.8")}
        </p>
      )}
      {!clip.assetId && (
        <p className={styles.c6}>
          {copyText("app/features/media/AudioRevisionPanel.9")}
        </p>
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
    <section className={styles.c7} data-testid={`audio-revision-${track.id}`}>
      {track.revision && (
        <p className={styles.c8}>
          {copyText("app/features/media/AudioRevisionPanel.10")}
          {track.revision.sourceTrackId}
          {copyText("app/features/media/AudioRevisionPanel.11")}
          {track.revision.sourceVersion}
          {copyText("app/features/media/AudioRevisionPanel.12")}
          {track.revision.reviewId}
        </p>
      )}
      {track.supersededBy && (
        <p className={styles.c9}>
          {copyText("app/features/media/AudioRevisionPanel.13")}
          {track.supersededBy}
          {copyText("app/features/media/AudioRevisionPanel.14")}
        </p>
      )}
      <BareButton className={button} onClick={() => setOpened(!opened)}>
        {opened ? "收起音轨修订" : "审查并修订此音轨"}
      </BareButton>
      {opened && (
        <div className={styles.c10} data-testid="audio-revision-panel">
          <p>{copyText("app/features/media/AudioRevisionPanel.15")}</p>
          <p>
            {copyText("app/features/media/AudioRevisionPanel.16")}
            {input.sourceVersion}
            {copyText("app/features/media/AudioRevisionPanel.17")}
            {track.version}
            {copyText("app/features/media/AudioRevisionPanel.18")}
          </p>
          <div className={styles.c11}>
            <label>
              {copyText("app/features/media/AudioRevisionPanel.19")}
              <input
                className={field}
                value={input.label}
                onChange={(event) =>
                  setInput({ ...input, label: event.target.value })
                }
              />
            </label>
            <label>
              {copyText("app/features/media/AudioRevisionPanel.20")}
              <NativeSelect
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
              </NativeSelect>
            </label>
          </div>
          {input.clips.map((clip, index) => (
            <fieldset
              key={clip.previousClipId || `added-${index}`}
              className={styles.c12}
            >
              <legend>
                {copyText("app/features/media/AudioRevisionPanel.21")}
                {index + 1} ·{" "}
                {clip.previousClipId
                  ? `映射旧片段 ${clip.previousClipId.slice(0, 8)}`
                  : "新增（不映射旧片段）"}
              </legend>
              <div className={styles.c13}>
                <label>
                  {copyText("app/features/media/AudioRevisionPanel.22")}
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
                  {copyText("app/features/media/AudioRevisionPanel.23")}
                  <NativeSelect
                    value={clip.assetId ?? ""}
                    onChange={(event) =>
                      updateClip(index, {
                        assetId: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">
                      {copyText("app/features/media/AudioRevisionPanel.24")}
                    </option>
                    {clip.assetId &&
                      !assets.data?.some(
                        (asset) => asset.id === clip.assetId,
                      ) && (
                        <option value={clip.assetId}>
                          {copyText("app/features/media/AudioRevisionPanel.25")}
                          {clip.assetId}
                        </option>
                      )}
                    {assets.data?.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.title}
                        {copyText("app/features/media/AudioRevisionPanel.11")}
                        {asset.version}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label>
                  {copyText("app/features/media/AudioRevisionPanel.26")}
                  <NativeSelect
                    value={clip.voiceProfileId ?? ""}
                    onChange={(event) =>
                      updateClip(index, {
                        voiceProfileId: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">
                      {copyText("app/features/media/AudioRevisionPanel.27")}
                    </option>
                    {clip.voiceProfileId &&
                      !voices.data?.some(
                        (voice) => voice.id === clip.voiceProfileId,
                      ) && (
                        <option value={clip.voiceProfileId}>
                          {copyText("app/features/media/AudioRevisionPanel.25")}
                          {clip.voiceProfileId}
                        </option>
                      )}
                    {voices.data?.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.title}
                        {copyText("app/features/media/AudioRevisionPanel.11")}
                        {voice.version}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label>
                  {copyText("app/features/media/AudioRevisionPanel.28")}
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
                  {copyText("app/features/media/AudioRevisionPanel.29")}
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
              <label className={styles.c14}>
                {copyText("app/features/media/AudioRevisionPanel.30")}
                <textarea
                  aria-label={copyText(
                    "app/features/media/AudioRevisionPanel.30",
                  )}
                  className={clsx(field, styles.c15)}
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
                {copyText("app/features/media/AudioRevisionPanel.31")}
              </BareButton>
            </fieldset>
          ))}
          <div className={styles.c16}>
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
              {copyText("app/features/media/AudioRevisionPanel.32")}
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
              {copyText("app/features/media/AudioRevisionPanel.33")}
            </BareButton>
          </div>
          {input.sourceVersion !== track.version && (
            <p role="alert">
              {copyText("app/features/media/AudioRevisionPanel.34")}
            </p>
          )}
          <h4 className={styles.c17}>
            {copyText("app/features/media/AudioRevisionPanel.35")}
          </h4>
          <div className={styles.c16}>
            {history.data?.map((item) => (
              <BareButton
                key={item.id}
                className={button}
                onClick={() => select(item.id)}
              >
                {copyText("app/features/media/AudioRevisionPanel.36")}
                {item.id.slice(0, 8)} ·{" "}
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
            <div className={styles.c18} data-testid="audio-revision-diff">
              <p>
                {copyText("app/features/media/AudioRevisionPanel.37")}
                {value.id} ·{" "}
                {value.state === "pending"
                  ? "待确认"
                  : value.state === "confirmed"
                    ? "已确认"
                    : "已放弃"}{" "}
                ·{" "}
                {value.sourceState === "current"
                  ? "参考内容版本一致"
                  : "来源或竞争头已变，禁止确认"}
              </p>
              {value.reasons.map((reason) => (
                <p key={reason} className={styles.c5}>
                  {reason}
                </p>
              ))}
              <p>
                {copyText("app/features/media/AudioRevisionPanel.38")}
                {value.clipLinks.length}
                {copyText("app/features/media/AudioRevisionPanel.39")}{" "}
                {value.removedClipIds.length}
                {copyText("app/features/media/AudioRevisionPanel.40")}{" "}
                {value.addedClipIds.length}
                {copyText("app/features/media/AudioRevisionPanel.41")}
              </p>
              <div className={styles.c19}>
                <div className={styles.c20}>
                  <h5 className={styles.c17}>
                    {copyText("app/features/media/AudioRevisionPanel.42")}
                    {value.original.label}
                    {copyText("app/features/media/AudioRevisionPanel.11")}
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
                <div className={styles.c20}>
                  <h5 className={styles.c17}>
                    {copyText("app/features/media/AudioRevisionPanel.43")}
                    {value.candidate.label} · {value.candidate.kind}
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
                <p className={styles.c21}>
                  {copyText("app/features/media/AudioRevisionPanel.44")}
                  {value.removedClipIds.join("；")}
                  {copyText("app/features/media/AudioRevisionPanel.45")}
                </p>
              )}
              {value.state === "pending" && (
                <>
                  <div className={styles.c22}>
                    {checks.map((label, index) => (
                      <label key={label} className={styles.c23}>
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
                  <div className={styles.c16}>
                    <BareButton
                      className={button}
                      disabled={
                        busy ||
                        value.sourceState !== "current" ||
                        !reviewed.every(Boolean)
                      }
                      onClick={() => void transition("confirm")}
                    >
                      {copyText("app/features/media/AudioRevisionPanel.46")}
                    </BareButton>
                    <BareButton
                      className={button}
                      disabled={busy}
                      onClick={() => void transition("discard")}
                    >
                      {copyText("app/features/media/AudioRevisionPanel.47")}
                    </BareButton>
                  </div>
                </>
              )}
              {value.targetTrackId && (
                <p className={styles.c21}>
                  {copyText("app/features/media/AudioRevisionPanel.48")}
                  {value.targetTrackId}
                  {copyText("app/features/media/AudioRevisionPanel.49")}
                </p>
              )}
              {value.confirmation && (
                <p>
                  {copyText("app/features/media/AudioRevisionPanel.50")}
                  {value.confirmation.confirmedAt}
                  {copyText("app/features/media/AudioRevisionPanel.51")}
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
            <p role="status" className={styles.c24}>
              {notice}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
