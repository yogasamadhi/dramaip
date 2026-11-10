/**
 * Wire types of the `timeline` Remote namespace: the shapes the
 * replaced `/api/v2` operations declare. Unconstrained parts are `JsonValue`.
 * @module @dramaip/production-timeline/types
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `timeline/audioResolutionsConfirm` (`audio-resolutions.confirm`). */
export type AudioResolutionsConfirmInput = {
  differencesReviewed: true;
  protectedEditsReviewed: true;
  authorIntentAndRightsReviewed: true;
};

/** Answer of `timeline/audioResolutionsConfirm` (`audio-resolutions.confirm`). */
export type AudioResolutionsConfirmResult = {
  id: string;
  timelineId: string;
  projectId: string;
  episodeId: string;
  state: "pending" | "confirmed" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  reasons: string[];
  isCurrent: boolean;
  before: {
    format: "dramaip-timeline";
    schemaVersion: 2;
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    sourceFingerprint: string;
    profile: {
      width: number;
      height: number;
      frameRate: {
        numerator: number;
        denominator: number;
        dropFrame: boolean;
      };
      audioSampleRate: number;
      channels: number;
    };
    timebase: "frames";
    durationFrames: number;
    migrationWarnings: string[];
    tracks: {
      id: string;
      kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
      label: string;
      muted: boolean;
      solo: boolean;
      clips: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      }[];
    }[];
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  after: {
    format: "dramaip-timeline";
    schemaVersion: 2;
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    sourceFingerprint: string;
    profile: {
      width: number;
      height: number;
      frameRate: {
        numerator: number;
        denominator: number;
        dropFrame: boolean;
      };
      audioSampleRate: number;
      channels: number;
    };
    timebase: "frames";
    durationFrames: number;
    migrationWarnings: string[];
    tracks: {
      id: string;
      kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
      label: string;
      muted: boolean;
      solo: boolean;
      clips: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      }[];
    }[];
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  changes: {
    input:
      | {
          action: "remove";
          clipId: string;
          reason: string;
        }
      | {
          action: "replace";
          clipId: string;
          audioTrackId: string;
          sourceClipId: string;
          subtitleText: "keep" | "replacement";
        };
    kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
    before: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    };
    after?: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    };
    target?: {
      track: {
        id: string;
        projectId: string;
        episodeId: string;
        kind: "dialogue" | "narration" | "bgm" | "sfx";
        label: string;
        sourceFingerprint: string;
        clips: {
          shotId?: string;
          assetId?: string;
          voiceProfileId?: string;
          startSeconds: number;
          durationSeconds: number;
          text?: string;
          id: string;
          sourceFingerprint?: string;
          sourceVersions?: {
            kind:
              | "shot"
              | "asset"
              | "voice-profile"
              | "voice-sample"
              | "voice-character";
            id: string;
            version: number;
          }[];
        }[];
        status: "draft" | "adopted";
        stale: boolean;
        staleReason?: string;
        sourceState: "current" | "stale" | "unverified";
        sourceReasons: string[];
        revision?: {
          reviewId: string;
          sourceTrackId: string;
          sourceVersion: number;
          clipLinks: {
            previousClipId: string;
            nextClipId: string;
          }[];
        };
        supersededBy?: string;
        version: number;
        createdAt: string;
        updatedAt: string;
      };
      sourceClipId: string;
      lineageReviewIds: string[];
      availableFrames: number;
    };
    originalSource?: {
      id: string;
      projectId: string;
      episodeId: string;
      kind: "dialogue" | "narration" | "bgm" | "sfx";
      label: string;
      sourceFingerprint: string;
      clips: {
        shotId?: string;
        assetId?: string;
        voiceProfileId?: string;
        startSeconds: number;
        durationSeconds: number;
        text?: string;
        id: string;
        sourceFingerprint?: string;
        sourceVersions?: {
          kind:
            | "shot"
            | "asset"
            | "voice-profile"
            | "voice-sample"
            | "voice-character";
          id: string;
          version: number;
        }[];
      }[];
      status: "draft" | "adopted";
      stale: boolean;
      staleReason?: string;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      revision?: {
        reviewId: string;
        sourceTrackId: string;
        sourceVersion: number;
        clipLinks: {
          previousClipId: string;
          nextClipId: string;
        }[];
      };
      supersededBy?: string;
      version: number;
      createdAt: string;
      updatedAt: string;
    };
  }[];
  warnings: string[];
  confirmation?: {
    differencesReviewed: true;
    protectedEditsReviewed: true;
    authorIntentAndRightsReviewed: true;
    confirmedAt: string;
  };
  resultTimelineVersion?: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `timeline/audioResolutionsDiscard` (`audio-resolutions.discard`). */
export type AudioResolutionsDiscardInput = Record<string, JsonValue>;

/** Answer of `timeline/audioResolutionsDiscard` (`audio-resolutions.discard`). */
export type AudioResolutionsDiscardResult = {
  id: string;
  timelineId: string;
  projectId: string;
  episodeId: string;
  state: "pending" | "confirmed" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  reasons: string[];
  isCurrent: boolean;
  before: {
    format: "dramaip-timeline";
    schemaVersion: 2;
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    sourceFingerprint: string;
    profile: {
      width: number;
      height: number;
      frameRate: {
        numerator: number;
        denominator: number;
        dropFrame: boolean;
      };
      audioSampleRate: number;
      channels: number;
    };
    timebase: "frames";
    durationFrames: number;
    migrationWarnings: string[];
    tracks: {
      id: string;
      kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
      label: string;
      muted: boolean;
      solo: boolean;
      clips: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      }[];
    }[];
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  after: {
    format: "dramaip-timeline";
    schemaVersion: 2;
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    sourceFingerprint: string;
    profile: {
      width: number;
      height: number;
      frameRate: {
        numerator: number;
        denominator: number;
        dropFrame: boolean;
      };
      audioSampleRate: number;
      channels: number;
    };
    timebase: "frames";
    durationFrames: number;
    migrationWarnings: string[];
    tracks: {
      id: string;
      kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
      label: string;
      muted: boolean;
      solo: boolean;
      clips: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      }[];
    }[];
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  changes: {
    input:
      | {
          action: "remove";
          clipId: string;
          reason: string;
        }
      | {
          action: "replace";
          clipId: string;
          audioTrackId: string;
          sourceClipId: string;
          subtitleText: "keep" | "replacement";
        };
    kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
    before: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    };
    after?: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    };
    target?: {
      track: {
        id: string;
        projectId: string;
        episodeId: string;
        kind: "dialogue" | "narration" | "bgm" | "sfx";
        label: string;
        sourceFingerprint: string;
        clips: {
          shotId?: string;
          assetId?: string;
          voiceProfileId?: string;
          startSeconds: number;
          durationSeconds: number;
          text?: string;
          id: string;
          sourceFingerprint?: string;
          sourceVersions?: {
            kind:
              | "shot"
              | "asset"
              | "voice-profile"
              | "voice-sample"
              | "voice-character";
            id: string;
            version: number;
          }[];
        }[];
        status: "draft" | "adopted";
        stale: boolean;
        staleReason?: string;
        sourceState: "current" | "stale" | "unverified";
        sourceReasons: string[];
        revision?: {
          reviewId: string;
          sourceTrackId: string;
          sourceVersion: number;
          clipLinks: {
            previousClipId: string;
            nextClipId: string;
          }[];
        };
        supersededBy?: string;
        version: number;
        createdAt: string;
        updatedAt: string;
      };
      sourceClipId: string;
      lineageReviewIds: string[];
      availableFrames: number;
    };
    originalSource?: {
      id: string;
      projectId: string;
      episodeId: string;
      kind: "dialogue" | "narration" | "bgm" | "sfx";
      label: string;
      sourceFingerprint: string;
      clips: {
        shotId?: string;
        assetId?: string;
        voiceProfileId?: string;
        startSeconds: number;
        durationSeconds: number;
        text?: string;
        id: string;
        sourceFingerprint?: string;
        sourceVersions?: {
          kind:
            | "shot"
            | "asset"
            | "voice-profile"
            | "voice-sample"
            | "voice-character";
          id: string;
          version: number;
        }[];
      }[];
      status: "draft" | "adopted";
      stale: boolean;
      staleReason?: string;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      revision?: {
        reviewId: string;
        sourceTrackId: string;
        sourceVersion: number;
        clipLinks: {
          previousClipId: string;
          nextClipId: string;
        }[];
      };
      supersededBy?: string;
      version: number;
      createdAt: string;
      updatedAt: string;
    };
  }[];
  warnings: string[];
  confirmation?: {
    differencesReviewed: true;
    protectedEditsReviewed: true;
    authorIntentAndRightsReviewed: true;
    confirmedAt: string;
  };
  resultTimelineVersion?: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `timeline/audioResolutionsGet` (`audio-resolutions.get`). */
