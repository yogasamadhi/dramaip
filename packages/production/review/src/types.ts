/**
 * Wire types of the `review` Remote namespace: the shapes the
 * replaced `/api/v2` operations declare. Unconstrained parts are `JsonValue`.
 * @module @dramaip/production-review/types
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Answer of `review/cloudBinding` (`cloud-review.binding`). */
export type CloudBindingResult = JsonValue;

/** Answer of `review/cloudConnection` (`cloud-review.connection`). */
export type CloudConnectionResult = {
  baseUrl: string;
  workspaceId: string;
  configured: boolean;
  updatedAt: string;
};

/** Answer of `review/cloudDelete` (`cloud-review.delete`). */
export type CloudDeleteResult = JsonValue;

/** Input of `review/cloudPreview` (`cloud-review.preview`). */
export type CloudPreviewInput = {
  pin?: string;
  media: {
    id: string;
    shotId: string;
    relativePath: string;
    mimeType: string;
    capabilityToken: string;
  }[];
};

/** Answer of `review/cloudPreview` (`cloud-review.preview`). */
export type CloudPreviewResult = JsonValue;

/** Input of `review/cloudPublish` (`cloud-review.publish`). */
export type CloudPublishInput = {
  pin?: string;
  media: {
    id: string;
    shotId: string;
    relativePath: string;
    mimeType: string;
    capabilityToken: string;
  }[];
};

/** Answer of `review/cloudPublish` (`cloud-review.publish`). */
export type CloudPublishResult = JsonValue;

/** Input of `review/cloudSaveConnection` (`cloud-review.saveConnection`). */
export type CloudSaveConnectionInput = {
  baseUrl: string;
  workspaceId: string;
  credentialRef: string;
};

/** Answer of `review/cloudSaveConnection` (`cloud-review.saveConnection`). */
export type CloudSaveConnectionResult = JsonValue;

/** Answer of `review/cloudSync` (`cloud-review.sync`). */
export type CloudSyncResult = JsonValue;

/** Answer of `review/complianceActivateProfile` (`compliance.activateProfile`). */
export type ComplianceActivateProfileResult = JsonValue;

/** Answer of `review/complianceListProfiles` (`compliance.listProfiles`). */
export type ComplianceListProfilesResult = JsonValue;

/** Input of `review/compliancePreflight` (`compliance.preflight`). */
export type CompliancePreflightInput = {
  title: string;
  subtitleLanguage: string;
  targetPlatform?: string;
  targetRegion?: string;
  deliveryDate: string;
  aigcDeclared: boolean;
  manualContentReviewConfirmed: boolean;
};

/** Answer of `review/compliancePreflight` (`compliance.preflight`). */
export type CompliancePreflightResult = JsonValue;

/** Input of `review/complianceRecordsCreate` (`compliance.records.create`). */
export type ComplianceRecordsCreateInput = JsonValue;

/** Answer of `review/complianceRecordsCreate` (`compliance.records.create`). */
export type ComplianceRecordsCreateResult = JsonValue;

/** Answer of `review/complianceRecordsGet` (`compliance.records.get`). */
export type ComplianceRecordsGetResult = JsonValue;

/** Query of `review/complianceRecordsList` (`compliance.records.list`). */
export type ComplianceRecordsListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `review/complianceRecordsList` (`compliance.records.list`). */
export type ComplianceRecordsListResult = JsonValue;

/** Input of `review/complianceRecordsUpdate` (`compliance.records.update`). */
export type ComplianceRecordsUpdateInput = JsonValue;

/** Answer of `review/complianceRecordsUpdate` (`compliance.records.update`). */
export type ComplianceRecordsUpdateResult = JsonValue;

/** Input of `review/productionReviewsAppendPromptVersion` (`production-reviews.appendPromptVersion`). */
export type ProductionReviewsAppendPromptVersionInput = {
  taskType: string;
  videoPrompt?: string;
  negativePrompt?: string;
  imagePrompt?: string;
  note?: string;
};

/** Answer of `review/productionReviewsAppendPromptVersion` (`production-reviews.appendPromptVersion`). */
export type ProductionReviewsAppendPromptVersionResult = JsonValue;

/** Answer of `review/productionReviewsGetScript` (`production-reviews.getScript`). */
export type ProductionReviewsGetScriptResult = JsonValue | undefined;

