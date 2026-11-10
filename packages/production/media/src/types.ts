/**
 * Wire types of the `media` Remote namespace: the shapes the
 * replaced `/api/v2` operations declare. Unconstrained parts are `JsonValue`.
 * @module @dramaip/production-media/types
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Input of `media/assetCenterAction` (`asset-center.action`). */
export type AssetCenterActionInput = {
  action: "adopt" | "lock" | "unlock" | "assign-shot" | "remove-shot";
  version: number;
  shotId?: string;
};

/** Answer of `media/assetCenterAction` (`asset-center.action`). */
export type AssetCenterActionResult = {
  projectId: string;
  assets: {
    id: string;
    title: string;
    category: "character" | "scene" | "prop" | "voice";
    subject: string;
    assetVersion: string;
    adopted: boolean;
    lockStatus: "locked" | "unlocked";
    stale: boolean;
    preview: {
      kind: "image" | "audio" | "none";
      status: "available" | "missing" | "unattached";
      label?: string;
    };
    rightsStatus: "restricted" | "unknown";
    costStatus: "unknown";
    providerStatus: "unavailable" | "unknown";
    rightsDeclaration:
      "user-reported-cleared" | "user-reported-restricted" | "not-provided";
    costDeclaration: "user-reported-known" | "not-provided";
    providerDeclaration:
      | "user-reported-available"
      | "user-reported-unavailable"
      | "user-reported-not-required"
      | "not-provided";
    usages: {
      shotId: string;
      shotTitle: string;
      sceneTitle?: string;
    }[];
    version: number;
  }[];
};

/** Answer of `media/assetCenterGet` (`asset-center.get`). */
export type AssetCenterGetResult = {
  projectId: string;
  assets: {
    id: string;
    title: string;
    category: "character" | "scene" | "prop" | "voice";
    subject: string;
    assetVersion: string;
    adopted: boolean;
    lockStatus: "locked" | "unlocked";
    stale: boolean;
    preview: {
      kind: "image" | "audio" | "none";
      status: "available" | "missing" | "unattached";
      label?: string;
    };
    rightsStatus: "restricted" | "unknown";
    costStatus: "unknown";
    providerStatus: "unavailable" | "unknown";
    rightsDeclaration:
      "user-reported-cleared" | "user-reported-restricted" | "not-provided";
    costDeclaration: "user-reported-known" | "not-provided";
    providerDeclaration:
      | "user-reported-available"
      | "user-reported-unavailable"
      | "user-reported-not-required"
      | "not-provided";
    usages: {
      shotId: string;
      shotTitle: string;
      sceneTitle?: string;
    }[];
    version: number;
  }[];
};

/** Answer of `media/assetCenterPreview` (`asset-center.preview`). */
export type AssetCenterPreviewResult = {
  id: string;
  kind: "image" | "audio";
  dataUrl: string;
};

/** Input of `media/assetsCreate` (`assets.create`). */
export type AssetsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `media/assetsCreate` (`assets.create`). */
export type AssetsCreateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/assetsGet` (`assets.get`). */
export type AssetsGetResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `media/assetsList` (`assets.list`). */
export type AssetsListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `media/assetsList` (`assets.list`). */
export type AssetsListResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `media/assetsUpdate` (`assets.update`). */
export type AssetsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `media/assetsUpdate` (`assets.update`). */
export type AssetsUpdateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/audioRevisionsConfirm` (`audio-revisions.confirm`). */
export type AudioRevisionsConfirmInput = {
  contentReviewed: true;
  mappingsReviewed: true;
  authorIntentAndRightsReviewed: true;
};