export type AudioResolutionsGetResult = {
  id: string;
  timelineId: string;
  projectId: string;
  episodeId: string;
  state: "pending" | "confirmed" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  reasons: string[];
  isCurrent: boolean;
  before: {
    format: "dramaip-timeline";
    schemaVersion: 2;
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    sourceFingerprint: string;
    profile: {
      width: number;
      height: number;
      frameRate: {
        numerator: number;
        denominator: number;
        dropFrame: boolean;
      };
      audioSampleRate: number;
      channels: number;
    };
    timebase: "frames";
    durationFrames: number;
    migrationWarnings: string[];
    tracks: {
      id: string;
      kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
      label: string;
      muted: boolean;
      solo: boolean;
      clips: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      }[];
    }[];
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  after: {
    format: "dramaip-timeline";
    schemaVersion: 2;
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    sourceFingerprint: string;
    profile: {
      width: number;
      height: number;
      frameRate: {
        numerator: number;
        denominator: number;
        dropFrame: boolean;
      };
      audioSampleRate: number;
      channels: number;
    };
    timebase: "frames";
    durationFrames: number;
    migrationWarnings: string[];
    tracks: {
      id: string;
      kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
      label: string;
      muted: boolean;
      solo: boolean;
      clips: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      }[];
    }[];
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  changes: {
    input:
      | {
          action: "remove";
          clipId: string;
          reason: string;
        }
      | {
          action: "replace";
          clipId: string;
          audioTrackId: string;
          sourceClipId: string;
          subtitleText: "keep" | "replacement";
        };
    kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
    before: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    };
    after?: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    };
    target?: {
      track: {
        id: string;
        projectId: string;
        episodeId: string;
        kind: "dialogue" | "narration" | "bgm" | "sfx";
        label: string;
        sourceFingerprint: string;
        clips: {
          shotId?: string;
          assetId?: string;
          voiceProfileId?: string;
          startSeconds: number;
          durationSeconds: number;
          text?: string;
          id: string;
          sourceFingerprint?: string;
          sourceVersions?: {
            kind:
              | "shot"
              | "asset"
              | "voice-profile"
              | "voice-sample"
              | "voice-character";
            id: string;
            version: number;
          }[];
        }[];
        status: "draft" | "adopted";
        stale: boolean;
        staleReason?: string;
        sourceState: "current" | "stale" | "unverified";
        sourceReasons: string[];
        revision?: {
          reviewId: string;
          sourceTrackId: string;
          sourceVersion: number;
          clipLinks: {
            previousClipId: string;
            nextClipId: string;
          }[];
        };
        supersededBy?: string;
        version: number;
        createdAt: string;
        updatedAt: string;
      };
      sourceClipId: string;
      lineageReviewIds: string[];
      availableFrames: number;
    };
    originalSource?: {
      id: string;
      projectId: string;
      episodeId: string;
      kind: "dialogue" | "narration" | "bgm" | "sfx";
      label: string;
      sourceFingerprint: string;
      clips: {
        shotId?: string;
        assetId?: string;
        voiceProfileId?: string;
        startSeconds: number;
        durationSeconds: number;
        text?: string;
        id: string;
        sourceFingerprint?: string;
        sourceVersions?: {
          kind:
            | "shot"
            | "asset"
            | "voice-profile"
            | "voice-sample"
            | "voice-character";
          id: string;
          version: number;
        }[];
      }[];
      status: "draft" | "adopted";
      stale: boolean;
      staleReason?: string;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      revision?: {
        reviewId: string;
        sourceTrackId: string;
        sourceVersion: number;
        clipLinks: {
          previousClipId: string;
          nextClipId: string;
        }[];
      };
      supersededBy?: string;
      version: number;
      createdAt: string;
      updatedAt: string;
    };
  }[];
  warnings: string[];
  confirmation?: {
    differencesReviewed: true;
    protectedEditsReviewed: true;
    authorIntentAndRightsReviewed: true;
    confirmedAt: string;
  };
  resultTimelineVersion?: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `timeline/audioResolutionsList` (`audio-resolutions.list`). */