/** Answer of `review/productionReviewsGetShot` (`production-reviews.getShot`). */
export type ProductionReviewsGetShotResult = JsonValue | undefined;

/** Answer of `review/productionReviewsListPromptVersions` (`production-reviews.listPromptVersions`). */
export type ProductionReviewsListPromptVersionsResult = JsonValue;

/** Answer of `review/productionReviewsRunScript` (`production-reviews.runScript`). */
export type ProductionReviewsRunScriptResult = JsonValue;

/** Answer of `review/productionReviewsRunShot` (`production-reviews.runShot`). */
export type ProductionReviewsRunShotResult = JsonValue;

/** Input of `review/editorCreateComment` (`review-editor.createComment`). */
export type EditorCreateCommentInput = {
  shotId?: string;
  timecodeSeconds?: number;
  authorAlias?: string;
  body: string;
};

/** Answer of `review/editorCreateComment` (`review-editor.createComment`). */
export type EditorCreateCommentResult = {
  shotId?: string;
  timecodeSeconds?: number;
  authorAlias?: string;
  body: string;
  id: string;
  packageId: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Input of `review/editorCreateDecision` (`review-editor.createDecision`). */
export type EditorCreateDecisionInput = {
  shotId?: string;
  decision: "approve" | "return" | "request_changes" | "note";
  authorAlias?: string;
  note?: string;
};

/** Answer of `review/editorCreateDecision` (`review-editor.createDecision`). */
export type EditorCreateDecisionResult = {
  shotId?: string;
  decision: "approve" | "return" | "request_changes" | "note";
  authorAlias?: string;
  note?: string;
  id: string;
  packageId: string;
  createdAt: string;
};

/** Answer of `review/editorCreatePackage` (`review-editor.createPackage`). */
export type EditorCreatePackageResult = {
  id: string;
  projectId: string;
  adaptationId: string;
  episodeId: string;
  kind: "offline";
  status: "exported";
  title: string;
  manifest: {
    format: "dramaip-editor-timeline";
    version: 1;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    title: string;
    frameRate: 24 | 25 | 30;
    width: number;
    height: number;
    clips: {
      id: string;
      shotId: string;
      orderIndex: number;
      name: string;
      startSeconds: number;
      durationSeconds: number;
      subtitle?: string;
      transition: "cut" | "dissolve" | "fade";
      mediaKind: "video" | "still" | "slate";
      mediaStatus: "referenced" | "needs_relink";
    }[];
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

/** Input of `review/editorCreateRevisionPreview` (`review-editor.createRevisionPreview`). */
export type EditorCreateRevisionPreviewInput = {
  scriptId: string;
  proposedContent: string;
};

/** Answer of `review/editorCreateRevisionPreview` (`review-editor.createRevisionPreview`). */
export type EditorCreateRevisionPreviewResult = {
  id: string;
  projectId: string;
  targets: {
    kind:
      | "project"
      | "chapter"
      | "character"
      | "outline"
      | "story_bible"
      | "episode"
      | "script"
      | "scene"
      | "shot";
    id: string;
    baseVersion: number;
    patch?: JsonValue;
    displayDiff?: JsonValue;
  }[];
  rationale: string;
  status: "pending" | "committed" | "discarded" | "conflicted";
  contentHash: string;
  createdAt: string;
};

/** Answer of `review/editorPreflight` (`review-editor.editorPreflight`). */
export type EditorPreflightResult = {
  canExport: boolean;
  blockers: string[];
  warnings: string[];
  referencedClipCount: number;
  relinkRequiredCount: number;
};

/** Answer of `review/editorExportPackage` (`review-editor.exportPackage`). */
export type EditorExportPackageResult = JsonValue;

/** Input of `review/editorImportOffline` (`review-editor.importOffline`). */
export type EditorImportOfflineInput = {
  capabilityToken: string;
};

/** Answer of `review/editorImportOffline` (`review-editor.importOffline`). */
export type EditorImportOfflineResult = JsonValue;

/** Answer of `review/editorListComments` (`review-editor.listComments`). */
export type EditorListCommentsResult = {
  shotId?: string;
  timecodeSeconds?: number;
  authorAlias?: string;
  body: string;
  id: string;
  packageId: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}[];

/** Answer of `review/editorListDecisions` (`review-editor.listDecisions`). */
export type EditorListDecisionsResult = {
  shotId?: string;
  decision: "approve" | "return" | "request_changes" | "note";
  authorAlias?: string;
  note?: string;
  id: string;
  packageId: string;
  createdAt: string;
}[];

/** Answer of `review/editorListPackages` (`review-editor.listPackages`). */
export type EditorListPackagesResult = {
  id: string;
  projectId: string;
  adaptationId: string;
  episodeId: string;
  kind: "offline";
  status: "exported";
  title: string;
  manifest: {
    format: "dramaip-editor-timeline";
    version: 1;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    title: string;
    frameRate: 24 | 25 | 30;
    width: number;
    height: number;
    clips: {
      id: string;
      shotId: string;
      orderIndex: number;
      name: string;
      startSeconds: number;
      durationSeconds: number;
      subtitle?: string;
      transition: "cut" | "dissolve" | "fade";
      mediaKind: "video" | "still" | "slate";
      mediaStatus: "referenced" | "needs_relink";
    }[];
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
}[];

/** Input of `review/editorResolveComment` (`review-editor.resolveComment`). */
export type EditorResolveCommentInput = {
  resolved: boolean;
};

/** Answer of `review/editorResolveComment` (`review-editor.resolveComment`). */
export type EditorResolveCommentResult = JsonValue;

/** Answer of `review/editorTimeline` (`review-editor.timeline`). */
export type EditorTimelineResult = {
  format: "dramaip-editor-timeline";
  version: 1;
  projectId: string;
  adaptationId: string;
  episodeId: string;
  title: string;
  frameRate: 24 | 25 | 30;
  width: number;
  height: number;
  clips: {
    id: string;
    shotId: string;
    orderIndex: number;
    name: string;
    startSeconds: number;
    durationSeconds: number;
    subtitle?: string;
    transition: "cut" | "dissolve" | "fade";
    mediaKind: "video" | "still" | "slate";
    mediaStatus: "referenced" | "needs_relink";
  }[];
  createdAt: string;
};

/** Input of `review/mediaCreatePackage` (`review-media.createPackage`). */
export type MediaCreatePackageInput = {
  projectId: string;
  sourceFingerprint: string;
};

/** Answer of `review/mediaCreatePackage` (`review-media.createPackage`). */
export type MediaCreatePackageResult = {
  requestKey: string;
  episodeId: string;
  projectId: string;
  requestHash: string;
  input: {
    projectId: string;
    sourceFingerprint: string;
  };
  package: {
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    kind: "offline";
    status: "exported";
    title: string;
    manifest: {
      format: "dramaip-editor-timeline";
      version: 1;
      projectId: string;
      adaptationId: string;
      episodeId: string;
      title: string;
      frameRate: 24 | 25 | 30;
      width: number;
      height: number;
      clips: {
        id: string;
        shotId: string;
        orderIndex: number;
        name: string;
        startSeconds: number;
        durationSeconds: number;
        subtitle?: string;
        transition: "cut" | "dissolve" | "fade";
        mediaKind: "video" | "still" | "slate";
        mediaStatus: "referenced" | "needs_relink";
      }[];
      createdAt: string;
    };
    createdAt: string;
    updatedAt: string;
  };
  original: {
    projectId: string;
    adaptationId: string;
    episodeId: string;
    scope: "original-nle-metadata-review";
    releaseReady: false;
    sourceFingerprint: string;
    snapshot: {
      episode: {
        id: string;
        version: number;
        fingerprint: string;
      };
      adaptation: {
        id: string;
        version: number;
        fingerprint: string;
      };
      nodes: {
        id: string;
        version: number;
        fingerprint: string;
        kind: "scripts" | "scenes" | "shots";
      }[];
      media: {
        id: string;
        version: number;
        fingerprint: string;
      }[];
      delivery: {
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
            kind:
              "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
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
          sourceStatus:
            "current" | "unverified" | "stale" | "missing" | "foreign";
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
            | "not-provided"
            | "user-reported-cleared"
            | "user-reported-restricted";
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
    shotIds: string[];
  };
  createdAt: string;
};

/** Query of `review/mediaEvidence` (`review-media.evidence`). */
export type MediaEvidenceQuery = {
  projectId: string;
  episodeId: string;
};

/** Answer of `review/mediaEvidence` (`review-media.evidence`). */
export type MediaEvidenceResult =
  | {
      packageId: string;
      projectId: string;
      episodeId: string;
      releaseReady: false;
      kind: "legacy-unbound";
      reviewState: "unverified";
      scope: "legacy-review-not-bound-to-nle";
    }
  | {
      packageId: string;
      projectId: string;
      episodeId: string;
      releaseReady: false;
      kind: "source-bound";
      scope: "original-nle-metadata-review";
      original: {
        projectId: string;
        adaptationId: string;
        episodeId: string;
        scope: "original-nle-metadata-review";
        releaseReady: false;
        sourceFingerprint: string;
        snapshot: {
          episode: {
            id: string;
            version: number;
            fingerprint: string;
          };
          adaptation: {
            id: string;
            version: number;
            fingerprint: string;
          };
          nodes: {
            id: string;
            version: number;
            fingerprint: string;
            kind: "scripts" | "scenes" | "shots";
          }[];
          media: {
            id: string;
            version: number;
            fingerprint: string;
          }[];
          delivery: {
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
                kind:
                  | "video"
                  | "dialogue"
                  | "narration"
                  | "bgm"
                  | "sfx"
                  | "subtitle";
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
                    | "linked"
                    | "missing"
                    | "unsupported"
                    | "proxy"
                    | "unattached";
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
              sourceStatus:
                "current" | "unverified" | "stale" | "missing" | "foreign";
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
                | "not-provided"
                | "user-reported-cleared"
                | "user-reported-restricted";
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
        shotIds: string[];
      };
      sourceState: "current" | "changed" | "missing";
      reviewState: "pending" | "blocked" | "approved" | "stale";
      mediaOwnerEvidence: {
        scope: "original-package-media-owner-metadata";
        state: "blocked" | "unverified" | "no-media";
        assets: (
          | {
              id: string;
              version: number;
              fingerprint: string;
              binding: "exact";
              evidence: {
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
                    | "user-reported-cleared"
                    | "user-reported-restricted"
                    | "not-provided";
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
                  kind:
                    | "image"
                    | "audio"
                    | "video"
                    | "subtitle"
                    | "project-package";
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
              archiveBinding:
                | "matching-original-archive"
                | "changed-original-archive"
                | "not-originally-bound";
            }
          | {
              id: string;
              version: number;
              fingerprint: string;
              binding: "changed";
              current: {
                id: string;
                version: number;
                fingerprint: string;
              };
            }
          | {
              id: string;
              version: number;
              fingerprint: string;
              binding: "missing";
            }
          | {
              id: string;
              version: number;
              fingerprint: string;
              binding: "owner-unavailable";
            }
        )[];
        blockers: {
          recordId: string;
          code:
            | "MEDIA_RECORD_CHANGED"
            | "MEDIA_RECORD_MISSING"
            | "MEDIA_OWNER_UNAVAILABLE"
            | "ORIGINAL_ARCHIVE_CHANGED"
            | "ORIGINAL_ARCHIVE_UNBOUND"
            | "DECLARED_RIGHTS_RESTRICTED"
            | "DECLARED_PROVIDER_UNAVAILABLE"
            | "SOURCE_STALE"
            | "SOURCE_UNVERIFIED"
            | "ARCHIVE_UNAVAILABLE";
        }[];
        releaseReady: false;
      };
      decisionFingerprint: string;
      decisions: {
        id: string;
        shotId?: string;
        decision: "approve" | "return" | "request_changes" | "note";
        createdAt: string;
        effective: boolean;
      }[];
      comments: {
        id: string;
        shotId?: string;
        resolved: boolean;
        createdAt: string;
        updatedAt: string;
      }[];
      blockers: (
        | "SOURCE_CHANGED"
        | "SOURCE_MISSING"
        | "SOURCE_BLOCKED"
        | "UNRESOLVED_COMMENT"
        | "RETURN_DECISION"
        | "PACKAGE_APPROVAL_MISSING"
        | "INVALID_FEEDBACK_SCOPE"
      )[];
      unknowns: [
        "CONTENT_QUALITY_UNVERIFIED",
        "LEGAL_RIGHTS_UNVERIFIED",
        "SETTLEMENT_UNKNOWN",
        "CURRENT_FILES_NOT_READ",
        "RENDER_AND_FONT_NOT_REVIEWED",
      ];
    };

/** Query of `review/mediaExportOriginal` (`review-media.exportOriginal`). */
export type MediaExportOriginalQuery = {
  projectId: string;
  episodeId: string;
};

/** Answer of `review/mediaExportOriginal` (`review-media.exportOriginal`). */
export type MediaExportOriginalResult = {
  fileName: string;
  mimeType: "application/json; charset=utf-8";
  content: string;
};

/** Query of `review/mediaPreview` (`review-media.preview`). */
export type MediaPreviewQuery = {
  projectId: string;
};

/** Answer of `review/mediaPreview` (`review-media.preview`). */
export type MediaPreviewResult = {
  projectId: string;
  adaptationId: string;
  episodeId: string;
  scope: "original-nle-metadata-review";
  releaseReady: false;
  sourceFingerprint: string;
  snapshot: {
    episode: {
      id: string;
      version: number;
      fingerprint: string;
    };
    adaptation: {
      id: string;
      version: number;
      fingerprint: string;
    };
    nodes: {
      id: string;
      version: number;
      fingerprint: string;
      kind: "scripts" | "scenes" | "shots";
    }[];
    media: {
      id: string;
      version: number;
      fingerprint: string;
    }[];
    delivery: {
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
        sourceStatus:
          "current" | "unverified" | "stale" | "missing" | "foreign";
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
  shotIds: string[];
};

/** Query of `review/mediaRecoverRequest` (`review-media.recoverRequest`). */
export type MediaRecoverRequestQuery = {
  projectId: string;
};

/** Answer of `review/mediaRecoverRequest` (`review-media.recoverRequest`). */
export type MediaRecoverRequestResult = {
  requestKey: string;
  episodeId: string;
  projectId: string;
  requestHash: string;
  input: {
    projectId: string;
    sourceFingerprint: string;
  };
  package: {
    id: string;
    projectId: string;
    adaptationId: string;
    episodeId: string;
    kind: "offline";
    status: "exported";
    title: string;
    manifest: {
      format: "dramaip-editor-timeline";
      version: 1;
      projectId: string;
      adaptationId: string;
      episodeId: string;
      title: string;
      frameRate: 24 | 25 | 30;
      width: number;
      height: number;
      clips: {
        id: string;
        shotId: string;
        orderIndex: number;
        name: string;
        startSeconds: number;
        durationSeconds: number;
        subtitle?: string;
        transition: "cut" | "dissolve" | "fade";
        mediaKind: "video" | "still" | "slate";
        mediaStatus: "referenced" | "needs_relink";
      }[];
      createdAt: string;
    };
    createdAt: string;
    updatedAt: string;
  };
  original: {
    projectId: string;
    adaptationId: string;
    episodeId: string;
    scope: "original-nle-metadata-review";
    releaseReady: false;
    sourceFingerprint: string;
    snapshot: {
      episode: {
        id: string;
        version: number;
        fingerprint: string;
      };
      adaptation: {
        id: string;
        version: number;
        fingerprint: string;
      };
      nodes: {
        id: string;
        version: number;
        fingerprint: string;
        kind: "scripts" | "scenes" | "shots";
      }[];
      media: {
        id: string;
        version: number;
        fingerprint: string;
      }[];
      delivery: {
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
            kind:
              "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";
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
          sourceStatus:
            "current" | "unverified" | "stale" | "missing" | "foreign";
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
            | "not-provided"
            | "user-reported-cleared"
            | "user-reported-restricted";
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
    shotIds: string[];
  };
  createdAt: string;
};

/** Input of `review/recordsCreate` (`review.records.create`). */
export type RecordsCreateInput = JsonValue;

/** Answer of `review/recordsCreate` (`review.records.create`). */
export type RecordsCreateResult = JsonValue;

/** Answer of `review/recordsGet` (`review.records.get`). */
export type RecordsGetResult = JsonValue;

/** Query of `review/recordsList` (`review.records.list`). */
export type RecordsListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `review/recordsList` (`review.records.list`). */
export type RecordsListResult = JsonValue;

/** Input of `review/recordsUpdate` (`review.records.update`). */
export type RecordsUpdateInput = JsonValue;

/** Answer of `review/recordsUpdate` (`review.records.update`). */
export type RecordsUpdateResult = JsonValue;