/** Answer of `media/audioRevisionsConfirm` (`audio-revisions.confirm`). */
export type AudioRevisionsConfirmResult = {
  id: string;
  projectId: string;
  episodeId: string;
  sourceTrackId: string;
  original: {
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
  candidate: {
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
  clipLinks: {
    previousClipId: string;
    nextClipId: string;
  }[];
  removedClipIds: string[];
  addedClipIds: string[];
  state: "pending" | "confirmed" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  reasons: string[];
  isCurrent: boolean;
  targetTrackId?: string;
  confirmation?: {
    contentReviewed: true;
    mappingsReviewed: true;
    authorIntentAndRightsReviewed: true;
    confirmedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/audioRevisionsDiscard` (`audio-revisions.discard`). */
export type AudioRevisionsDiscardInput = Record<string, JsonValue>;

/** Answer of `media/audioRevisionsDiscard` (`audio-revisions.discard`). */
export type AudioRevisionsDiscardResult = {
  id: string;
  projectId: string;
  episodeId: string;
  sourceTrackId: string;
  original: {
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
  candidate: {
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
  clipLinks: {
    previousClipId: string;
    nextClipId: string;
  }[];
  removedClipIds: string[];
  addedClipIds: string[];
  state: "pending" | "confirmed" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  reasons: string[];
  isCurrent: boolean;
  targetTrackId?: string;
  confirmation?: {
    contentReviewed: true;
    mappingsReviewed: true;
    authorIntentAndRightsReviewed: true;
    confirmedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/audioRevisionsGet` (`audio-revisions.get`). */
export type AudioRevisionsGetResult = {
  id: string;
  projectId: string;
  episodeId: string;
  sourceTrackId: string;
  original: {
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
  candidate: {
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
  clipLinks: {
    previousClipId: string;
    nextClipId: string;
  }[];
  removedClipIds: string[];
  addedClipIds: string[];
  state: "pending" | "confirmed" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  reasons: string[];
  isCurrent: boolean;
  targetTrackId?: string;
  confirmation?: {
    contentReviewed: true;
    mappingsReviewed: true;
    authorIntentAndRightsReviewed: true;
    confirmedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

/** Query of `media/audioRevisionsList` (`audio-revisions.list`). */
export type AudioRevisionsListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `media/audioRevisionsList` (`audio-revisions.list`). */
export type AudioRevisionsListResult = {
  items: {
    id: string;
    projectId: string;
    episodeId: string;
    sourceTrackId: string;
    original: {
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
    candidate: {
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
    clipLinks: {
      previousClipId: string;
      nextClipId: string;
    }[];
    removedClipIds: string[];
    addedClipIds: string[];
    state: "pending" | "confirmed" | "discarded";
    stateVersion: number;
    sourceState: "current" | "stale";
    reasons: string[];
    isCurrent: boolean;
    targetTrackId?: string;
    confirmation?: {
      contentReviewed: true;
      mappingsReviewed: true;
      authorIntentAndRightsReviewed: true;
      confirmedAt: string;
    };
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `media/audioRevisionsPreview` (`audio-revisions.preview`). */
export type AudioRevisionsPreviewInput = {
  sourceVersion: number;
  label: string;
  kind: "dialogue" | "narration" | "bgm" | "sfx";
  clips: {
    shotId?: string;
    assetId?: string;
    voiceProfileId?: string;
    startSeconds: number;
    durationSeconds: number;
    text?: string;
    previousClipId?: string;
  }[];
};

/** Answer of `media/audioRevisionsPreview` (`audio-revisions.preview`). */
export type AudioRevisionsPreviewResult = {
  id: string;
  projectId: string;
  episodeId: string;
  sourceTrackId: string;
  original: {
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
  candidate: {
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
  clipLinks: {
    previousClipId: string;
    nextClipId: string;
  }[];
  removedClipIds: string[];
  addedClipIds: string[];
  state: "pending" | "confirmed" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  reasons: string[];
  isCurrent: boolean;
  targetTrackId?: string;
  confirmation?: {
    contentReviewed: true;
    mappingsReviewed: true;
    authorIntentAndRightsReviewed: true;
    confirmedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

/** Query of `media/audioRevisionsSummaries` (`audio-revisions.summaries`). */
export type AudioRevisionsSummariesQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `media/audioRevisionsSummaries` (`audio-revisions.summaries`). */
export type AudioRevisionsSummariesResult = {
  items: {
    id: string;
    projectId: string;
    episodeId: string;
    sourceTrackId: string;
    state: "pending" | "confirmed" | "discarded";
    stateVersion: number;
    sourceState: "current" | "stale";
    isCurrent: boolean;
    targetTrackId?: string;
    createdAt: string;
    updatedAt: string;
    originalVersion: number;
    candidateId: string;
    candidateClipCount: number;
    mappedCount: number;
    removedCount: number;
    addedCount: number;
    reasonCount: number;
    targetStatus?: "draft" | "adopted" | "missing";
    targetVersion?: number;
  }[];
  nextCursor?: string;
};

/** Input of `media/audioCreate` (`audio.create`). */
export type AudioCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `media/audioCreate` (`audio.create`). */
export type AudioCreateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/audioGet` (`audio.get`). */
export type AudioGetResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `media/audioList` (`audio.list`). */
export type AudioListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `media/audioList` (`audio.list`). */
export type AudioListResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `media/audioUpdate` (`audio.update`). */
export type AudioUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `media/audioUpdate` (`audio.update`). */
export type AudioUpdateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/episodeAdoptAudioTrack` (`episode-media.adoptAudioTrack`). */
export type EpisodeAdoptAudioTrackResult = {
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
        "shot" | "asset" | "voice-profile" | "voice-sample" | "voice-character";
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

/** Answer of `media/episodeAdoptVoiceProfile` (`episode-media.adoptVoiceProfile`). */
export type EpisodeAdoptVoiceProfileResult = {
  id: string;
  projectId: string;
  characterId?: string;
  sampleAssetId?: string;
  title: string;
  providerVoice?: string;
  description?: string;
  status: "draft" | "adopted";
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/episodeCreateAnimatic` (`episode-media.createAnimatic`). */
export type EpisodeCreateAnimaticInput = {
  projectId: string;
  episodeId: string;
  sourceFingerprint: string;
  clips: {
    shotId: string;
    title: string;
    startSeconds: number;
    durationSeconds: number;
    mediaAssetId?: string;
    mediaKind: "video" | "still" | "missing";
  }[];
  annotations?: string;
};

/** Answer of `media/episodeCreateAnimatic` (`episode-media.createAnimatic`). */
export type EpisodeCreateAnimaticResult = {
  id: string;
  projectId: string;
  episodeId: string;
  sourceFingerprint: string;
  clips: {
    shotId: string;
    title: string;
    startSeconds: number;
    durationSeconds: number;
    mediaAssetId?: string;
    mediaKind: "video" | "still" | "missing";
  }[];
  annotations: string;
  status: "draft" | "approved" | "returned";
  reviewNote?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/episodeCreateAudioTrack` (`episode-media.createAudioTrack`). */
export type EpisodeCreateAudioTrackInput = {
  projectId: string;
  episodeId: string;
  kind: "dialogue" | "narration" | "bgm" | "sfx";
  label: string;
  clips: {
    shotId?: string;
    assetId?: string;
    voiceProfileId?: string;
    startSeconds: number;
    durationSeconds: number;
    text?: string;
  }[];
};

/** Answer of `media/episodeCreateAudioTrack` (`episode-media.createAudioTrack`). */
export type EpisodeCreateAudioTrackResult = {
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
        "shot" | "asset" | "voice-profile" | "voice-sample" | "voice-character";
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

/** Input of `media/episodeCreateVoiceProfile` (`episode-media.createVoiceProfile`). */
export type EpisodeCreateVoiceProfileInput = {
  projectId: string;
  characterId?: string;
  sampleAssetId?: string;
  title: string;
  providerVoice?: string;
  description?: string;
};

/** Answer of `media/episodeCreateVoiceProfile` (`episode-media.createVoiceProfile`). */
export type EpisodeCreateVoiceProfileResult = {
  id: string;
  projectId: string;
  characterId?: string;
  sampleAssetId?: string;
  title: string;
  providerVoice?: string;
  description?: string;
  status: "draft" | "adopted";
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/episodeInitializeAnimatic` (`episode-media.initializeAnimatic`). */
export type EpisodeInitializeAnimaticResult = {
  projectId: string;
  episodeId: string;
  sourceFingerprint: string;
  clips: {
    shotId: string;
    title: string;
    startSeconds: number;
    durationSeconds: number;
    mediaAssetId?: string;
    mediaKind: "video" | "still" | "missing";
  }[];
};

/** Answer of `media/episodeListAnimatics` (`episode-media.listAnimatics`). */
export type EpisodeListAnimaticsResult = {
  id: string;
  projectId: string;
  episodeId: string;
  sourceFingerprint: string;
  clips: {
    shotId: string;
    title: string;
    startSeconds: number;
    durationSeconds: number;
    mediaAssetId?: string;
    mediaKind: "video" | "still" | "missing";
  }[];
  annotations: string;
  status: "draft" | "approved" | "returned";
  reviewNote?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Answer of `media/episodeListAudioTracks` (`episode-media.listAudioTracks`). */
export type EpisodeListAudioTracksResult = {
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
        "shot" | "asset" | "voice-profile" | "voice-sample" | "voice-character";
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
}[];

/** Answer of `media/episodeListVoiceProfiles` (`episode-media.listVoiceProfiles`). */
export type EpisodeListVoiceProfilesResult = {
  id: string;
  projectId: string;
  characterId?: string;
  sampleAssetId?: string;
  title: string;
  providerVoice?: string;
  description?: string;
  status: "draft" | "adopted";
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Answer of `media/episodeRenderPreflight` (`episode-media.renderPreflight`). */
export type EpisodeRenderPreflightResult = {
  projectId: string;
  episodeId: string;
  sourceFingerprint: string;
  ok: boolean;
  blockers: string[];
  warnings: string[];
  animaticId?: string;
  audioTrackIds: string[];
  durationSeconds: number;
};

/** Input of `media/episodeReviewAnimatic` (`episode-media.reviewAnimatic`). */
export type EpisodeReviewAnimaticInput = {
  status: "approved" | "returned";
  reviewNote?: string;
  version: number;
};

/** Answer of `media/episodeReviewAnimatic` (`episode-media.reviewAnimatic`). */
export type EpisodeReviewAnimaticResult = {
  id: string;
  projectId: string;
  episodeId: string;
  sourceFingerprint: string;
  clips: {
    shotId: string;
    title: string;
    startSeconds: number;
    durationSeconds: number;
    mediaAssetId?: string;
    mediaKind: "video" | "still" | "missing";
  }[];
  annotations: string;
  status: "draft" | "approved" | "returned";
  reviewNote?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/imageGenerationRun` (`image-generation.run`). */
export type ImageGenerationRunInput = {
  providerId: string;
  projectId: string;
  shotId: string;
  kind: "still" | "first_frame" | "last_frame" | "cover";
  prompt: string;
  negativePrompt?: string;
  size?: string;
  quality?: string;
  outputFormat?: "png" | "jpeg" | "webp";
  referenceSubjectIds?: string[];
  portraitPreflightConfirmed?: true;
};

/** Answer of `media/imageGenerationRun` (`image-generation.run`). */
export type ImageGenerationRunResult = {
  task: {
    id: string;
    kind: string;
    status:
      | "queued"
      | "running"
      | "succeeded"
      | "failed"
      | "canceled"
      | "interrupted";
    attentionStatus: "open" | "acknowledged";
    resultStatus: "none" | "pending" | "applied" | "discarded" | "conflicted";
    title: string;
    progress: number;
    projectId?: string;
    parentTaskId?: string;
    conversationId?: string;
    assistantTurnId?: string;
    stage?: string;
    result?: JsonValue;
    error?: string;
    createdAt: string;
    updatedAt: string;
  };
  assets: {
    id: string;
    kind:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    domain:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    projectId: string;
    parentId?: string;
    title: string;
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  candidates: {
    id: string;
    kind:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    domain:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    projectId: string;
    parentId?: string;
    title: string;
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
};

/** Input of `media/imageCreate` (`image.create`). */
export type ImageCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `media/imageCreate` (`image.create`). */
export type ImageCreateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/imageGet` (`image.get`). */
export type ImageGetResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `media/imageList` (`image.list`). */
export type ImageListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `media/imageList` (`image.list`). */
export type ImageListResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `media/imageUpdate` (`image.update`). */
export type ImageUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `media/imageUpdate` (`image.update`). */
export type ImageUpdateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/likenessSubjectsAttachPhoto` (`likenessSubjects.attachPhoto`). */
export type LikenessSubjectsAttachPhotoInput = {
  grantId: string;
};

/** Answer of `media/likenessSubjectsAttachPhoto` (`likenessSubjects.attachPhoto`). */
export type LikenessSubjectsAttachPhotoResult = {
  id: string;
  subjectId: string;
  mediaRef: string;
  sha256: string;
  mimeType: "image/png";
  width: number;
  height: number;
  size: number;
  status: "active" | "removed";
  createdAt: string;
  removedAt?: string;
};

/** Input of `media/likenessSubjectsConsent` (`likenessSubjects.consent`). */
export type LikenessSubjectsConsentInput = {
  purposeScopes: string[];
  validUntil: string;
  participantConfirmed: boolean;
  guardianConfirmed?: boolean;
  under14SeparateConsentConfirmed?: boolean;
};

/** Answer of `media/likenessSubjectsConsent` (`likenessSubjects.consent`). */
export type LikenessSubjectsConsentResult = {
  id: string;
  projectId: string;
  displayName: string;
  relationship: "self" | "adult_relative_or_friend" | "minor";
  ageBand: "adult" | "minor_14_to_17" | "under_14";
  consentStatus: "missing" | "active" | "revoked" | "expired";
  contentRestrictions?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/likenessSubjectsCreate` (`likenessSubjects.create`). */
export type LikenessSubjectsCreateInput = {
  displayName: string;
  relationship: "self" | "adult_relative_or_friend" | "minor";
  ageBand: "adult" | "minor_14_to_17" | "under_14";
  contentRestrictions?: string;
};

/** Answer of `media/likenessSubjectsCreate` (`likenessSubjects.create`). */
export type LikenessSubjectsCreateResult = {
  id: string;
  projectId: string;
  displayName: string;
  relationship: "self" | "adult_relative_or_friend" | "minor";
  ageBand: "adult" | "minor_14_to_17" | "under_14";
  consentStatus: "missing" | "active" | "revoked" | "expired";
  contentRestrictions?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/likenessSubjectsList` (`likenessSubjects.list`). */
export type LikenessSubjectsListResult = {
  id: string;
  projectId: string;
  displayName: string;
  relationship: "self" | "adult_relative_or_friend" | "minor";
  ageBand: "adult" | "minor_14_to_17" | "under_14";
  consentStatus: "missing" | "active" | "revoked" | "expired";
  contentRestrictions?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `media/likenessSubjectsReferencePreflight` (`likenessSubjects.referencePreflight`). */
export type LikenessSubjectsReferencePreflightInput = {
  subjectIds: string[];
  confirmed: true;
};

/** Answer of `media/likenessSubjectsReferencePreflight` (`likenessSubjects.referencePreflight`). */
export type LikenessSubjectsReferencePreflightResult = {
  ok: boolean;
  subjectIds: string[];
  mediaRefs: string[];
  blockers: string[];
  warnings: string[];
};

/** Answer of `media/likenessSubjectsRevoke` (`likenessSubjects.revoke`). */
export type LikenessSubjectsRevokeResult = {
  id: string;
  projectId: string;
  displayName: string;
  relationship: "self" | "adult_relative_or_friend" | "minor";
  ageBand: "adult" | "minor_14_to_17" | "under_14";
  consentStatus: "missing" | "active" | "revoked" | "expired";
  contentRestrictions?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/byteVerificationsCreate` (`media-byte-verifications.create`). */
export type ByteVerificationsCreateInput = {
  descriptor: {
    recordId: string;
    projectId: string;
    recordVersion: number;
    kind: "image" | "audio" | "video";
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    origin: "embedded" | "managed-archive";
    artifactRef?: string;
    verification: "owner-metadata-only";
  };
};

/** Answer of `media/byteVerificationsCreate` (`media-byte-verifications.create`). */
export type ByteVerificationsCreateResult = {
  id: string;
  version: 0;
  requestKey: string;
  descriptor: {
    recordId: string;
    projectId: string;
    recordVersion: number;
    kind: "image" | "audio" | "video";
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    origin: "embedded" | "managed-archive";
    artifactRef?: string;
    verification: "owner-metadata-only";
  };
  verifiedAt: string;
  evidence: "complete-byte-read-at-recorded-time";
  qualityState: "unverified";
  rightsState: "unverified";
  currentBinding: "unchanged-metadata" | "changed-metadata" | "unavailable";
};

/** Query of `media/byteVerificationsGet` (`media-byte-verifications.get`). */
export type ByteVerificationsGetQuery = {
  projectId: string;
};

/** Answer of `media/byteVerificationsGet` (`media-byte-verifications.get`). */
export type ByteVerificationsGetResult = {
  id: string;
  version: 0;
  requestKey: string;
  descriptor: {
    recordId: string;
    projectId: string;
    recordVersion: number;
    kind: "image" | "audio" | "video";
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    origin: "embedded" | "managed-archive";
    artifactRef?: string;
    verification: "owner-metadata-only";
  };
  verifiedAt: string;
  evidence: "complete-byte-read-at-recorded-time";
  qualityState: "unverified";
  rightsState: "unverified";
  currentBinding: "unchanged-metadata" | "changed-metadata" | "unavailable";
};

/** Query of `media/byteVerificationsList` (`media-byte-verifications.list`). */
export type ByteVerificationsListQuery = {
  projectId: string;
  recordVersion?: number | null;
  limit?: number;
  cursor?: string;
};

/** Answer of `media/byteVerificationsList` (`media-byte-verifications.list`). */
export type ByteVerificationsListResult = {
  recordId: string;
  projectId: string;
  recordVersion: number;
  items: {
    id: string;
    version: 0;
    requestKey: string;
    descriptor: {
      recordId: string;
      projectId: string;
      recordVersion: number;
      kind: "image" | "audio" | "video";
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      origin: "embedded" | "managed-archive";
      artifactRef?: string;
      verification: "owner-metadata-only";
    };
    verifiedAt: string;
    evidence: "complete-byte-read-at-recorded-time";
    qualityState: "unverified";
    rightsState: "unverified";
    currentBinding: "unchanged-metadata" | "changed-metadata" | "unavailable";
  }[];
  nextCursor?: string;
};

/** Query of `media/byteVerificationsRecover` (`media-byte-verifications.recover`). */
export type ByteVerificationsRecoverQuery = {
  projectId: string;
};

/** Answer of `media/byteVerificationsRecover` (`media-byte-verifications.recover`). */
export type ByteVerificationsRecoverResult = {
  id: string;
  version: 0;
  requestKey: string;
  descriptor: {
    recordId: string;
    projectId: string;
    recordVersion: number;
    kind: "image" | "audio" | "video";
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    origin: "embedded" | "managed-archive";
    artifactRef?: string;
    verification: "owner-metadata-only";
  };
  verifiedAt: string;
  evidence: "complete-byte-read-at-recorded-time";
  qualityState: "unverified";
  rightsState: "unverified";
  currentBinding: "unchanged-metadata" | "changed-metadata" | "unavailable";
};

/** Query of `media/playbackDescribe` (`media-playback.describe`). */
export type PlaybackDescribeQuery = {
  projectId: string;
  recordVersion?: number | null;
};

/** Answer of `media/playbackDescribe` (`media-playback.describe`). */
export type PlaybackDescribeResult = {
  recordId: string;
  projectId: string;
  recordVersion: number;
  kind: "image" | "audio" | "video";
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  origin: "embedded" | "managed-archive";
  artifactRef?: string;
  verification: "owner-metadata-only";
};

/** Input of `media/sourcesAdopt` (`media-sources.adopt`). */
export type SourcesAdoptInput = {
  mediaReviewed: true;
  shotMappingReviewed: true;
  authorIntentReviewed: true;
};

/** Answer of `media/sourcesAdopt` (`media-sources.adopt`). */
export type SourcesAdoptResult = {
  id: string;
  recordId: string;
  projectId: string;
  recordVersion: number;
  contentHash: string;
  previousBinding?: {
    id: string;
    recordId: string;
    shotId: string;
    shotVersion: number;
    contentHash: string;
    version: number;
    origin: "generation" | "manual-record" | "human-review";
    createdAt: string;
  };
  adoptedBindingId?: string;
  shotId: string;
  shotVersion: number;
  sourceFingerprint: string;
  state: "pending" | "adopted" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  staleReasons: string[];
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/sourcesDiscard` (`media-sources.discard`). */
export type SourcesDiscardInput = Record<string, JsonValue>;

/** Answer of `media/sourcesDiscard` (`media-sources.discard`). */
export type SourcesDiscardResult = {
  id: string;
  recordId: string;
  projectId: string;
  recordVersion: number;
  contentHash: string;
  previousBinding?: {
    id: string;
    recordId: string;
    shotId: string;
    shotVersion: number;
    contentHash: string;
    version: number;
    origin: "generation" | "manual-record" | "human-review";
    createdAt: string;
  };
  adoptedBindingId?: string;
  shotId: string;
  shotVersion: number;
  sourceFingerprint: string;
  state: "pending" | "adopted" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  staleReasons: string[];
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/sourcesGet` (`media-sources.get`). */
export type SourcesGetResult = {
  id: string;
  recordId: string;
  projectId: string;
  recordVersion: number;
  contentHash: string;
  previousBinding?: {
    id: string;
    recordId: string;
    shotId: string;
    shotVersion: number;
    contentHash: string;
    version: number;
    origin: "generation" | "manual-record" | "human-review";
    createdAt: string;
  };
  adoptedBindingId?: string;
  shotId: string;
  shotVersion: number;
  sourceFingerprint: string;
  state: "pending" | "adopted" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  staleReasons: string[];
  createdAt: string;
  updatedAt: string;
};

/** Query of `media/sourcesList` (`media-sources.list`). */
export type SourcesListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `media/sourcesList` (`media-sources.list`). */
export type SourcesListResult = {
  items: {
    id: string;
    recordId: string;
    projectId: string;
    recordVersion: number;
    contentHash: string;
    previousBinding?: {
      id: string;
      recordId: string;
      shotId: string;
      shotVersion: number;
      contentHash: string;
      version: number;
      origin: "generation" | "manual-record" | "human-review";
      createdAt: string;
    };
    adoptedBindingId?: string;
    shotId: string;
    shotVersion: number;
    sourceFingerprint: string;
    state: "pending" | "adopted" | "discarded";
    stateVersion: number;
    sourceState: "current" | "stale";
    staleReasons: string[];
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `media/sourcesPreview` (`media-sources.preview`). */
export type SourcesPreviewInput = {
  recordVersion: number;
  shotId: string;
  shotVersion: number;
};

/** Answer of `media/sourcesPreview` (`media-sources.preview`). */
export type SourcesPreviewResult = {
  id: string;
  recordId: string;
  projectId: string;
  recordVersion: number;
  contentHash: string;
  previousBinding?: {
    id: string;
    recordId: string;
    shotId: string;
    shotVersion: number;
    contentHash: string;
    version: number;
    origin: "generation" | "manual-record" | "human-review";
    createdAt: string;
  };
  adoptedBindingId?: string;
  shotId: string;
  shotVersion: number;
  sourceFingerprint: string;
  state: "pending" | "adopted" | "discarded";
  stateVersion: number;
  sourceState: "current" | "stale";
  staleReasons: string[];
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/sourcesRecord` (`media-sources.record`). */
export type SourcesRecordResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/sourcesStatus` (`media-sources.status`). */
export type SourcesStatusResult = {
  recordId: string;
  recordVersion: number;
  state: "current" | "stale" | "unverified" | "unbound";
  verification: "actual-record-version-only";
  binding?: {
    id: string;
    recordId: string;
    shotId: string;
    shotVersion: number;
    contentHash: string;
    version: number;
    origin: "generation" | "manual-record" | "human-review";
    createdAt: string;
  };
  actualShotVersion?: number;
  reasons: string[];
};

/** Query of `media/sourcesSummaries` (`media-sources.summaries`). */
export type SourcesSummariesQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `media/sourcesSummaries` (`media-sources.summaries`). */
export type SourcesSummariesResult = {
  items: {
    id: string;
    recordId: string;
    projectId: string;
    recordVersion: number;
    shotId: string;
    shotVersion: number;
    state: "pending" | "adopted" | "discarded";
    stateVersion: number;
    sourceState: "current" | "stale";
    createdAt: string;
    updatedAt: string;
    reasonCount: number;
  }[];
  nextCursor?: string;
};

/** Query of `media/deliveryEvidence` (`media.deliveryEvidence`). */
export type DeliveryEvidenceQuery = {
  projectId: string;
  recordVersion?: number | null;
};

/** Answer of `media/deliveryEvidence` (`media.deliveryEvidence`). */
export type DeliveryEvidenceResult = {
  recordId: string;
  projectId: string;
  recordVersion: number;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  scope: "exact-media-record-metadata";
  releaseReady: false;
  qualityState: "unverified";
  settlementState: "unknown";
  currentFileIntegrity: "not-read";
  declarations: {
    rightsStatus: "restricted" | "unknown";
    rightsDeclaration:
      "user-reported-cleared" | "user-reported-restricted" | "not-provided";
    costStatus: "unknown";
    costDeclaration: "user-reported-known" | "not-provided";
    providerStatus: "unavailable" | "unknown";
    providerDeclaration:
      | "user-reported-available"
      | "user-reported-unavailable"
      | "user-reported-not-required"
      | "not-provided";
  };
  source: {
    recordId: string;
    recordVersion: number;
    state: "current" | "stale" | "unverified" | "unbound";
    verification: "actual-record-version-only";
    binding?: {
      id: string;
      recordId: string;
      shotId: string;
      shotVersion: number;
      contentHash: string;
      version: number;
      origin: "generation" | "manual-record" | "human-review";
      createdAt: string;
    };
    actualShotVersion?: number;
    reasons: string[];
  };
  archive?: {
    artifactId: string;
    mediaRef: string;
    kind: "image" | "audio" | "video" | "subtitle" | "project-package";
    mimeType: string;
    extension: string;
    sizeBytes: number;
    sha256: string;
    width?: number;
    height?: number;
    durationFrames?: number;
    frameRate?: {
      numerator: number;
      denominator: number;
      dropFrame: boolean;
    };
    status: "archived" | "quarantined" | "removed";
  };
  latestByteRead?: {
    id: string;
    verifiedAt: string;
    descriptor: {
      recordId: string;
      projectId: string;
      recordVersion: number;
      kind: "image" | "audio" | "video";
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      origin: "embedded" | "managed-archive";
      artifactRef?: string;
      verification: "owner-metadata-only";
    };
    evidence: "complete-byte-read-at-recorded-time";
    currentArchiveBinding:
      | "matching-archive-metadata"
      | "changed-archive-metadata"
      | "not-rechecked";
  };
  blockers: (
    | "DECLARED_RIGHTS_RESTRICTED"
    | "DECLARED_PROVIDER_UNAVAILABLE"
    | "SOURCE_STALE"
    | "SOURCE_UNVERIFIED"
    | "ARCHIVE_UNAVAILABLE"
  )[];
  unknowns: [
    "CONTENT_QUALITY_UNVERIFIED",
    "LEGAL_RIGHTS_UNVERIFIED",
    "SETTLEMENT_UNKNOWN",
    "CURRENT_FILE_NOT_READ",
  ];
};

/** Input of `media/rendersCreate` (`renders.create`). */
export type RendersCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `media/rendersCreate` (`renders.create`). */
export type RendersCreateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/rendersGet` (`renders.get`). */
export type RendersGetResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `media/rendersList` (`renders.list`). */
export type RendersListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `media/rendersList` (`renders.list`). */
export type RendersListResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `media/rendersUpdate` (`renders.update`). */
export type RendersUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `media/rendersUpdate` (`renders.update`). */
export type RendersUpdateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/rightsCreate` (`rights.create`). */
export type RightsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `media/rightsCreate` (`rights.create`). */
export type RightsCreateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/rightsGet` (`rights.get`). */
export type RightsGetResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `media/rightsList` (`rights.list`). */
export type RightsListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `media/rightsList` (`rights.list`). */
export type RightsListResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `media/rightsUpdate` (`rights.update`). */
export type RightsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `media/rightsUpdate` (`rights.update`). */
export type RightsUpdateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/shotStillsCreate` (`shot-stills.create`). */
export type ShotStillsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `media/shotStillsCreate` (`shot-stills.create`). */
export type ShotStillsCreateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/shotStillsGet` (`shot-stills.get`). */
export type ShotStillsGetResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `media/shotStillsList` (`shot-stills.list`). */
export type ShotStillsListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `media/shotStillsList` (`shot-stills.list`). */
export type ShotStillsListResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `media/shotStillsUpdate` (`shot-stills.update`). */
export type ShotStillsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `media/shotStillsUpdate` (`shot-stills.update`). */
export type ShotStillsUpdateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/ttsGenerationRun` (`tts-generation.run`). */
export type TtsGenerationRunInput = {
  providerId: string;
  projectId: string;
  episodeId: string;
  shotId?: string;
  voiceProfileId?: string;
  kind: "dialogue" | "narration";
  input: string;
  voice: string;
  instructions?: string;
  speed?: number;
  responseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
};

/** Answer of `media/ttsGenerationRun` (`tts-generation.run`). */
export type TtsGenerationRunResult = {
  task: {
    id: string;
    kind: string;
    status:
      | "queued"
      | "running"
      | "succeeded"
      | "failed"
      | "canceled"
      | "interrupted";
    attentionStatus: "open" | "acknowledged";
    resultStatus: "none" | "pending" | "applied" | "discarded" | "conflicted";
    title: string;
    progress: number;
    projectId?: string;
    parentTaskId?: string;
    conversationId?: string;
    assistantTurnId?: string;
    stage?: string;
    result?: JsonValue;
    error?: string;
    createdAt: string;
    updatedAt: string;
  };
  asset: {
    id: string;
    kind:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    domain:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    projectId: string;
    parentId?: string;
    title: string;
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
};

/** Input of `media/videoGenerationBatchPreflight` (`video-generation.batchPreflight`). */
export type VideoGenerationBatchPreflightInput = {
  projectId: string;
  submissions: {
    providerId: string;
    projectId: string;
    episodeId?: string;
    shotId?: string;
    prompt: string;
    negativePrompt?: string;
    seconds?: number;
    size?: string;
    readinessHash?: string;
    confirmUnknownCost?: boolean;
  }[];
};

/** Answer of `media/videoGenerationBatchPreflight` (`video-generation.batchPreflight`). */
export type VideoGenerationBatchPreflightResult = {
  projectId: string;
  ready: boolean;
  items: {
    shotId: string;
    providerId: string;
    snapshotHash: string;
    ready: boolean;
    adoptedStillId?: string;
    lockedAssetIds: string[];
    blockers: string[];
    warnings: string[];
    providerKind?: "seedance" | "minimax_h3_cloud";
    providerCapabilities?: {
      cancellation: "unsupported" | "queued_only" | "supported";
      nativeAudio: boolean;
      durationSeconds:
        | number[]
        | {
            minimum: number;
            maximum: number;
          };
      resolutions: string[];
      aspectRatios: string[];
    };
    costStatus: "known" | "unknown";
    estimatedCost?: number;
    currency?: string;
  }[];
  blockers: string[];
  knownEstimatedCost?: number;
  aggregationStatus?: "not-aggregated";
  unknownCostCount: number;
};

/** Answer of `media/videoGenerationCancel` (`video-generation.cancel`). */
export type VideoGenerationCancelResult = {
  id: string;
  taskId: string;
  projectId: string;
  episodeId?: string;
  shotId?: string;
  providerId: string;
  providerKind?: "seedance" | "minimax_h3_cloud";
  modelRevision?: string;
  remoteJobId: string;
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  remoteStatus: "queued" | "running" | "succeeded" | "failed" | "canceled";
  archiveStatus:
    "not_started" | "pending" | "archived" | "failed" | "unavailable";
  results: {
    id: string;
    kind:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    domain:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    projectId: string;
    parentId?: string;
    title: string;
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/videoGenerationCreate` (`video-generation.create`). */
export type VideoGenerationCreateInput = {
  providerId: string;
  projectId: string;
  episodeId?: string;
  shotId?: string;
  prompt: string;
  negativePrompt?: string;
  seconds?: number;
  size?: string;
  readinessHash?: string;
  confirmUnknownCost?: boolean;
};

/** Answer of `media/videoGenerationCreate` (`video-generation.create`). */
export type VideoGenerationCreateResult = {
  id: string;
  taskId: string;
  projectId: string;
  episodeId?: string;
  shotId?: string;
  providerId: string;
  providerKind?: "seedance" | "minimax_h3_cloud";
  modelRevision?: string;
  remoteJobId: string;
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  remoteStatus: "queued" | "running" | "succeeded" | "failed" | "canceled";
  archiveStatus:
    "not_started" | "pending" | "archived" | "failed" | "unavailable";
  results: {
    id: string;
    kind:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    domain:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    projectId: string;
    parentId?: string;
    title: string;
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/videoGenerationGet` (`video-generation.get`). */
export type VideoGenerationGetResult = {
  id: string;
  taskId: string;
  projectId: string;
  episodeId?: string;
  shotId?: string;
  providerId: string;
  providerKind?: "seedance" | "minimax_h3_cloud";
  modelRevision?: string;
  remoteJobId: string;
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  remoteStatus: "queued" | "running" | "succeeded" | "failed" | "canceled";
  archiveStatus:
    "not_started" | "pending" | "archived" | "failed" | "unavailable";
  results: {
    id: string;
    kind:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    domain:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    projectId: string;
    parentId?: string;
    title: string;
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/videoGenerationListByShot` (`video-generation.listByShot`). */
export type VideoGenerationListByShotResult = {
  id: string;
  taskId: string;
  projectId: string;
  episodeId?: string;
  shotId?: string;
  providerId: string;
  providerKind?: "seedance" | "minimax_h3_cloud";
  modelRevision?: string;
  remoteJobId: string;
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  remoteStatus: "queued" | "running" | "succeeded" | "failed" | "canceled";
  archiveStatus:
    "not_started" | "pending" | "archived" | "failed" | "unavailable";
  results: {
    id: string;
    kind:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    domain:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    projectId: string;
    parentId?: string;
    title: string;
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `media/videoGenerationPreflight` (`video-generation.preflight`). */
export type VideoGenerationPreflightInput = {
  providerId: string;
  projectId: string;
  episodeId?: string;
  shotId?: string;
  prompt: string;
  negativePrompt?: string;
  seconds?: number;
  size?: string;
  readinessHash?: string;
  confirmUnknownCost?: boolean;
};

/** Answer of `media/videoGenerationPreflight` (`video-generation.preflight`). */
export type VideoGenerationPreflightResult = {
  shotId: string;
  providerId: string;
  snapshotHash: string;
  ready: boolean;
  adoptedStillId?: string;
  lockedAssetIds: string[];
  blockers: string[];
  warnings: string[];
  providerKind?: "seedance" | "minimax_h3_cloud";
  providerCapabilities?: {
    cancellation: "unsupported" | "queued_only" | "supported";
    nativeAudio: boolean;
    durationSeconds:
      | number[]
      | {
          minimum: number;
          maximum: number;
        };
    resolutions: string[];
    aspectRatios: string[];
  };
  costStatus: "known" | "unknown";
  estimatedCost?: number;
  currency?: string;
};

/** Answer of `media/videoGenerationRefresh` (`video-generation.refresh`). */
export type VideoGenerationRefreshResult = {
  id: string;
  taskId: string;
  projectId: string;
  episodeId?: string;
  shotId?: string;
  providerId: string;
  providerKind?: "seedance" | "minimax_h3_cloud";
  modelRevision?: string;
  remoteJobId: string;
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  remoteStatus: "queued" | "running" | "succeeded" | "failed" | "canceled";
  archiveStatus:
    "not_started" | "pending" | "archived" | "failed" | "unavailable";
  results: {
    id: string;
    kind:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    domain:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    projectId: string;
    parentId?: string;
    title: string;
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/videoGenerationRetry` (`video-generation.retry`). */
export type VideoGenerationRetryInput = {
  providerId?: string;
};

/** Answer of `media/videoGenerationRetry` (`video-generation.retry`). */
export type VideoGenerationRetryResult = {
  id: string;
  taskId: string;
  projectId: string;
  episodeId?: string;
  shotId?: string;
  providerId: string;
  providerKind?: "seedance" | "minimax_h3_cloud";
  modelRevision?: string;
  remoteJobId: string;
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  remoteStatus: "queued" | "running" | "succeeded" | "failed" | "canceled";
  archiveStatus:
    "not_started" | "pending" | "archived" | "failed" | "unavailable";
  results: {
    id: string;
    kind:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    domain:
      | "shot-stills"
      | "visual-assets"
      | "assets"
      | "rights"
      | "image"
      | "audio"
      | "video"
      | "animatics"
      | "renders";
    projectId: string;
    parentId?: string;
    title: string;
    payload: Record<string, JsonValue>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/videoCreate` (`video.create`). */
export type VideoCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `media/videoCreate` (`video.create`). */
export type VideoCreateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/videoGet` (`video.get`). */
export type VideoGetResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `media/videoList` (`video.list`). */
export type VideoListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `media/videoList` (`video.list`). */
export type VideoListResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `media/videoUpdate` (`video.update`). */
export type VideoUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `media/videoUpdate` (`video.update`). */
export type VideoUpdateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input of `media/visualAssetsCreate` (`visual-assets.create`). */
export type VisualAssetsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `media/visualAssetsCreate` (`visual-assets.create`). */
export type VisualAssetsCreateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/visualAssetsGet` (`visual-assets.get`). */
export type VisualAssetsGetResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Query of `media/visualAssetsList` (`visual-assets.list`). */
export type VisualAssetsListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `media/visualAssetsList` (`visual-assets.list`). */
export type VisualAssetsListResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `media/visualAssetsUpdate` (`visual-assets.update`). */
export type VisualAssetsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `media/visualAssetsUpdate` (`visual-assets.update`). */
export type VisualAssetsUpdateResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/visualsAdoptStill` (`visuals.adoptStill`). */
export type VisualsAdoptStillResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/visualsAdoptVideo` (`visuals.adoptVideo`). */
export type VisualsAdoptVideoResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/visualsAdoptVisualAsset` (`visuals.adoptVisualAsset`). */
export type VisualsAdoptVisualAssetResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Answer of `media/visualsLockVisualAsset` (`visuals.lockVisualAsset`). */
export type VisualsLockVisualAssetResult = {
  id: string;
  kind:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  domain:
    | "shot-stills"
    | "visual-assets"
    | "assets"
    | "rights"
    | "image"
    | "audio"
    | "video"
    | "animatics"
    | "renders";
  projectId: string;
  parentId?: string;
  title: string;
  payload: Record<string, JsonValue>;
  version: number;
  createdAt: string;
  updatedAt: string;
};