export type AudioResolutionsListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `timeline/audioResolutionsList` (`audio-resolutions.list`). */
export type AudioResolutionsListResult = {
  items: {
    id: string;
    timelineId: string;
    projectId: string;
    episodeId: string;
    state: "pending" | "confirmed" | "discarded";
    stateVersion: number;
    sourceState: "current" | "stale";
    reasons: string[];
    isCurrent: boolean;
    before: {
      format: "dramaip-timeline";
      schemaVersion: 2;
      id: string;
      projectId: string;
      adaptationId: string;
      episodeId: string;
      sourceFingerprint: string;
      profile: {
        width: number;
        height: number;
        frameRate: {
          numerator: number;
          denominator: number;
          dropFrame: boolean;
        };
        audioSampleRate: number;
        channels: number;
      };
      timebase: "frames";
      durationFrames: number;
      migrationWarnings: string[];
      tracks: {
        id: string;
        kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
        label: string;
        muted: boolean;
        solo: boolean;
        clips: {
          id: string;
          sourceClipId?: string;
          shotId?: string;
          assetId?: string;
          assetVersion?: number;
          audioTrackId?: string;
          audioTrackVersion?: number;
          audioSourceFingerprint?: string;
          mediaRef?: string;
          trackId: string;
          name: string;
          startFrame: number;
          durationFrames: number;
          sourceOffsetFrame: number;
          mediaStatus:
            "linked" | "missing" | "unsupported" | "proxy" | "unattached";
          text?: string;
          volume?: number;
          fadeInFrames?: number;
          fadeOutFrames?: number;
          duckingGain?: number;
          locked?: boolean;
          manuallyEdited: boolean;
        }[];
      }[];
      version: number;
      createdAt: string;
      updatedAt: string;
    };
    after: {
      format: "dramaip-timeline";
      schemaVersion: 2;
      id: string;
      projectId: string;
      adaptationId: string;
      episodeId: string;
      sourceFingerprint: string;
      profile: {
        width: number;
        height: number;
        frameRate: {
          numerator: number;
          denominator: number;
          dropFrame: boolean;
        };
        audioSampleRate: number;
        channels: number;
      };
      timebase: "frames";
      durationFrames: number;
      migrationWarnings: string[];
      tracks: {
        id: string;
        kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
        label: string;
        muted: boolean;
        solo: boolean;
        clips: {
          id: string;
          sourceClipId?: string;
          shotId?: string;
          assetId?: string;
          assetVersion?: number;
          audioTrackId?: string;
          audioTrackVersion?: number;
          audioSourceFingerprint?: string;
          mediaRef?: string;
          trackId: string;
          name: string;
          startFrame: number;
          durationFrames: number;
          sourceOffsetFrame: number;
          mediaStatus:
            "linked" | "missing" | "unsupported" | "proxy" | "unattached";
          text?: string;
          volume?: number;
          fadeInFrames?: number;
          fadeOutFrames?: number;
          duckingGain?: number;
          locked?: boolean;
          manuallyEdited: boolean;
        }[];
      }[];
      version: number;
      createdAt: string;
      updatedAt: string;
    };
    changes: {
      input:
        | {
            action: "remove";
            clipId: string;
            reason: string;
          }
        | {
            action: "replace";
            clipId: string;
            audioTrackId: string;
            sourceClipId: string;
            subtitleText: "keep" | "replacement";
          };
      kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
      before: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      };
      after?: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      };
      target?: {
        track: {
          id: string;
          projectId: string;
          episodeId: string;
          kind: "dialogue" | "narration" | "bgm" | "sfx";
          label: string;
          sourceFingerprint: string;
          clips: {
            shotId?: string;
            assetId?: string;
            voiceProfileId?: string;
            startSeconds: number;
            durationSeconds: number;
            text?: string;
            id: string;
            sourceFingerprint?: string;
            sourceVersions?: {
              kind:
                | "shot"
                | "asset"
                | "voice-profile"
                | "voice-sample"
                | "voice-character";
              id: string;
              version: number;
            }[];
          }[];
          status: "draft" | "adopted";
          stale: boolean;
          staleReason?: string;
          sourceState: "current" | "stale" | "unverified";
          sourceReasons: string[];
          revision?: {
            reviewId: string;
            sourceTrackId: string;
            sourceVersion: number;
            clipLinks: {
              previousClipId: string;
              nextClipId: string;
            }[];
          };
          supersededBy?: string;
          version: number;
          createdAt: string;
          updatedAt: string;
        };
        sourceClipId: string;
        lineageReviewIds: string[];
        availableFrames: number;
      };
      originalSource?: {
        id: string;
        projectId: string;
        episodeId: string;
        kind: "dialogue" | "narration" | "bgm" | "sfx";
        label: string;
        sourceFingerprint: string;
        clips: {
          shotId?: string;
          assetId?: string;
          voiceProfileId?: string;
          startSeconds: number;
          durationSeconds: number;
          text?: string;
          id: string;
          sourceFingerprint?: string;
          sourceVersions?: {
            kind:
              | "shot"
              | "asset"
              | "voice-profile"
              | "voice-sample"
              | "voice-character";
            id: string;
            version: number;
          }[];
        }[];
        status: "draft" | "adopted";
        stale: boolean;
        staleReason?: string;
        sourceState: "current" | "stale" | "unverified";
        sourceReasons: string[];
        revision?: {
          reviewId: string;
          sourceTrackId: string;
          sourceVersion: number;
          clipLinks: {
            previousClipId: string;
            nextClipId: string;
          }[];
        };
        supersededBy?: string;
        version: number;
        createdAt: string;
        updatedAt: string;
      };
    }[];
    warnings: string[];
    confirmation?: {
      differencesReviewed: true;
      protectedEditsReviewed: true;
      authorIntentAndRightsReviewed: true;
      confirmedAt: string;
    };
    resultTimelineVersion?: number;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Answer of `timeline/audioResolutionsOptions` (`audio-resolutions.options`). */
export type AudioResolutionsOptionsResult = {
  timelineId: string;
  timelineVersion: number;
  items: {
    clip: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    };
    kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
    sourceTrack?: {
      id: string;
      projectId: string;
      episodeId: string;
      kind: "dialogue" | "narration" | "bgm" | "sfx";
      label: string;
      sourceFingerprint: string;
      clips: {
        shotId?: string;
        assetId?: string;
        voiceProfileId?: string;
        startSeconds: number;
        durationSeconds: number;
        text?: string;
        id: string;
        sourceFingerprint?: string;
        sourceVersions?: {
          kind:
            | "shot"
            | "asset"
            | "voice-profile"
            | "voice-sample"
            | "voice-character";
          id: string;
          version: number;
        }[];
      }[];
      status: "draft" | "adopted";
      stale: boolean;
      staleReason?: string;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      revision?: {
        reviewId: string;
        sourceTrackId: string;
        sourceVersion: number;
        clipLinks: {
          previousClipId: string;
          nextClipId: string;
        }[];
      };
      supersededBy?: string;
      version: number;
      createdAt: string;
      updatedAt: string;
    };
    sourceState: "current" | "stale" | "unverified";
    reasons: string[];
    replacements: {
      track: {
        id: string;
        projectId: string;
        episodeId: string;
        kind: "dialogue" | "narration" | "bgm" | "sfx";
        label: string;
        sourceFingerprint: string;
        clips: {
          shotId?: string;
          assetId?: string;
          voiceProfileId?: string;
          startSeconds: number;
          durationSeconds: number;
          text?: string;
          id: string;
          sourceFingerprint?: string;
          sourceVersions?: {
            kind:
              | "shot"
              | "asset"
              | "voice-profile"
              | "voice-sample"
              | "voice-character";
            id: string;
            version: number;
          }[];
        }[];
        status: "draft" | "adopted";
        stale: boolean;
        staleReason?: string;
        sourceState: "current" | "stale" | "unverified";
        sourceReasons: string[];
        revision?: {
          reviewId: string;
          sourceTrackId: string;
          sourceVersion: number;
          clipLinks: {
            previousClipId: string;
            nextClipId: string;
          }[];
        };
        supersededBy?: string;
        version: number;
        createdAt: string;
        updatedAt: string;
      };
      sourceClipId: string;
      lineageReviewIds: string[];
      availableFrames: number;
    }[];
  }[];
};

/** Input of `timeline/audioResolutionsPreview` (`audio-resolutions.preview`). */
export type AudioResolutionsPreviewInput = {
  timelineVersion: number;
  changes: (
    | {
        action: "remove";
        clipId: string;
        reason: string;
      }
    | {
        action: "replace";
        clipId: string;
        audioTrackId: string;
        sourceClipId: string;
        subtitleText: "keep" | "replacement";
      }
  )[];
};

