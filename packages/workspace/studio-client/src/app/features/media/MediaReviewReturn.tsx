import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "../../query";
import { Link, useLocation } from "../../router";
import { BareButton } from "@dramaip/infra-ui-primitives";
import { useStudio, message } from "../../studio-shared";
import { readMediaReviewReturn } from "./media-review-return";
import { MediaSourceReviewPanel } from "./MediaSourceReviewPanel";
import { AudioRevisionPanel } from "./AudioRevisionPanel";
import { AudioResolutionPanel } from "./AudioResolutionPanel";
import styles from "./MediaReviewReturn.module.css";
import { copyText } from "../../copy";

/**
 * The media object a review link returns to. The media client's page frame
 * (P5-b) lays this out in its `media.review` slot and hands it the heading
 * copy it places inside its own section.
 */
export function MediaReviewReturn(props: {
  title: string;
  description: string;
}) {
  const client = useStudio();
  const cache = useQueryClient();
  const { search } = useLocation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const keys = useRef(new Map<string, string>());
  const query = useQuery({
    queryKey: ["media-review-return", search],
    queryFn: () => readMediaReviewReturn(client, search),
    refetchInterval: 5000,
    retry: false,
  });
  // Do not show formerly valid cached private details after identity/read failure.
  const value = query.error ? undefined : query.data;
  const adopt = async () => {
    if (
      value?.kind !== "revision" ||
      !value.target ||
      value.target.status !== "draft" ||
      value.review.state !== "confirmed" ||
      !value.review.isCurrent ||
      value.review.sourceState !== "current"
    )
      return;
    setBusy(true);
    setNotice(undefined);
    try {
      const identity = `${value.target.id}:${value.target.version}`;
      let key = keys.current.get(identity);
      if (!key) {
        key = crypto.randomUUID();
        keys.current.set(identity, key);
      }
      await client.episodeMedia.adoptAudioTrack(
        value.target.id,
        value.target.version,
        key,
      );
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["media-review-return"] }),
        cache.invalidateQueries({ queryKey: ["audio-revision"] }),
        cache.invalidateQueries({ queryKey: ["audio-tracks"] }),
        cache.invalidateQueries({ queryKey: ["pending-confirmations"] }),
      ]);
      setNotice(
        "已另行采用这个实际新草稿；旧轨、素材与时间线未改动，换源仍是独立决策。",
      );
    } catch (cause) {
      setNotice(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={styles.c1}
      aria-label={copyText("app/features/media/MediaReviewReturn.1")}
    >
      <h1 className={styles.c2}>{props.title}</h1>
      <p className={styles.c3}>{props.description}</p>
      <Link className={styles.c4} to="/pending">
        {copyText("app/features/media/MediaReviewReturn.2")}
      </Link>
      {query.isLoading && (
        <p>{copyText("app/features/media/MediaReviewReturn.3")}</p>
      )}
      {query.error && <p role="alert">{message(query.error)}</p>}
      {value && (
        <p className={styles.c5}>
          {copyText("app/features/media/MediaReviewReturn.4")}
          {value.review.id}
          {copyText("app/features/media/MediaReviewReturn.5")}
          {value.review.stateVersion}
        </p>
      )}
      {value?.kind === "source" && (
        <MediaSourceReviewPanel
          key={value.review.id}
          kind="media-records"
          recordId={value.review.recordId}
          shotId={value.review.shotId}
          requestedReviewId={value.review.id}
        />
      )}
      {value?.kind === "revision" && (
        <>
          <AudioRevisionPanel
            key={value.review.id}
            track={value.track}
            requestedReviewId={value.review.id}
          />
          {value.review.state === "confirmed" && (
            <div className={styles.c6}>
              <p>
                {copyText("app/features/media/MediaReviewReturn.6")}
                {value.target?.id ?? "不可用"}
                {copyText("app/features/media/MediaReviewReturn.7")}
                {value.target?.version ?? "未核验"} ·{" "}
                {value.target?.status ?? "缺失"}
                {copyText("app/features/media/MediaReviewReturn.8")}
              </p>
              <BareButton
                className={styles.c7}
                disabled={
                  busy ||
                  !value.review.isCurrent ||
                  value.review.sourceState !== "current" ||
                  value.target?.status !== "draft"
                }
                onClick={() => void adopt()}
              >
                {copyText("app/features/media/MediaReviewReturn.9")}
              </BareButton>
              {(!value.review.isCurrent ||
                value.review.sourceState !== "current") && (
                <p className={styles.c8}>
                  {copyText("app/features/media/MediaReviewReturn.10")}
                </p>
              )}
            </div>
          )}
        </>
      )}
      {value?.kind === "resolution" && (
        <AudioResolutionPanel
          key={value.review.id}
          timeline={value.review.before}
          requestedReviewId={value.review.id}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