/** Answer of `timeline/audioResolutionsPreview` (`audio-resolutions.preview`). */
export type AudioResolutionsPreviewResult = {
  id: string;
  timelineId: string;
  projectId: string;
  episodeId: string;
  state: "pending" | "confirmed" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  reasons: string[];
  isCurrent: boolean;
  before: {
    format: "dramaip-timeline";
    schemaVersion: 2;
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    sourceFingerprint: string;
    profile: {
      width: number;
      height: number;
      frameRate: {
        numerator: number;
        denominator: number;
        dropFrame: boolean;
      };
      audioSampleRate: number;
      channels: number;
    };
    timebase: "frames";
    durationFrames: number;
    migrationWarnings: string[];
    tracks: {
      id: string;
      kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
      label: string;
      muted: boolean;
      solo: boolean;
      clips: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      }[];
    }[];
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  after: {
    format: "dramaip-timeline";
    schemaVersion: 2;
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    sourceFingerprint: string;
    profile: {
      width: number;
      height: number;
      frameRate: {
        numerator: number;
        denominator: number;
        dropFrame: boolean;
      };
      audioSampleRate: number;
      channels: number;
    };
    timebase: "frames";
    durationFrames: number;
    migrationWarnings: string[];
    tracks: {
      id: string;
      kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
      label: string;
      muted: boolean;
      solo: boolean;
      clips: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      }[];
    }[];
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  changes: {
    input:
      | {
          action: "remove";
          clipId: string;
          reason: string;
        }
      | {
          action: "replace";
          clipId: string;
          audioTrackId: string;
          sourceClipId: string;
          subtitleText: "keep" | "replacement";
        };
    kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
    before: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    };
    after?: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    };
    target?: {
      track: {
        id: string;
        projectId: string;
        episodeId: string;
        kind: "dialogue" | "narration" | "bgm" | "sfx";
        label: string;
        sourceFingerprint: string;
        clips: {
          shotId?: string;
          assetId?: string;
          voiceProfileId?: string;
          startSeconds: number;
          durationSeconds: number;
          text?: string;
          id: string;
          sourceFingerprint?: string;
          sourceVersions?: {
            kind:
              | "shot"
              | "asset"
              | "voice-profile"
              | "voice-sample"
              | "voice-character";
            id: string;
            version: number;
          }[];
        }[];
        status: "draft" | "adopted";
        stale: boolean;
        staleReason?: string;
        sourceState: "current" | "stale" | "unverified";
        sourceReasons: string[];
        revision?: {
          reviewId: string;
          sourceTrackId: string;
          sourceVersion: number;
          clipLinks: {
            previousClipId: string;
            nextClipId: string;
          }[];
        };
        supersededBy?: string;
        version: number;
        createdAt: string;
        updatedAt: string;
      };
      sourceClipId: string;
      lineageReviewIds: string[];
      availableFrames: number;
    };
    originalSource?: {
      id: string;
      projectId: string;
      episodeId: string;
      kind: "dialogue" | "narration" | "bgm" | "sfx";
      label: string;
      sourceFingerprint: string;
      clips: {
        shotId?: string;
        assetId?: string;
        voiceProfileId?: string;
        startSeconds: number;
        durationSeconds: number;
        text?: string;
        id: string;
        sourceFingerprint?: string;
        sourceVersions?: {
          kind:
            | "shot"
            | "asset"
            | "voice-profile"
            | "voice-sample"
            | "voice-character";
          id: string;
          version: number;
        }[];
      }[];
      status: "draft" | "adopted";
      stale: boolean;
      staleReason?: string;
      sourceState: "current" | "stale" | "unverified";
      sourceReasons: string[];
      revision?: {
        reviewId: string;
        sourceTrackId: string;
        sourceVersion: number;
        clipLinks: {
          previousClipId: string;
          nextClipId: string;
        }[];
      };
      supersededBy?: string;
      version: number;
      createdAt: string;
      updatedAt: string;
    };
  }[];
  warnings: string[];
  confirmation?: {
    differencesReviewed: true;
    protectedEditsReviewed: true;
    authorIntentAndRightsReviewed: true;
    confirmedAt: string;
  };
  resultTimelineVersion?: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `timeline/audioResolutionsSummaries` (`audio-resolutions.summaries`). */
export type AudioResolutionsSummariesQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `timeline/audioResolutionsSummaries` (`audio-resolutions.summaries`). */
export type AudioResolutionsSummariesResult = {
  items: {
    id: string;
    timelineId: string;
    projectId: string;
    episodeId: string;
    state: "pending" | "confirmed" | "discarded";
    stateVersion: number;
    sourceState: "current" | "stale";
    isCurrent: boolean;
    resultTimelineVersion?: number;
    createdAt: string;
    updatedAt: string;
    timelineVersion: number;
    changeCount: number;
    replaceCount: number;
    removeCount: number;
    protectedCount: number;
    reasonCount: number;
  }[];
  nextCursor?: string;
};

/** Input of `timeline/mediaCopiesCancel` (`timeline-media-copies.cancel`). */
export type MediaCopiesCancelInput = {
  projectId: string;
};

/** Answer of `timeline/mediaCopiesCancel` (`timeline-media-copies.cancel`). */
export type MediaCopiesCancelResult = {
  id: string;
  version: number;
  requestHash: string;
  scope: {
    projectId: string;
    episodeId: string;
    timelineId: string;
    timelineVersion: number;
    sourceFingerprint: string;
  };
  status:
    | "submission-unknown"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "canceled"
    | "interrupted"
    | "source-changed";
  createdAt: string;
  updatedAt: string;
  currentBinding: "unchanged-metadata" | "changed-metadata" | "unavailable";
  copy?: {
    artifactRef: string;
    receipt: {
      format: "dramaip-nle-media-copy-receipt";
      schemaVersion: 1;
      packageRef: string;
      projectId: string;
      episodeId: string;
      timelineId: string;
      timelineVersion: number;
      sourceFingerprint: string;
      verifiedAt: string;
      evidence: "complete-copy-and-destination-re-read-at-recorded-time";
      qualityState: "unverified";
      rightsState: "unverified";
      billingState: "unknown";
      files: (
        | {
            kind: "media";
            relativePath: string;
            sizeBytes: number;
            sha256: string;
            source: {
              assetId: string;
              recordVersion: number;
              artifactId: string;
            };
          }
        | {
            kind: "document";
            relativePath:
              | "timeline.fcpxml"
              | "timeline.otio"
              | "timeline.edl"
              | "subtitles.srt"
              | "subtitles.vtt"
              | "relink.json"
              | "timeline-manifest.json";
            sizeBytes: number;
            sha256: string;
          }
      )[];
    };
    receiptSha256: string;
    receiptBytes: number;
  };
  failureCode?:
    | "COPY_FAILED"
    | "COPY_ABORTED"
    | "COPY_INTERRUPTED"
    | "COPY_JOURNAL_UNAVAILABLE"
    | "ORIGINAL_SOURCE_CHANGED";
  scratchState?: "not-created" | "cleaned" | "retained-unpublished";
};

/** Input of `timeline/mediaCopiesCreate` (`timeline-media-copies.create`). */
export type MediaCopiesCreateInput = {
  manifest: {
    format: "dramaip-timeline-delivery";
    schemaVersion: 3;
    timeline: {
      format: "dramaip-timeline";
      schemaVersion: 2;
      id: string;
      projectId: string;
      adaptationId: string;
      episodeId: string;
      sourceFingerprint: string;
      profile: {
        width: number;
        height: number;
        frameRate: {
          numerator: number;
          denominator: number;
          dropFrame: boolean;
        };
        audioSampleRate: number;
        channels: number;
      };
      timebase: "frames";
      durationFrames: number;
      migrationWarnings: string[];
      tracks: {
        id: string;
        kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
        label: string;
        muted: boolean;
        solo: boolean;
        clips: {
          id: string;
          sourceClipId?: string;
          shotId?: string;
          assetId?: string;
          assetVersion?: number;
          audioTrackId?: string;
          audioTrackVersion?: number;
          audioSourceFingerprint?: string;
          mediaRef?: string;
          trackId: string;
          name: string;
          startFrame: number;
          durationFrames: number;
          sourceOffsetFrame: number;
          mediaStatus:
            "linked" | "missing" | "unsupported" | "proxy" | "unattached";
          text?: string;
          volume?: number;
          fadeInFrames?: number;
          fadeOutFrames?: number;
          duckingGain?: number;
          locked?: boolean;
          manuallyEdited: boolean;
        }[];
      }[];
      version: number;
      createdAt: string;
      updatedAt: string;
    };
    sourceFingerprint: string;
    media: {
      assetId: string;
      title: string;
      clipIds: string[];
      expectedVersions: number[];
      sourceVersion?: number;
      sourceStatus: "current" | "unverified" | "stale" | "missing" | "foreign";
      relativePath: string;
      checksum?: string;
      archive?: {
        artifactRef: string;
        kind: "image" | "audio" | "video";
        mimeType: string;
        extension: string;
        sizeBytes: number;
        sha256: string;
        verification: "owner-metadata-only";
      };
      mediaStatus: "unattached";
      rightsStatus: "unknown" | "restricted";
      rightsDeclaration:
        "not-provided" | "user-reported-cleared" | "user-reported-restricted";
      lineage: string[];
    }[];
    sourceBlockers: {
      clipId: string;
      code: "MISSING_MEDIA" | "UNVERIFIED_SOURCE" | "STALE_SOURCE";
      message: string;
    }[];
    unsupportedFeatures: string[];
    warnings: string[];
  };
  directory: {
    scope: {
      projectId: string;
      episodeId: string;
      timelineId: string;
      timelineVersion: number;
      sourceFingerprint: string;
    };
    grant: {
      grantId: string;
      permission: "write-directory";
      displayName: string;
      expiresAt: string;
      generation: number;
    } | null;
  };
  purpose: "local-nle-handoff";
  acknowledgedLimits: true;
};

/** Answer of `timeline/mediaCopiesCreate` (`timeline-media-copies.create`). */
export type MediaCopiesCreateResult = {
  id: string;
  version: number;
  requestHash: string;
  scope: {
    projectId: string;
    episodeId: string;
    timelineId: string;
    timelineVersion: number;
    sourceFingerprint: string;
  };
  status:
    | "submission-unknown"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "canceled"
    | "interrupted"
    | "source-changed";
  createdAt: string;
  updatedAt: string;
  currentBinding: "unchanged-metadata" | "changed-metadata" | "unavailable";
  copy?: {
    artifactRef: string;
    receipt: {
      format: "dramaip-nle-media-copy-receipt";
      schemaVersion: 1;
      packageRef: string;
      projectId: string;
      episodeId: string;
      timelineId: string;
      timelineVersion: number;
      sourceFingerprint: string;
      verifiedAt: string;
      evidence: "complete-copy-and-destination-re-read-at-recorded-time";
      qualityState: "unverified";
      rightsState: "unverified";
      billingState: "unknown";
      files: (
        | {
            kind: "media";
            relativePath: string;
            sizeBytes: number;
            sha256: string;
            source: {
              assetId: string;
              recordVersion: number;
              artifactId: string;
            };
          }
        | {
            kind: "document";
            relativePath:
              | "timeline.fcpxml"
              | "timeline.otio"
              | "timeline.edl"
              | "subtitles.srt"
              | "subtitles.vtt"
              | "relink.json"
              | "timeline-manifest.json";
            sizeBytes: number;
            sha256: string;
          }
      )[];
    };
    receiptSha256: string;
    receiptBytes: number;
  };
  failureCode?:
    | "COPY_FAILED"
    | "COPY_ABORTED"
    | "COPY_INTERRUPTED"
    | "COPY_JOURNAL_UNAVAILABLE"
    | "ORIGINAL_SOURCE_CHANGED";
  scratchState?: "not-created" | "cleaned" | "retained-unpublished";
};

/** Query of `timeline/mediaCopiesGet` (`timeline-media-copies.get`). */
export type MediaCopiesGetQuery = {
  projectId: string;
};

/** Answer of `timeline/mediaCopiesGet` (`timeline-media-copies.get`). */
export type MediaCopiesGetResult = {
  id: string;
  version: number;
  requestHash: string;
  scope: {
    projectId: string;
    episodeId: string;
    timelineId: string;
    timelineVersion: number;
    sourceFingerprint: string;
  };
  status:
    | "submission-unknown"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "canceled"
    | "interrupted"
    | "source-changed";
  createdAt: string;
  updatedAt: string;
  currentBinding: "unchanged-metadata" | "changed-metadata" | "unavailable";
  copy?: {
    artifactRef: string;
    receipt: {
      format: "dramaip-nle-media-copy-receipt";
      schemaVersion: 1;
      packageRef: string;
      projectId: string;
      episodeId: string;
      timelineId: string;
      timelineVersion: number;
      sourceFingerprint: string;
      verifiedAt: string;
      evidence: "complete-copy-and-destination-re-read-at-recorded-time";
      qualityState: "unverified";
      rightsState: "unverified";
      billingState: "unknown";
      files: (
        | {
            kind: "media";
            relativePath: string;
            sizeBytes: number;
            sha256: string;
            source: {
              assetId: string;
              recordVersion: number;
              artifactId: string;
            };
          }
        | {
            kind: "document";
            relativePath:
              | "timeline.fcpxml"
              | "timeline.otio"
              | "timeline.edl"
              | "subtitles.srt"
              | "subtitles.vtt"
              | "relink.json"
              | "timeline-manifest.json";
            sizeBytes: number;
            sha256: string;
          }
      )[];
    };
    receiptSha256: string;
    receiptBytes: number;
  };
  failureCode?:
    | "COPY_FAILED"
    | "COPY_ABORTED"
    | "COPY_INTERRUPTED"
    | "COPY_JOURNAL_UNAVAILABLE"
    | "ORIGINAL_SOURCE_CHANGED";
  scratchState?: "not-created" | "cleaned" | "retained-unpublished";
};

/** Query of `timeline/mediaCopiesList` (`timeline-media-copies.list`). */
export type MediaCopiesListQuery = {
  projectId: string;
  limit?: number;
  cursor?: string;
};

/** Answer of `timeline/mediaCopiesList` (`timeline-media-copies.list`). */
export type MediaCopiesListResult = {
  timelineId: string;
  projectId: string;
  items: {
    id: string;
    version: number;
    requestHash: string;
    scope: {
      projectId: string;
      episodeId: string;
      timelineId: string;
      timelineVersion: number;
      sourceFingerprint: string;
    };
    status:
      | "submission-unknown"
      | "queued"
      | "running"
      | "completed"
      | "failed"
      | "canceled"
      | "interrupted"
      | "source-changed";
    createdAt: string;
    updatedAt: string;
    currentBinding: "unchanged-metadata" | "changed-metadata" | "unavailable";
    copy?: {
      artifactRef: string;
      receipt: {
        format: "dramaip-nle-media-copy-receipt";
        schemaVersion: 1;
        packageRef: string;
        projectId: string;
        episodeId: string;
        timelineId: string;
        timelineVersion: number;
        sourceFingerprint: string;
        verifiedAt: string;
        evidence: "complete-copy-and-destination-re-read-at-recorded-time";
        qualityState: "unverified";
        rightsState: "unverified";
        billingState: "unknown";
        files: (
          | {
              kind: "media";
              relativePath: string;
              sizeBytes: number;
              sha256: string;
              source: {
                assetId: string;
                recordVersion: number;
                artifactId: string;
              };
            }
          | {
              kind: "document";
              relativePath:
                | "timeline.fcpxml"
                | "timeline.otio"
                | "timeline.edl"
                | "subtitles.srt"
                | "subtitles.vtt"
                | "relink.json"
                | "timeline-manifest.json";
              sizeBytes: number;
              sha256: string;
            }
        )[];
      };
      receiptSha256: string;
      receiptBytes: number;
    };
    failureCode?:
      | "COPY_FAILED"
      | "COPY_ABORTED"
      | "COPY_INTERRUPTED"
      | "COPY_JOURNAL_UNAVAILABLE"
      | "ORIGINAL_SOURCE_CHANGED";
    scratchState?: "not-created" | "cleaned" | "retained-unpublished";
  }[];
  nextCursor?: string;
};

/** Input of `timeline/mediaCopiesRefresh` (`timeline-media-copies.refresh`). */
export type MediaCopiesRefreshInput = {
  projectId: string;
};

/** Answer of `timeline/mediaCopiesRefresh` (`timeline-media-copies.refresh`). */
export type MediaCopiesRefreshResult = {
  id: string;
  version: number;
  requestHash: string;
  scope: {
    projectId: string;
    episodeId: string;
    timelineId: string;
    timelineVersion: number;
    sourceFingerprint: string;
  };
  status:
    | "submission-unknown"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "canceled"
    | "interrupted"
    | "source-changed";
  createdAt: string;
  updatedAt: string;
  currentBinding: "unchanged-metadata" | "changed-metadata" | "unavailable";
  copy?: {
    artifactRef: string;
    receipt: {
      format: "dramaip-nle-media-copy-receipt";
      schemaVersion: 1;
      packageRef: string;
      projectId: string;
      episodeId: string;
      timelineId: string;
      timelineVersion: number;
      sourceFingerprint: string;
      verifiedAt: string;
      evidence: "complete-copy-and-destination-re-read-at-recorded-time";
      qualityState: "unverified";
      rightsState: "unverified";
      billingState: "unknown";
      files: (
        | {
            kind: "media";
            relativePath: string;
            sizeBytes: number;
            sha256: string;
            source: {
              assetId: string;
              recordVersion: number;
              artifactId: string;
            };
          }
        | {
            kind: "document";
            relativePath:
              | "timeline.fcpxml"
              | "timeline.otio"
              | "timeline.edl"
              | "subtitles.srt"
              | "subtitles.vtt"
              | "relink.json"
              | "timeline-manifest.json";
            sizeBytes: number;
            sha256: string;
          }
      )[];
    };
    receiptSha256: string;
    receiptBytes: number;
  };
  failureCode?:
    | "COPY_FAILED"
    | "COPY_ABORTED"
    | "COPY_INTERRUPTED"
    | "COPY_JOURNAL_UNAVAILABLE"
    | "ORIGINAL_SOURCE_CHANGED";
  scratchState?: "not-created" | "cleaned" | "retained-unpublished";
};

/** Input of `timeline/mediaCopiesReveal` (`timeline-media-copies.reveal`). */
export type MediaCopiesRevealInput = {
  projectId: string;
  artifactRef: string;
};

/** Answer of `timeline/mediaCopiesReveal` (`timeline-media-copies.reveal`). */
export type MediaCopiesRevealResult = {
  revealed: true;
};

/** Input of `timeline/mediaCopiesSelectDirectory` (`timeline-media-copies.selectDirectory`). */
export type MediaCopiesSelectDirectoryInput = {
  manifest: {
    format: "dramaip-timeline-delivery";
    schemaVersion: 3;
    timeline: {
      format: "dramaip-timeline";
      schemaVersion: 2;
      id: string;
      projectId: string;
      adaptationId: string;
      episodeId: string;
      sourceFingerprint: string;
      profile: {
        width: number;
        height: number;
        frameRate: {
          numerator: number;
          denominator: number;
          dropFrame: boolean;
        };
        audioSampleRate: number;
        channels: number;
      };
      timebase: "frames";
      durationFrames: number;
      migrationWarnings: string[];
      tracks: {
        id: string;
        kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
        label: string;
        muted: boolean;
        solo: boolean;
        clips: {
          id: string;
          sourceClipId?: string;
          shotId?: string;
          assetId?: string;
          assetVersion?: number;
          audioTrackId?: string;
          audioTrackVersion?: number;
          audioSourceFingerprint?: string;
          mediaRef?: string;
          trackId: string;
          name: string;
          startFrame: number;
          durationFrames: number;
          sourceOffsetFrame: number;
          mediaStatus:
            "linked" | "missing" | "unsupported" | "proxy" | "unattached";
          text?: string;
          volume?: number;
          fadeInFrames?: number;
          fadeOutFrames?: number;
          duckingGain?: number;
          locked?: boolean;
          manuallyEdited: boolean;
        }[];
      }[];
      version: number;
      createdAt: string;
      updatedAt: string;
    };
    sourceFingerprint: string;
    media: {
      assetId: string;
      title: string;
      clipIds: string[];
      expectedVersions: number[];
      sourceVersion?: number;
      sourceStatus: "current" | "unverified" | "stale" | "missing" | "foreign";
      relativePath: string;
      checksum?: string;
      archive?: {
        artifactRef: string;
        kind: "image" | "audio" | "video";
        mimeType: string;
        extension: string;
        sizeBytes: number;
        sha256: string;
        verification: "owner-metadata-only";
      };
      mediaStatus: "unattached";
      rightsStatus: "unknown" | "restricted";
      rightsDeclaration:
        "not-provided" | "user-reported-cleared" | "user-reported-restricted";
      lineage: string[];
    }[];
    sourceBlockers: {
      clipId: string;
      code: "MISSING_MEDIA" | "UNVERIFIED_SOURCE" | "STALE_SOURCE";
      message: string;
    }[];
    unsupportedFeatures: string[];
    warnings: string[];
  };
};

/** Answer of `timeline/mediaCopiesSelectDirectory` (`timeline-media-copies.selectDirectory`). */
export type MediaCopiesSelectDirectoryResult = {
  scope: {
    projectId: string;
    episodeId: string;
    timelineId: string;
    timelineVersion: number;
    sourceFingerprint: string;
  };
  grant: {
    grantId: string;
    permission: "write-directory";
    displayName: string;
    expiresAt: string;
    generation: number;
  } | null;
};

/** Input of `timeline/applyAudioAssembly` (`timeline.applyAudioAssembly`). */
export type ApplyAudioAssemblyInput = {
  timelineId: string;
  timelineVersion: number;
  sourceFingerprint: string;
  audioTrackIds: string[];
  includeSubtitles: boolean;
};

/** Answer of `timeline/applyAudioAssembly` (`timeline.applyAudioAssembly`). */
export type ApplyAudioAssemblyResult = {
  format: "dramaip-timeline";
  schemaVersion: 2;
  id: string;
  projectId: string;
  adaptationId: string;
  episodeId: string;
  sourceFingerprint: string;
  profile: {
    width: number;
    height: number;
    frameRate: {
      numerator: number;
      denominator: number;
      dropFrame: boolean;
    };
    audioSampleRate: number;
    channels: number;
  };
  timebase: "frames";
  durationFrames: number;
  migrationWarnings: string[];
  tracks: {
    id: string;
    kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
    label: string;
    muted: boolean;
    solo: boolean;
    clips: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    }[];
  }[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `timeline/audioAssemblyPreview` (`timeline.audioAssemblyPreview`). */
export type AudioAssemblyPreviewResult = {
  timelineId: string;
  timelineVersion: number;
  sourceFingerprint: string;
  clips: {
    id: string;
    audioTrackId: string;
    audioTrackVersion: number;
    audioSourceFingerprint: string;
    sourceClipId: string;
    kind: "dialogue" | "narration" | "bgm" | "sfx";
    name: string;
    shotId?: string;
    assetId?: string;
    voiceProfileId?: string;
    text?: string;
    startSeconds: number;
    durationSeconds: number;
    volume: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
    duckingGain?: number;
    overflowSeconds: number;
    provider: string;
    cost?: number;
    rightsStatus: "cleared" | "unknown" | "restricted";
  }[];
  subtitleCues: {
    id: string;
    audioTrackId: string;
    audioTrackVersion: number;
    audioSourceFingerprint: string;
    sourceClipId: string;
    shotId?: string;
    startSeconds: number;
    durationSeconds: number;
    text: string;
  }[];
  srt: string;
  webVtt: string;
  warnings: string[];
  protectedClipIds: string[];
  staleTrackIds: string[];
};

/** Answer of `timeline/cancelRender` (`timeline.cancelRender`). */
export type CancelRenderResult = {
  jobId: string;
  timelineId: string;
  timelineVersion: number;
  timelineProfileVersion: string;
  rendererVersion: string;
  sidecarArtifactVersion: string;
  subtitlePolicy?:
    | {
        version: 1;
        mode: "omit";
      }
    | {
        version: 1;
        mode: "burn-in";
        font: {
          id: string;
          packVersion: string;
          sha256: string;
        };
      };
  sourceFingerprint?: string;
  status:
    "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
  progress: number;
  outputMediaRef?: string;
  outputSha256?: string;
  requestFingerprint?: string;
  outputRecord?: {
    id: string;
    projectId: string;
    version: number;
  };
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `timeline/command` (`timeline.command`). */
export type CommandInput = {
  version: number;
  command:
    | {
        type: "move";
        clipId: string;
        startFrame: number;
      }
    | {
        type: "trim";
        clipId: string;
        startFrame?: number;
        durationFrames: number;
      }
    | {
        type: "split";
        clipId: string;
        atFrame: number;
      }
    | {
        type: "set-track-audio";
        trackId: string;
        muted?: boolean;
        solo?: boolean;
      }
    | {
        type: "relink";
        clipId: string;
        assetId: string;
      }
    | {
        type: "set-clip-audio";
        clipId: string;
        volume?: number;
        locked?: boolean;
      };
};

/** Answer of `timeline/command` (`timeline.command`). */
export type CommandResult = {
  format: "dramaip-timeline";
  schemaVersion: 2;
  id: string;
  projectId: string;
  adaptationId: string;
  episodeId: string;
  sourceFingerprint: string;
  profile: {
    width: number;
    height: number;
    frameRate: {
      numerator: number;
      denominator: number;
      dropFrame: boolean;
    };
    audioSampleRate: number;
    channels: number;
  };
  timebase: "frames";
  durationFrames: number;
  migrationWarnings: string[];
  tracks: {
    id: string;
    kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
    label: string;
    muted: boolean;
    solo: boolean;
    clips: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    }[];
  }[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `timeline/createRender` (`timeline.createRender`). */
export type CreateRenderInput = {
  timelineProfileVersion: string;
  rendererVersion: string;
  sidecarArtifactVersion: string;
  sourceFingerprint: string;
  subtitlePolicy?:
    | {
        version: 1;
        mode: "omit";
      }
    | {
        version: 1;
        mode: "burn-in";
        font: {
          id: string;
          packVersion: string;
          sha256: string;
        };
      };
};

/** Answer of `timeline/createRender` (`timeline.createRender`). */
export type CreateRenderResult = {
  jobId: string;
  timelineId: string;
  timelineVersion: number;
  timelineProfileVersion: string;
  rendererVersion: string;
  sidecarArtifactVersion: string;
  subtitlePolicy?:
    | {
        version: 1;
        mode: "omit";
      }
    | {
        version: 1;
        mode: "burn-in";
        font: {
          id: string;
          packVersion: string;
          sha256: string;
        };
      };
  sourceFingerprint?: string;
  status:
    "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
  progress: number;
  outputMediaRef?: string;
  outputSha256?: string;
  requestFingerprint?: string;
  outputRecord?: {
    id: string;
    projectId: string;
    version: number;
  };
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `timeline/deliveryManifest` (`timeline.deliveryManifest`). */
export type DeliveryManifestResult = {
  format: "dramaip-timeline-delivery";
  schemaVersion: 3;
  timeline: {
    format: "dramaip-timeline";
    schemaVersion: 2;
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    sourceFingerprint: string;
    profile: {
      width: number;
      height: number;
      frameRate: {
        numerator: number;
        denominator: number;
        dropFrame: boolean;
      };
      audioSampleRate: number;
      channels: number;
    };
    timebase: "frames";
    durationFrames: number;
    migrationWarnings: string[];
    tracks: {
      id: string;
      kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
      label: string;
      muted: boolean;
      solo: boolean;
      clips: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      }[];
    }[];
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  sourceFingerprint: string;
  media: {
    assetId: string;
    title: string;
    clipIds: string[];
    expectedVersions: number[];
    sourceVersion?: number;
    sourceStatus: "current" | "unverified" | "stale" | "missing" | "foreign";
    relativePath: string;
    checksum?: string;
    archive?: {
      artifactRef: string;
      kind: "image" | "audio" | "video";
      mimeType: string;
      extension: string;
      sizeBytes: number;
      sha256: string;
      verification: "owner-metadata-only";
    };
    mediaStatus: "unattached";
    rightsStatus: "unknown" | "restricted";
    rightsDeclaration:
      "not-provided" | "user-reported-cleared" | "user-reported-restricted";
    lineage: string[];
  }[];
  sourceBlockers: {
    clipId: string;
    code: "MISSING_MEDIA" | "UNVERIFIED_SOURCE" | "STALE_SOURCE";
    message: string;
  }[];
  unsupportedFeatures: string[];
  warnings: string[];
};

/** Answer of `timeline/exportDelivery` (`timeline.exportDelivery`). */
export type ExportDeliveryResult = {
  fileName: string;
  mimeType: string;
  content: string;
};

/** Answer of `timeline/get` (`timeline.get`). */
export type GetResult = {
  format: "dramaip-timeline";
  schemaVersion: 2;
  id: string;
  projectId: string;
  adaptationId: string;
  episodeId: string;
  sourceFingerprint: string;
  profile: {
    width: number;
    height: number;
    frameRate: {
      numerator: number;
      denominator: number;
      dropFrame: boolean;
    };
    audioSampleRate: number;
    channels: number;
  };
  timebase: "frames";
  durationFrames: number;
  migrationWarnings: string[];
  tracks: {
    id: string;
    kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
    label: string;
    muted: boolean;
    solo: boolean;
    clips: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    }[];
  }[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `timeline/getRender` (`timeline.getRender`). */
export type GetRenderResult = {
  jobId: string;
  timelineId: string;
  timelineVersion: number;
  timelineProfileVersion: string;
  rendererVersion: string;
  sidecarArtifactVersion: string;
  subtitlePolicy?:
    | {
        version: 1;
        mode: "omit";
      }
    | {
        version: 1;
        mode: "burn-in";
        font: {
          id: string;
          packVersion: string;
          sha256: string;
        };
      };
  sourceFingerprint?: string;
  status:
    "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
  progress: number;
  outputMediaRef?: string;
  outputSha256?: string;
  requestFingerprint?: string;
  outputRecord?: {
    id: string;
    projectId: string;
    version: number;
  };
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `timeline/history` (`timeline.history`). */
export type HistoryResult = {
  canUndo: boolean;
  canRedo: boolean;
};

/** Query of `timeline/playbackPlan` (`timeline.playbackPlan`). */
export type PlaybackPlanQuery = {
  projectId: string;
  timelineVersion?: number | null;
};

/** Answer of `timeline/playbackPlan` (`timeline.playbackPlan`). */
export type PlaybackPlanResult = {
  timeline: {
    format: "dramaip-timeline";
    schemaVersion: 2;
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    sourceFingerprint: string;
    profile: {
      width: number;
      height: number;
      frameRate: {
        numerator: number;
        denominator: number;
        dropFrame: boolean;
      };
      audioSampleRate: number;
      channels: number;
    };
    timebase: "frames";
    durationFrames: number;
    migrationWarnings: string[];
    tracks: {
      id: string;
      kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
      label: string;
      muted: boolean;
      solo: boolean;
      clips: {
        id: string;
        sourceClipId?: string;
        shotId?: string;
        assetId?: string;
        assetVersion?: number;
        audioTrackId?: string;
        audioTrackVersion?: number;
        audioSourceFingerprint?: string;
        mediaRef?: string;
        trackId: string;
        name: string;
        startFrame: number;
        durationFrames: number;
        sourceOffsetFrame: number;
        mediaStatus:
          "linked" | "missing" | "unsupported" | "proxy" | "unattached";
        text?: string;
        volume?: number;
        fadeInFrames?: number;
        fadeOutFrames?: number;
        duckingGain?: number;
        locked?: boolean;
        manuallyEdited: boolean;
      }[];
    }[];
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  bindings: {
    clipId: string;
    assetId: string;
    assetVersion: number;
    expectedKind: "visual" | "audio";
    sourceProof: "timeline-asset-version" | "audio-source-version";
  }[];
  blockers: {
    clipId: string;
    code: "MISSING_MEDIA" | "UNVERIFIED_SOURCE" | "STALE_SOURCE";
    message: string;
  }[];
};

/** Answer of `timeline/preview` (`timeline.preview`). */
export type PreviewResult = {
  id: string;
  kind: "image" | "audio" | "video";
  dataUrl: string;
};

/** Answer of `timeline/redo` (`timeline.redo`). */
export type RedoResult = {
  format: "dramaip-timeline";
  schemaVersion: 2;
  id: string;
  projectId: string;
  adaptationId: string;
  episodeId: string;
  sourceFingerprint: string;
  profile: {
    width: number;
    height: number;
    frameRate: {
      numerator: number;
      denominator: number;
      dropFrame: boolean;
    };
    audioSampleRate: number;
    channels: number;
  };
  timebase: "frames";
  durationFrames: number;
  migrationWarnings: string[];
  tracks: {
    id: string;
    kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
    label: string;
    muted: boolean;
    solo: boolean;
    clips: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    }[];
  }[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `timeline/renderCatalog` (`timeline.renderCatalog`). */
export type RenderCatalogQuery = {
  projectId: string;
  limit?: number;
  cursor?: string;
  requestFingerprint?: string;
};

/** Answer of `timeline/renderCatalog` (`timeline.renderCatalog`). */
export type RenderCatalogResult = {
  projectId: string;
  episodeId: string;
  timeline?: {
    id: string;
    version: number;
    etag: string;
  };
  items: {
    jobId: string;
    timelineId: string;
    timelineVersion: number;
    timelineProfileVersion: string;
    rendererVersion: string;
    sidecarArtifactVersion: string;
    subtitlePolicy?:
      | {
          version: 1;
          mode: "omit";
        }
      | {
          version: 1;
          mode: "burn-in";
          font: {
            id: string;
            packVersion: string;
            sha256: string;
          };
        };
    sourceFingerprint?: string;
    status:
      | "queued"
      | "running"
      | "succeeded"
      | "failed"
      | "canceled"
      | "interrupted";
    progress: number;
    outputMediaRef?: string;
    outputSha256?: string;
    requestFingerprint?: string;
    outputRecord?: {
      id: string;
      projectId: string;
      version: number;
    };
    failureCode?: string;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** One event of `timeline/renderEvents` (`timeline.renderEvents`), as its handler wrote it. */
export type RenderEventsEvent = {
  event: string;
  id?: string;
  data: JsonValue;
};

/** Query of `timeline/renderPreflight` (`timeline.renderPreflight`). */
export type RenderPreflightQuery = {
  subtitleMode?: "omit" | "burn-in";
  fontId?: string;
  fontPackVersion?: string;
  fontSha256?: string;
};

/** Answer of `timeline/renderPreflight` (`timeline.renderPreflight`). */
export type RenderPreflightResult = {
  timelineId: string;
  timelineVersion: number;
  timelineEtag: string;
  profileVersion: string;
  ready: boolean;
  blockers: string[];
  warnings: string[];
  rendererVersion?: string;
  sidecarArtifactVersion?: string;
  subtitlePolicy?:
    | {
        version: 1;
        mode: "omit";
      }
    | {
        version: 1;
        mode: "burn-in";
        font: {
          id: string;
          packVersion: string;
          sha256: string;
        };
      };
  subtitleBurnInAvailable?: boolean;
  subtitleFonts?: {
    id: string;
    packVersion: string;
    sha256: string;
    label: string;
    sizeBytes: number;
    license: string;
    sourceUrl: string;
  }[];
  sourceFingerprint?: string;
};

/** Input of `timeline/retryRender` (`timeline.retryRender`). */
export type RetryRenderInput = {
  timelineProfileVersion: string;
  rendererVersion: string;
  sidecarArtifactVersion: string;
  sourceFingerprint: string;
  subtitlePolicy?:
    | {
        version: 1;
        mode: "omit";
      }
    | {
        version: 1;
        mode: "burn-in";
        font: {
          id: string;
          packVersion: string;
          sha256: string;
        };
      };
};

/** Answer of `timeline/retryRender` (`timeline.retryRender`). */
export type RetryRenderResult = {
  jobId: string;
  timelineId: string;
  timelineVersion: number;
  timelineProfileVersion: string;
  rendererVersion: string;
  sidecarArtifactVersion: string;
  subtitlePolicy?:
    | {
        version: 1;
        mode: "omit";
      }
    | {
        version: 1;
        mode: "burn-in";
        font: {
          id: string;
          packVersion: string;
          sha256: string;
        };
      };
  sourceFingerprint?: string;
  status:
    "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
  progress: number;
  outputMediaRef?: string;
  outputSha256?: string;
  requestFingerprint?: string;
  outputRecord?: {
    id: string;
    projectId: string;
    version: number;
  };
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `timeline/undo` (`timeline.undo`). */
export type UndoResult = {
  format: "dramaip-timeline";
  schemaVersion: 2;
  id: string;
  projectId: string;
  adaptationId: string;
  episodeId: string;
  sourceFingerprint: string;
  profile: {
    width: number;
    height: number;
    frameRate: {
      numerator: number;
      denominator: number;
      dropFrame: boolean;
    };
    audioSampleRate: number;
    channels: number;
  };
  timebase: "frames";
  durationFrames: number;
  migrationWarnings: string[];
  tracks: {
    id: string;
    kind: "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
    label: string;
    muted: boolean;
    solo: boolean;
    clips: {
      id: string;
      sourceClipId?: string;
      shotId?: string;
      assetId?: string;
      assetVersion?: number;
      audioTrackId?: string;
      audioTrackVersion?: number;
      audioSourceFingerprint?: string;
      mediaRef?: string;
      trackId: string;
      name: string;
      startFrame: number;
      durationFrames: number;
      sourceOffsetFrame: number;
      mediaStatus:
        "linked" | "missing" | "unsupported" | "proxy" | "unattached";
      text?: string;
      volume?: number;
      fadeInFrames?: number;
      fadeOutFrames?: number;
      duckingGain?: number;
      locked?: boolean;
      manuallyEdited: boolean;
    }[];
  }[];
  version: number;
  createdAt: string;
  updatedAt: string;
};
