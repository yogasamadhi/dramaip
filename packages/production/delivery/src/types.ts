/**
 * Wire types of the `delivery` Remote namespace: the shapes the
 * replaced `/api/v2` operations declare. Unconstrained parts are `JsonValue`.
 * @module @dramaip/production-delivery/types
 */
import type { JsonValue } from "@dramaip/infra-values";

/** Answer of `delivery/export` (`delivery.export`). */
export type ExportResult = JsonValue;

/** Input of `delivery/recordsCreate` (`delivery.records.create`). */
export type RecordsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `delivery/recordsCreate` (`delivery.records.create`). */
export type RecordsCreateResult = JsonValue;

/** Answer of `delivery/recordsGet` (`delivery.records.get`). */
export type RecordsGetResult = JsonValue;

/** Query of `delivery/recordsList` (`delivery.records.list`). */
export type RecordsListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `delivery/recordsList` (`delivery.records.list`). */
export type RecordsListResult = JsonValue;

/** Input of `delivery/recordsUpdate` (`delivery.records.update`). */
export type RecordsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `delivery/recordsUpdate` (`delivery.records.update`). */
export type RecordsUpdateResult = JsonValue;

/** Answer of `delivery/localizationAdopt` (`localization.adopt`). */
export type LocalizationAdoptResult = JsonValue;

/** Input of `delivery/localizationRecordsCreate` (`localization.records.create`). */
export type LocalizationRecordsCreateInput = {
  projectId: string;
  parentId?: string;
  title: string;
  payload?: Record<string, JsonValue>;
};

/** Answer of `delivery/localizationRecordsCreate` (`localization.records.create`). */
export type LocalizationRecordsCreateResult = JsonValue;

/** Answer of `delivery/localizationRecordsGet` (`localization.records.get`). */
export type LocalizationRecordsGetResult = JsonValue;

/** Query of `delivery/localizationRecordsList` (`localization.records.list`). */
export type LocalizationRecordsListQuery = {
  projectId?: string;
  parentId?: string;
};

/** Answer of `delivery/localizationRecordsList` (`localization.records.list`). */
export type LocalizationRecordsListResult = JsonValue;

/** Input of `delivery/localizationRecordsUpdate` (`localization.records.update`). */
export type LocalizationRecordsUpdateInput = {
  title?: string;
  payload?: Record<string, JsonValue>;
  version: number;
};

/** Answer of `delivery/localizationRecordsUpdate` (`localization.records.update`). */
export type LocalizationRecordsUpdateResult = JsonValue;

/** Answer of `delivery/localizationSubtitles` (`localization.subtitles`). */
export type LocalizationSubtitlesResult = JsonValue;

/** Answer of `delivery/manuscriptsGet` (`manuscripts.get`). */
export type ManuscriptsGetResult = {
  id: string;
  version: number;
  manifest: {
    schemaVersion: 1;
    projectId: string;
    projectVersion: number;
    projectTitle: string;
    scope: "whole-project" | "selected-chapters";
    chapters: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentSha256: string;
    }[];
    format: "markdown" | "json";
    fileName: string;
    contentSha256: string;
    byteSize: number;
    createdAt: string;
  };
  status: "awaiting-confirmation" | "saving" | "saved" | "canceled" | "failed";
  rights?: {
    basis: "original" | "authorized" | "public-domain";
    note: string;
    confirmed: true;
  };
  receipt?: {
    artifactRef: string;
    sha256: string;
    byteSize: number;
    savedAt: string;
  };
  sourceState: "current" | "stale";
  sourceIssues: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  document: {
    content: string;
    mimeType: string;
  };
};

/** Query of `delivery/manuscriptsList` (`manuscripts.list`). */
export type ManuscriptsListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `delivery/manuscriptsList` (`manuscripts.list`). */
export type ManuscriptsListResult = {
  items: {
    id: string;
    version: number;
    manifest: {
      schemaVersion: 1;
      projectId: string;
      projectVersion: number;
      projectTitle: string;
      scope: "whole-project" | "selected-chapters";
      chapters: {
        id: string;
        version: number;
        title: string;
        orderIndex: number;
        contentSha256: string;
      }[];
      format: "markdown" | "json";
      fileName: string;
      contentSha256: string;
      byteSize: number;
      createdAt: string;
    };
    status:
      "awaiting-confirmation" | "saving" | "saved" | "canceled" | "failed";
    rights?: {
      basis: "original" | "authorized" | "public-domain";
      note: string;
      confirmed: true;
    };
    receipt?: {
      artifactRef: string;
      sha256: string;
      byteSize: number;
      savedAt: string;
    };
    sourceState: "current" | "stale";
    sourceIssues: string[];
    error?: string;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `delivery/manuscriptsPreview` (`manuscripts.preview`). */
export type ManuscriptsPreviewInput = {
  projectVersion: number;
  scope: "whole-project" | "selected-chapters";
  chapters: {
    id: string;
    version: number;
  }[];
  format: "markdown" | "json";
};

/** Answer of `delivery/manuscriptsPreview` (`manuscripts.preview`). */
export type ManuscriptsPreviewResult = {
  id: string;
  version: number;
  manifest: {
    schemaVersion: 1;
    projectId: string;
    projectVersion: number;
    projectTitle: string;
    scope: "whole-project" | "selected-chapters";
    chapters: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentSha256: string;
    }[];
    format: "markdown" | "json";
    fileName: string;
    contentSha256: string;
    byteSize: number;
    createdAt: string;
  };
  status: "awaiting-confirmation" | "saving" | "saved" | "canceled" | "failed";
  rights?: {
    basis: "original" | "authorized" | "public-domain";
    note: string;
    confirmed: true;
  };
  receipt?: {
    artifactRef: string;
    sha256: string;
    byteSize: number;
    savedAt: string;
  };
  sourceState: "current" | "stale";
  sourceIssues: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  document: {
    content: string;
    mimeType: string;
  };
};

/** Input of `delivery/manuscriptsSave` (`manuscripts.save`). */
export type ManuscriptsSaveInput = {
  version: number;
  contentSha256: string;
  rights: {
    basis: "original" | "authorized" | "public-domain";
    note: string;
    confirmed: true;
  };
};

/** Answer of `delivery/manuscriptsSave` (`manuscripts.save`). */
export type ManuscriptsSaveResult = {
  id: string;
  version: number;
  manifest: {
    schemaVersion: 1;
    projectId: string;
    projectVersion: number;
    projectTitle: string;
    scope: "whole-project" | "selected-chapters";
    chapters: {
      id: string;
      version: number;
      title: string;
      orderIndex: number;
      contentSha256: string;
    }[];
    format: "markdown" | "json";
    fileName: string;
    contentSha256: string;
    byteSize: number;
    createdAt: string;
  };
  status: "awaiting-confirmation" | "saving" | "saved" | "canceled" | "failed";
  rights?: {
    basis: "original" | "authorized" | "public-domain";
    note: string;
    confirmed: true;
  };
  receipt?: {
    artifactRef: string;
    sha256: string;
    byteSize: number;
    savedAt: string;
  };
  sourceState: "current" | "stale";
  sourceIssues: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  document: {
    content: string;
    mimeType: string;
  };
};

/** Answer of `delivery/pilotPackagesGet` (`pilotPackages.get`). */
export type PilotPackagesGetResult = {
  id: string;
  version: number;
  status: "awaiting-confirmation" | "saving" | "saved" | "canceled" | "failed";
  manifest: {
    schemaVersion: 1;
    purpose: "internal-pilot";
    projectId: string;
    projectVersion: number;
    projectTitle: string;
    episodeId: string;
    episodeTitle: string;
    durationSeconds: number;
    adopted: {
      authorIntent: {
        id: string;
        version: number;
      };
      diagnosis?: {
        id: string;
        version: number;
        strategyId: string;
      };
      strategy?: {
        id: string;
        version: number;
        optionId: string;
      };
      seasonPlan?: {
        id: string;
        version: number;
      };
      outline: {
        id: string;
        version: number;
      };
      script: {
        id: string;
        version: number;
      };
      storyboard: {
        id: string;
        version: number;
      };
      shotAttribution?: {
        id: string;
        version: number;
      };
      directSource?: {
        entryPath: "inspiration" | "script";
        project: {
          id: string;
          version: number;
        };
        authorIntent: {
          id: string;
          version: number;
        };
        episode: {
          id: string;
          version: number;
        };
        sourceScript?: {
          id: string;
          version: number;
          documentVersion: number | null;
        };
        durationSeconds: number;
      };
    };
    scriptRecordId: string;
    scriptDocumentVersion: number;
    productionRecords: {
      id: string;
      stableId: string;
      kind: "scenes" | "shots";
      version: number;
    }[];
    lineage: {
      sourceKind: string;
      sourceId: string;
      sourceVersion: number;
    }[];
    preflight: {
      checks: {
        id: string;
        label: string;
        state: "passed" | "unknown" | "blocked";
        evidenceKind: "rule" | "model" | "human";
        detail: string;
      }[];
      blockers: string[];
      warnings: string[];
    };
    qualityEvidence?: {
      target: {
        id: string;
        version: number;
        kind:
          | "chapter"
          | "chapter-set"
          | "diagnosis"
          | "season-plan"
          | "episode-result"
          | "script"
          | "scene";
        sourceFingerprint?: string;
      };
      state: "unknown" | "blocked" | "reviewed" | "reviewed-with-risk";
      requiredDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reviewedDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      missingDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reports: {
        id: string;
        version: number;
      }[];
      blockers: {
        reportId: string;
        issueId: string;
        category:
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk";
      }[];
      acceptedRiskCount: number;
    }[];
    localQualityEvidence?: {
      target: {
        id: string;
        version: number;
        kind:
          | "chapter"
          | "chapter-set"
          | "diagnosis"
          | "season-plan"
          | "episode-result"
          | "script"
          | "scene";
        sourceFingerprint?: string;
      };
      state: "unknown" | "blocked" | "reviewed" | "reviewed-with-risk";
      qualityState: "unverified";
      requiredDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reviewedDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      missingDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reviews: {
        id: string;
        version: number;
        origin: "human-declared" | "rule";
      }[];
      blockers: {
        reviewId: string;
        issueId: string;
        category:
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk";
      }[];
      acceptedRiskCount: number;
    }[];
    missingItems: string[];
    externalDependencies: string[];
    costs: {
      status: "unknown";
      explanation: string;
    };
    media: {
      binaryIncluded: false;
      generatedByExport: false;
    };
    timeline?: {
      id: string;
      version: number;
    };
    files: {
      fileName: string;
      mimeType: string;
      sha256: string;
      byteSize: number;
    }[];
    indexFile: "manifest.json";
    createdAt: string;
  };
  archive: {
    fileName: string;
    mimeType: "application/zip";
    sha256: string;
    byteSize: number;
  };
  rights?: {
    basis: "original" | "authorized" | "public-domain";
    note: string;
    confirmed: true;
  };
  receipt?: {
    artifactRef: string;
    sha256: string;
    byteSize: number;
    savedAt: string;
  };
  sourceState: "current" | "stale";
  sourceIssues: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  files: {
    fileName: string;
    mimeType: string;
    sha256: string;
    byteSize: number;
    content: string;
  }[];
};

/** Query of `delivery/pilotPackagesList` (`pilotPackages.list`). */
export type PilotPackagesListQuery = {
  cursor?: string;
  limit?: number;
};

/** Answer of `delivery/pilotPackagesList` (`pilotPackages.list`). */
export type PilotPackagesListResult = {
  items: {
    id: string;
    version: number;
    status:
      "awaiting-confirmation" | "saving" | "saved" | "canceled" | "failed";
    manifest: {
      schemaVersion: 1;
      purpose: "internal-pilot";
      projectId: string;
      projectVersion: number;
      projectTitle: string;
      episodeId: string;
      episodeTitle: string;
      durationSeconds: number;
      adopted: {
        authorIntent: {
          id: string;
          version: number;
        };
        diagnosis?: {
          id: string;
          version: number;
          strategyId: string;
        };
        strategy?: {
          id: string;
          version: number;
          optionId: string;
        };
        seasonPlan?: {
          id: string;
          version: number;
        };
        outline: {
          id: string;
          version: number;
        };
        script: {
          id: string;
          version: number;
        };
        storyboard: {
          id: string;
          version: number;
        };
        shotAttribution?: {
          id: string;
          version: number;
        };
        directSource?: {
          entryPath: "inspiration" | "script";
          project: {
            id: string;
            version: number;
          };
          authorIntent: {
            id: string;
            version: number;
          };
          episode: {
            id: string;
            version: number;
          };
          sourceScript?: {
            id: string;
            version: number;
            documentVersion: number | null;
          };
          durationSeconds: number;
        };
      };
      scriptRecordId: string;
      scriptDocumentVersion: number;
      productionRecords: {
        id: string;
        stableId: string;
        kind: "scenes" | "shots";
        version: number;
      }[];
      lineage: {
        sourceKind: string;
        sourceId: string;
        sourceVersion: number;
      }[];
      preflight: {
        checks: {
          id: string;
          label: string;
          state: "passed" | "unknown" | "blocked";
          evidenceKind: "rule" | "model" | "human";
          detail: string;
        }[];
        blockers: string[];
        warnings: string[];
      };
      qualityEvidence?: {
        target: {
          id: string;
          version: number;
          kind:
            | "chapter"
            | "chapter-set"
            | "diagnosis"
            | "season-plan"
            | "episode-result"
            | "script"
            | "scene";
          sourceFingerprint?: string;
        };
        state: "unknown" | "blocked" | "reviewed" | "reviewed-with-risk";
        requiredDimensions: (
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk"
        )[];
        reviewedDimensions: (
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk"
        )[];
        missingDimensions: (
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk"
        )[];
        reports: {
          id: string;
          version: number;
        }[];
        blockers: {
          reportId: string;
          issueId: string;
          category:
            | "author-intent"
            | "character-knowledge"
            | "relationships"
            | "timeline"
            | "causality"
            | "foreshadowing"
            | "repetition"
            | "pacing"
            | "dialogue"
            | "production-risk";
        }[];
        acceptedRiskCount: number;
      }[];
      localQualityEvidence?: {
        target: {
          id: string;
          version: number;
          kind:
            | "chapter"
            | "chapter-set"
            | "diagnosis"
            | "season-plan"
            | "episode-result"
            | "script"
            | "scene";
          sourceFingerprint?: string;
        };
        state: "unknown" | "blocked" | "reviewed" | "reviewed-with-risk";
        qualityState: "unverified";
        requiredDimensions: (
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk"
        )[];
        reviewedDimensions: (
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk"
        )[];
        missingDimensions: (
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk"
        )[];
        reviews: {
          id: string;
          version: number;
          origin: "human-declared" | "rule";
        }[];
        blockers: {
          reviewId: string;
          issueId: string;
          category:
            | "author-intent"
            | "character-knowledge"
            | "relationships"
            | "timeline"
            | "causality"
            | "foreshadowing"
            | "repetition"
            | "pacing"
            | "dialogue"
            | "production-risk";
        }[];
        acceptedRiskCount: number;
      }[];
      missingItems: string[];
      externalDependencies: string[];
      costs: {
        status: "unknown";
        explanation: string;
      };
      media: {
        binaryIncluded: false;
        generatedByExport: false;
      };
      timeline?: {
        id: string;
        version: number;
      };
      files: {
        fileName: string;
        mimeType: string;
        sha256: string;
        byteSize: number;
      }[];
      indexFile: "manifest.json";
      createdAt: string;
    };
    archive: {
      fileName: string;
      mimeType: "application/zip";
      sha256: string;
      byteSize: number;
    };
    rights?: {
      basis: "original" | "authorized" | "public-domain";
      note: string;
      confirmed: true;
    };
    receipt?: {
      artifactRef: string;
      sha256: string;
      byteSize: number;
      savedAt: string;
    };
    sourceState: "current" | "stale";
    sourceIssues: string[];
    error?: string;
    createdAt: string;
    updatedAt: string;
  }[];
  nextCursor?: string;
};

/** Input of `delivery/pilotPackagesPreview` (`pilotPackages.preview`). */
export type PilotPackagesPreviewInput = {
  projectVersion: number;
  storyboard: {
    id: string;
    version: number;
  };
  shotAttribution?: {
    id: string;
    version: number;
  };
  includeNle?: boolean;
  includeWorkflowLineage?: boolean;
};

/** Answer of `delivery/pilotPackagesPreview` (`pilotPackages.preview`). */
export type PilotPackagesPreviewResult = {
  id: string;
  version: number;
  status: "awaiting-confirmation" | "saving" | "saved" | "canceled" | "failed";
  manifest: {
    schemaVersion: 1;
    purpose: "internal-pilot";
    projectId: string;
    projectVersion: number;
    projectTitle: string;
    episodeId: string;
    episodeTitle: string;
    durationSeconds: number;
    adopted: {
      authorIntent: {
        id: string;
        version: number;
      };
      diagnosis?: {
        id: string;
        version: number;
        strategyId: string;
      };
      strategy?: {
        id: string;
        version: number;
        optionId: string;
      };
      seasonPlan?: {
        id: string;
        version: number;
      };
      outline: {
        id: string;
        version: number;
      };
      script: {
        id: string;
        version: number;
      };
      storyboard: {
        id: string;
        version: number;
      };
      shotAttribution?: {
        id: string;
        version: number;
      };
      directSource?: {
        entryPath: "inspiration" | "script";
        project: {
          id: string;
          version: number;
        };
        authorIntent: {
          id: string;
          version: number;
        };
        episode: {
          id: string;
          version: number;
        };
        sourceScript?: {
          id: string;
          version: number;
          documentVersion: number | null;
        };
        durationSeconds: number;
      };
    };
    scriptRecordId: string;
    scriptDocumentVersion: number;
    productionRecords: {
      id: string;
      stableId: string;
      kind: "scenes" | "shots";
      version: number;
    }[];
    lineage: {
      sourceKind: string;
      sourceId: string;
      sourceVersion: number;
    }[];
    preflight: {
      checks: {
        id: string;
        label: string;
        state: "passed" | "unknown" | "blocked";
        evidenceKind: "rule" | "model" | "human";
        detail: string;
      }[];
      blockers: string[];
      warnings: string[];
    };
    qualityEvidence?: {
      target: {
        id: string;
        version: number;
        kind:
          | "chapter"
          | "chapter-set"
          | "diagnosis"
          | "season-plan"
          | "episode-result"
          | "script"
          | "scene";
        sourceFingerprint?: string;
      };
      state: "unknown" | "blocked" | "reviewed" | "reviewed-with-risk";
      requiredDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reviewedDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      missingDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reports: {
        id: string;
        version: number;
      }[];
      blockers: {
        reportId: string;
        issueId: string;
        category:
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk";
      }[];
      acceptedRiskCount: number;
    }[];
    localQualityEvidence?: {
      target: {
        id: string;
        version: number;
        kind:
          | "chapter"
          | "chapter-set"
          | "diagnosis"
          | "season-plan"
          | "episode-result"
          | "script"
          | "scene";
        sourceFingerprint?: string;
      };
      state: "unknown" | "blocked" | "reviewed" | "reviewed-with-risk";
      qualityState: "unverified";
      requiredDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reviewedDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      missingDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reviews: {
        id: string;
        version: number;
        origin: "human-declared" | "rule";
      }[];
      blockers: {
        reviewId: string;
        issueId: string;
        category:
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk";
      }[];
      acceptedRiskCount: number;
    }[];
    missingItems: string[];
    externalDependencies: string[];
    costs: {
      status: "unknown";
      explanation: string;
    };
    media: {
      binaryIncluded: false;
      generatedByExport: false;
    };
    timeline?: {
      id: string;
      version: number;
    };
    files: {
      fileName: string;
      mimeType: string;
      sha256: string;
      byteSize: number;
    }[];
    indexFile: "manifest.json";
    createdAt: string;
  };
  archive: {
    fileName: string;
    mimeType: "application/zip";
    sha256: string;
    byteSize: number;
  };
  rights?: {
    basis: "original" | "authorized" | "public-domain";
    note: string;
    confirmed: true;
  };
  receipt?: {
    artifactRef: string;
    sha256: string;
    byteSize: number;
    savedAt: string;
  };
  sourceState: "current" | "stale";
  sourceIssues: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  files: {
    fileName: string;
    mimeType: string;
    sha256: string;
    byteSize: number;
    content: string;
  }[];
};

/** Input of `delivery/pilotPackagesSave` (`pilotPackages.save`). */
export type PilotPackagesSaveInput = {
  version: number;
  archiveSha256: string;
  rights: {
    basis: "original" | "authorized" | "public-domain";
    note: string;
    confirmed: true;
  };
  internalReviewConfirmed: true;
  unverifiedChecksAcknowledged: true;
};

/** Answer of `delivery/pilotPackagesSave` (`pilotPackages.save`). */
export type PilotPackagesSaveResult = {
  id: string;
  version: number;
  status: "awaiting-confirmation" | "saving" | "saved" | "canceled" | "failed";
  manifest: {
    schemaVersion: 1;
    purpose: "internal-pilot";
    projectId: string;
    projectVersion: number;
    projectTitle: string;
    episodeId: string;
    episodeTitle: string;
    durationSeconds: number;
    adopted: {
      authorIntent: {
        id: string;
        version: number;
      };
      diagnosis?: {
        id: string;
        version: number;
        strategyId: string;
      };
      strategy?: {
        id: string;
        version: number;
        optionId: string;
      };
      seasonPlan?: {
        id: string;
        version: number;
      };
      outline: {
        id: string;
        version: number;
      };
      script: {
        id: string;
        version: number;
      };
      storyboard: {
        id: string;
        version: number;
      };
      shotAttribution?: {
        id: string;
        version: number;
      };
      directSource?: {
        entryPath: "inspiration" | "script";
        project: {
          id: string;
          version: number;
        };
        authorIntent: {
          id: string;
          version: number;
        };
        episode: {
          id: string;
          version: number;
        };
        sourceScript?: {
          id: string;
          version: number;
          documentVersion: number | null;
        };
        durationSeconds: number;
      };
    };
    scriptRecordId: string;
    scriptDocumentVersion: number;
    productionRecords: {
      id: string;
      stableId: string;
      kind: "scenes" | "shots";
      version: number;
    }[];
    lineage: {
      sourceKind: string;
      sourceId: string;
      sourceVersion: number;
    }[];
    preflight: {
      checks: {
        id: string;
        label: string;
        state: "passed" | "unknown" | "blocked";
        evidenceKind: "rule" | "model" | "human";
        detail: string;
      }[];
      blockers: string[];
      warnings: string[];
    };
    qualityEvidence?: {
      target: {
        id: string;
        version: number;
        kind:
          | "chapter"
          | "chapter-set"
          | "diagnosis"
          | "season-plan"
          | "episode-result"
          | "script"
          | "scene";
        sourceFingerprint?: string;
      };
      state: "unknown" | "blocked" | "reviewed" | "reviewed-with-risk";
      requiredDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reviewedDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      missingDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reports: {
        id: string;
        version: number;
      }[];
      blockers: {
        reportId: string;
        issueId: string;
        category:
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk";
      }[];
      acceptedRiskCount: number;
    }[];
    localQualityEvidence?: {
      target: {
        id: string;
        version: number;
        kind:
          | "chapter"
          | "chapter-set"
          | "diagnosis"
          | "season-plan"
          | "episode-result"
          | "script"
          | "scene";
        sourceFingerprint?: string;
      };
      state: "unknown" | "blocked" | "reviewed" | "reviewed-with-risk";
      qualityState: "unverified";
      requiredDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reviewedDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      missingDimensions: (
        | "author-intent"
        | "character-knowledge"
        | "relationships"
        | "timeline"
        | "causality"
        | "foreshadowing"
        | "repetition"
        | "pacing"
        | "dialogue"
        | "production-risk"
      )[];
      reviews: {
        id: string;
        version: number;
        origin: "human-declared" | "rule";
      }[];
      blockers: {
        reviewId: string;
        issueId: string;
        category:
          | "author-intent"
          | "character-knowledge"
          | "relationships"
          | "timeline"
          | "causality"
          | "foreshadowing"
          | "repetition"
          | "pacing"
          | "dialogue"
          | "production-risk";
      }[];
      acceptedRiskCount: number;
    }[];
    missingItems: string[];
    externalDependencies: string[];
    costs: {
      status: "unknown";
      explanation: string;
    };
    media: {
      binaryIncluded: false;
      generatedByExport: false;
    };
    timeline?: {
      id: string;
      version: number;
    };
    files: {
      fileName: string;
      mimeType: string;
      sha256: string;
      byteSize: number;
    }[];
    indexFile: "manifest.json";
    createdAt: string;
  };
  archive: {
    fileName: string;
    mimeType: "application/zip";
    sha256: string;
    byteSize: number;
  };
  rights?: {
    basis: "original" | "authorized" | "public-domain";
    note: string;
    confirmed: true;
  };
  receipt?: {
    artifactRef: string;
    sha256: string;
    byteSize: number;
    savedAt: string;
  };
  sourceState: "current" | "stale";
  sourceIssues: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  files: {
    fileName: string;
    mimeType: string;
    sha256: string;
    byteSize: number;
    content: string;
  }[];
};

/** Input of `delivery/platformAdoptVariant` (`platform-delivery.adoptVariant`). */
export type PlatformAdoptVariantInput = {
  projectId: string;
  adaptationId: string;
  projectVersion: number;
  adaptationVersion: number;
  variantVersion: number;
  contentFingerprint: string;
  expectedHeadRevision: number;
};

/** Answer of `delivery/platformAdoptVariant` (`platform-delivery.adoptVariant`). */
export type PlatformAdoptVariantResult =
  | {
      requestKey: string;
      projectId: string;
      aggregateId: string;
      requestHash: string;
      createdAt: string;
      operation: "adopt";
      input: {
        projectId: string;
        adaptationId: string;
        projectVersion: number;
        adaptationVersion: number;
        variantVersion: number;
        contentFingerprint: string;
        expectedHeadRevision: number;
      };
      result: {
        label: string;
        title: string;
        description: string;
        tags: string[];
        coverAssetId?: string;
        source?: "manual" | "ai_draft";
        id: string;
        projectId: string;
        adaptationId: string;
        version: number;
        versionNumber: number;
        createdAt: string;
        updatedAt: string;
        status: "candidate" | "adopted" | "archived";
        contentFingerprint: string;
        projectVersion: number;
        adaptationVersion: number;
        headRevision: number;
        adoptionVerified: boolean;
      };
    }
  | {
      requestKey: string;
      projectId: string;
      aggregateId: string;
      requestHash: string;
      createdAt: string;
      operation: "archive";
      input: {
        projectId: string;
        profileId: string;
        creativeVariantId: string;
        manualFieldsConfirmed: boolean;
        sourceFingerprint: string;
      };
      result: {
        scope: "submission-metadata-only";
        releaseReady: false;
        unknowns: [
          "CONTENT_QUALITY_UNVERIFIED",
          "LEGAL_RIGHTS_UNVERIFIED",
          "SETTLEMENT_UNKNOWN",
          "CURRENT_FILES_NOT_READ",
          "PLATFORM_RULES_NOT_VERIFIED",
        ];
        id: string;
        projectId: string;
        adaptationId: string;
        episodeId: string;
        profileId: string;
        profileVersion: string;
        creativeVariantId: string;
        deliveryVersion: number;
        sourceFingerprint: string;
        createdAt: string;
        preflight: {
          scope: "submission-metadata-only";
          releaseReady: false;
          unknowns: [
            "CONTENT_QUALITY_UNVERIFIED",
            "LEGAL_RIGHTS_UNVERIFIED",
            "SETTLEMENT_UNKNOWN",
            "CURRENT_FILES_NOT_READ",
            "PLATFORM_RULES_NOT_VERIFIED",
          ];
          episodeId: string;
          input: {
            projectId: string;
            profileId: string;
            creativeVariantId: string;
            manualFieldsConfirmed: boolean;
          };
          ok: boolean;
          profile?: {
            id: string;
            version: string;
            title: string;
            platform: string;
            region: string;
            sourceUrl: string;
            sourceStatus: "internal_master";
            checkedAt: string;
            filenamePrefix: string;
            video: {
              width: number;
              height: number;
              videoCodec: string;
              audioCodec: string;
            };
            duration: {
              status: "manual";
              note: string;
            };
            subtitleSafeZone: {
              bottomMarginPx: number;
              note: string;
            };
            requiredListingFields: string[];
            manualFields: string[];
          };
          blockers: string[];
          warnings: string[];
          expectedFiles: string[];
          finalBaseName: string;
          sourceFingerprint: string;
          snapshot?: {
            project: {
              id: string;
              version: number;
              fingerprint: string;
            };
            adaptation: {
              id: string;
              version: number;
              fingerprint: string;
            };
            episode: {
              id: string;
              version: number;
              fingerprint: string;
            };
            profile: {
              id: string;
              version: string;
              title: string;
              platform: string;
              region: string;
              sourceUrl: string;
              sourceStatus: "internal_master";
              checkedAt: string;
              filenamePrefix: string;
              video: {
                width: number;
                height: number;
                videoCodec: string;
                audioCodec: string;
              };
              duration: {
                status: "manual";
                note: string;
              };
              subtitleSafeZone: {
                bottomMarginPx: number;
                note: string;
              };
              requiredListingFields: string[];
              manualFields: string[];
            };
            variant: {
              label: string;
              title: string;
              description: string;
              tags: string[];
              coverAssetId?: string;
              source?: "manual" | "ai_draft";
              id: string;
              projectId: string;
              adaptationId: string;
              version: number;
              versionNumber: number;
              createdAt: string;
              updatedAt: string;
              status: "candidate" | "adopted" | "archived";
              contentFingerprint: string;
              projectVersion: number;
              adaptationVersion: number;
              headRevision: number;
              adoptionVerified: boolean;
            };
            cover?: {
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
                  "image" | "audio" | "video" | "subtitle" | "project-package";
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
          };
        };
      };
    };

/** Input of `delivery/platformCreateArchive` (`platform-delivery.createArchive`). */
export type PlatformCreateArchiveInput = {
  projectId: string;
  profileId: string;
  creativeVariantId: string;
  manualFieldsConfirmed: boolean;
  sourceFingerprint: string;
};

/** Answer of `delivery/platformCreateArchive` (`platform-delivery.createArchive`). */
export type PlatformCreateArchiveResult =
  | {
      requestKey: string;
      projectId: string;
      aggregateId: string;
      requestHash: string;
      createdAt: string;
      operation: "adopt";
      input: {
        projectId: string;
        adaptationId: string;
        projectVersion: number;
        adaptationVersion: number;
        variantVersion: number;
        contentFingerprint: string;
        expectedHeadRevision: number;
      };
      result: {
        label: string;
        title: string;
        description: string;
        tags: string[];
        coverAssetId?: string;
        source?: "manual" | "ai_draft";
        id: string;
        projectId: string;
        adaptationId: string;
        version: number;
        versionNumber: number;
        createdAt: string;
        updatedAt: string;
        status: "candidate" | "adopted" | "archived";
        contentFingerprint: string;
        projectVersion: number;
        adaptationVersion: number;
        headRevision: number;
        adoptionVerified: boolean;
      };
    }
  | {
      requestKey: string;
      projectId: string;
      aggregateId: string;
      requestHash: string;
      createdAt: string;
      operation: "archive";
      input: {
        projectId: string;
        profileId: string;
        creativeVariantId: string;
        manualFieldsConfirmed: boolean;
        sourceFingerprint: string;
      };
      result: {
        scope: "submission-metadata-only";
        releaseReady: false;
        unknowns: [
          "CONTENT_QUALITY_UNVERIFIED",
          "LEGAL_RIGHTS_UNVERIFIED",
          "SETTLEMENT_UNKNOWN",
          "CURRENT_FILES_NOT_READ",
          "PLATFORM_RULES_NOT_VERIFIED",
        ];
        id: string;
        projectId: string;
        adaptationId: string;
        episodeId: string;
        profileId: string;
        profileVersion: string;
        creativeVariantId: string;
        deliveryVersion: number;
        sourceFingerprint: string;
        createdAt: string;
        preflight: {
          scope: "submission-metadata-only";
          releaseReady: false;
          unknowns: [
            "CONTENT_QUALITY_UNVERIFIED",
            "LEGAL_RIGHTS_UNVERIFIED",
            "SETTLEMENT_UNKNOWN",
            "CURRENT_FILES_NOT_READ",
            "PLATFORM_RULES_NOT_VERIFIED",
          ];
          episodeId: string;
          input: {
            projectId: string;
            profileId: string;
            creativeVariantId: string;
            manualFieldsConfirmed: boolean;
          };
          ok: boolean;
          profile?: {
            id: string;
            version: string;
            title: string;
            platform: string;
            region: string;
            sourceUrl: string;
            sourceStatus: "internal_master";
            checkedAt: string;
            filenamePrefix: string;
            video: {
              width: number;
              height: number;
              videoCodec: string;
              audioCodec: string;
            };
            duration: {
              status: "manual";
              note: string;
            };
            subtitleSafeZone: {
              bottomMarginPx: number;
              note: string;
            };
            requiredListingFields: string[];
            manualFields: string[];
          };
          blockers: string[];
          warnings: string[];
          expectedFiles: string[];
          finalBaseName: string;
          sourceFingerprint: string;
          snapshot?: {
            project: {
              id: string;
              version: number;
              fingerprint: string;
            };
            adaptation: {
              id: string;
              version: number;
              fingerprint: string;
            };
            episode: {
              id: string;
              version: number;
              fingerprint: string;
            };
            profile: {
              id: string;
              version: string;
              title: string;
              platform: string;
              region: string;
              sourceUrl: string;
              sourceStatus: "internal_master";
              checkedAt: string;
              filenamePrefix: string;
              video: {
                width: number;
                height: number;
                videoCodec: string;
                audioCodec: string;
              };
              duration: {
                status: "manual";
                note: string;
              };
              subtitleSafeZone: {
                bottomMarginPx: number;
                note: string;
              };
              requiredListingFields: string[];
              manualFields: string[];
            };
            variant: {
              label: string;
              title: string;
              description: string;
              tags: string[];
              coverAssetId?: string;
              source?: "manual" | "ai_draft";
              id: string;
              projectId: string;
              adaptationId: string;
              version: number;
              versionNumber: number;
              createdAt: string;
              updatedAt: string;
              status: "candidate" | "adopted" | "archived";
              contentFingerprint: string;
              projectVersion: number;
              adaptationVersion: number;
              headRevision: number;
              adoptionVerified: boolean;
            };
            cover?: {
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
                  "image" | "audio" | "video" | "subtitle" | "project-package";
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
          };
        };
      };
    };

/** Input of `delivery/platformCreateVariant` (`platform-delivery.createVariant`). */
export type PlatformCreateVariantInput = {
  label: string;
  title: string;
  description: string;
  tags: string[];
  coverAssetId?: string;
  source?: "manual" | "ai_draft";
};

/** Answer of `delivery/platformCreateVariant` (`platform-delivery.createVariant`). */
export type PlatformCreateVariantResult = {
  label: string;
  title: string;
  description: string;
  tags: string[];
  coverAssetId?: string;
  source?: "manual" | "ai_draft";
  id: string;
  projectId: string;
  adaptationId: string;
  version: number;
  versionNumber: number;
  createdAt: string;
  updatedAt: string;
  status: "candidate" | "adopted" | "archived";
  contentFingerprint: string;
  projectVersion: number;
  adaptationVersion: number;
  headRevision: number;
  adoptionVerified: boolean;
};

/** Query of `delivery/platformExportArchive` (`platform-delivery.exportArchive`). */
export type PlatformExportArchiveQuery = {
  projectId: string;
};

/** Answer of `delivery/platformExportArchive` (`platform-delivery.exportArchive`). */
export type PlatformExportArchiveResult = {
  fileName: string;
  mimeType: "application/json; charset=utf-8";
  content: string;
};

/** Query of `delivery/platformListArchives` (`platform-delivery.listArchives`). */
export type PlatformListArchivesQuery = {
  projectId: string;
};

/** Answer of `delivery/platformListArchives` (`platform-delivery.listArchives`). */
export type PlatformListArchivesResult = (
  | {
      scope: "submission-metadata-only";
      releaseReady: false;
      unknowns: [
        "CONTENT_QUALITY_UNVERIFIED",
        "LEGAL_RIGHTS_UNVERIFIED",
        "SETTLEMENT_UNKNOWN",
        "CURRENT_FILES_NOT_READ",
        "PLATFORM_RULES_NOT_VERIFIED",
      ];
      id: string;
      projectId: string;
      adaptationId: string;
      episodeId: string;
      profileId: string;
      profileVersion: string;
      creativeVariantId: string;
      deliveryVersion: number;
      sourceFingerprint: string;
      createdAt: string;
      preflight: {
        scope: "submission-metadata-only";
        releaseReady: false;
        unknowns: [
          "CONTENT_QUALITY_UNVERIFIED",
          "LEGAL_RIGHTS_UNVERIFIED",
          "SETTLEMENT_UNKNOWN",
          "CURRENT_FILES_NOT_READ",
          "PLATFORM_RULES_NOT_VERIFIED",
        ];
        episodeId: string;
        input: {
          projectId: string;
          profileId: string;
          creativeVariantId: string;
          manualFieldsConfirmed: boolean;
        };
        ok: boolean;
        profile?: {
          id: string;
          version: string;
          title: string;
          platform: string;
          region: string;
          sourceUrl: string;
          sourceStatus: "internal_master";
          checkedAt: string;
          filenamePrefix: string;
          video: {
            width: number;
            height: number;
            videoCodec: string;
            audioCodec: string;
          };
          duration: {
            status: "manual";
            note: string;
          };
          subtitleSafeZone: {
            bottomMarginPx: number;
            note: string;
          };
          requiredListingFields: string[];
          manualFields: string[];
        };
        blockers: string[];
        warnings: string[];
        expectedFiles: string[];
        finalBaseName: string;
        sourceFingerprint: string;
        snapshot?: {
          project: {
            id: string;
            version: number;
            fingerprint: string;
          };
          adaptation: {
            id: string;
            version: number;
            fingerprint: string;
          };
          episode: {
            id: string;
            version: number;
            fingerprint: string;
          };
          profile: {
            id: string;
            version: string;
            title: string;
            platform: string;
            region: string;
            sourceUrl: string;
            sourceStatus: "internal_master";
            checkedAt: string;
            filenamePrefix: string;
            video: {
              width: number;
              height: number;
              videoCodec: string;
              audioCodec: string;
            };
            duration: {
              status: "manual";
              note: string;
            };
            subtitleSafeZone: {
              bottomMarginPx: number;
              note: string;
            };
            requiredListingFields: string[];
            manualFields: string[];
          };
          variant: {
            label: string;
            title: string;
            description: string;
            tags: string[];
            coverAssetId?: string;
            source?: "manual" | "ai_draft";
            id: string;
            projectId: string;
            adaptationId: string;
            version: number;
            versionNumber: number;
            createdAt: string;
            updatedAt: string;
            status: "candidate" | "adopted" | "archived";
            contentFingerprint: string;
            projectVersion: number;
            adaptationVersion: number;
            headRevision: number;
            adoptionVerified: boolean;
          };
          cover?: {
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
                "image" | "audio" | "video" | "subtitle" | "project-package";
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
        };
      };
    }
  | {
      scope: "legacy-submission-metadata-unverified";
      releaseReady: false;
      id: string;
      projectId: string;
      episodeId: string;
      createdAt: string;
      deliveryVersion: number;
      profileId: string;
      adaptationId?: string;
      creativeVariantId?: string;
      profileVersion?: string;
      sourceFingerprint?: string;
    }
)[];

/** Answer of `delivery/platformListProfiles` (`platform-delivery.listProfiles`). */
export type PlatformListProfilesResult = {
  id: string;
  version: string;
  title: string;
  platform: string;
  region: string;
  sourceUrl: string;
  sourceStatus: "internal_master";
  checkedAt: string;
  filenamePrefix: string;
  video: {
    width: number;
    height: number;
    videoCodec: string;
    audioCodec: string;
  };
  duration: {
    status: "manual";
    note: string;
  };
  subtitleSafeZone: {
    bottomMarginPx: number;
    note: string;
  };
  requiredListingFields: string[];
  manualFields: string[];
}[];

/** Query of `delivery/platformListVariants` (`platform-delivery.listVariants`). */
export type PlatformListVariantsQuery = {
  projectId: string;
};

/** Answer of `delivery/platformListVariants` (`platform-delivery.listVariants`). */
export type PlatformListVariantsResult = {
  label: string;
  title: string;
  description: string;
  tags: string[];
  coverAssetId?: string;
  source?: "manual" | "ai_draft";
  id: string;
  projectId: string;
  adaptationId: string;
  version: number;
  versionNumber: number;
  createdAt: string;
  updatedAt: string;
  status: "candidate" | "adopted" | "archived";
  contentFingerprint: string;
  projectVersion: number;
  adaptationVersion: number;
  headRevision: number;
  adoptionVerified: boolean;
}[];

/** Input of `delivery/platformPreflight` (`platform-delivery.preflight`). */
export type PlatformPreflightInput = {
  projectId: string;
  profileId: string;
  creativeVariantId: string;
  manualFieldsConfirmed: boolean;
};

/** Answer of `delivery/platformPreflight` (`platform-delivery.preflight`). */
export type PlatformPreflightResult = {
  scope: "submission-metadata-only";
  releaseReady: false;
  unknowns: [
    "CONTENT_QUALITY_UNVERIFIED",
    "LEGAL_RIGHTS_UNVERIFIED",
    "SETTLEMENT_UNKNOWN",
    "CURRENT_FILES_NOT_READ",
    "PLATFORM_RULES_NOT_VERIFIED",
  ];
  episodeId: string;
  input: {
    projectId: string;
    profileId: string;
    creativeVariantId: string;
    manualFieldsConfirmed: boolean;
  };
  ok: boolean;
  profile?: {
    id: string;
    version: string;
    title: string;
    platform: string;
    region: string;
    sourceUrl: string;
    sourceStatus: "internal_master";
    checkedAt: string;
    filenamePrefix: string;
    video: {
      width: number;
      height: number;
      videoCodec: string;
      audioCodec: string;
    };
    duration: {
      status: "manual";
      note: string;
    };
    subtitleSafeZone: {
      bottomMarginPx: number;
      note: string;
    };
    requiredListingFields: string[];
    manualFields: string[];
  };
  blockers: string[];
  warnings: string[];
  expectedFiles: string[];
  finalBaseName: string;
  sourceFingerprint: string;
  snapshot?: {
    project: {
      id: string;
      version: number;
      fingerprint: string;
    };
    adaptation: {
      id: string;
      version: number;
      fingerprint: string;
    };
    episode: {
      id: string;
      version: number;
      fingerprint: string;
    };
    profile: {
      id: string;
      version: string;
      title: string;
      platform: string;
      region: string;
      sourceUrl: string;
      sourceStatus: "internal_master";
      checkedAt: string;
      filenamePrefix: string;
      video: {
        width: number;
        height: number;
        videoCodec: string;
        audioCodec: string;
      };
      duration: {
        status: "manual";
        note: string;
      };
      subtitleSafeZone: {
        bottomMarginPx: number;
        note: string;
      };
      requiredListingFields: string[];
      manualFields: string[];
    };
    variant: {
      label: string;
      title: string;
      description: string;
      tags: string[];
      coverAssetId?: string;
      source?: "manual" | "ai_draft";
      id: string;
      projectId: string;
      adaptationId: string;
      version: number;
      versionNumber: number;
      createdAt: string;
      updatedAt: string;
      status: "candidate" | "adopted" | "archived";
      contentFingerprint: string;
      projectVersion: number;
      adaptationVersion: number;
      headRevision: number;
      adoptionVerified: boolean;
    };
    cover?: {
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
  };
};

/** Query of `delivery/platformRecoverRequest` (`platform-delivery.recoverRequest`). */
export type PlatformRecoverRequestQuery = {
  projectId: string;
};

/** Answer of `delivery/platformRecoverRequest` (`platform-delivery.recoverRequest`). */
export type PlatformRecoverRequestResult =
  | {
      requestKey: string;
      projectId: string;
      aggregateId: string;
      requestHash: string;
      createdAt: string;
      operation: "adopt";
      input: {
        projectId: string;
        adaptationId: string;
        projectVersion: number;
        adaptationVersion: number;
        variantVersion: number;
        contentFingerprint: string;
        expectedHeadRevision: number;
      };
      result: {
        label: string;
        title: string;
        description: string;
        tags: string[];
        coverAssetId?: string;
        source?: "manual" | "ai_draft";
        id: string;
        projectId: string;
        adaptationId: string;
        version: number;
        versionNumber: number;
        createdAt: string;
        updatedAt: string;
        status: "candidate" | "adopted" | "archived";
        contentFingerprint: string;
        projectVersion: number;
        adaptationVersion: number;
        headRevision: number;
        adoptionVerified: boolean;
      };
    }
  | {
      requestKey: string;
      projectId: string;
      aggregateId: string;
      requestHash: string;
      createdAt: string;
      operation: "archive";
      input: {
        projectId: string;
        profileId: string;
        creativeVariantId: string;
        manualFieldsConfirmed: boolean;
        sourceFingerprint: string;
      };
      result: {
        scope: "submission-metadata-only";
        releaseReady: false;
        unknowns: [
          "CONTENT_QUALITY_UNVERIFIED",
          "LEGAL_RIGHTS_UNVERIFIED",
          "SETTLEMENT_UNKNOWN",
          "CURRENT_FILES_NOT_READ",
          "PLATFORM_RULES_NOT_VERIFIED",
        ];
        id: string;
        projectId: string;
        adaptationId: string;
        episodeId: string;
        profileId: string;
        profileVersion: string;
        creativeVariantId: string;
        deliveryVersion: number;
        sourceFingerprint: string;
        createdAt: string;
        preflight: {
          scope: "submission-metadata-only";
          releaseReady: false;
          unknowns: [
            "CONTENT_QUALITY_UNVERIFIED",
            "LEGAL_RIGHTS_UNVERIFIED",
            "SETTLEMENT_UNKNOWN",
            "CURRENT_FILES_NOT_READ",
            "PLATFORM_RULES_NOT_VERIFIED",
          ];
          episodeId: string;
          input: {
            projectId: string;
            profileId: string;
            creativeVariantId: string;
            manualFieldsConfirmed: boolean;
          };
          ok: boolean;
          profile?: {
            id: string;
            version: string;
            title: string;
            platform: string;
            region: string;
            sourceUrl: string;
            sourceStatus: "internal_master";
            checkedAt: string;
            filenamePrefix: string;
            video: {
              width: number;
              height: number;
              videoCodec: string;
              audioCodec: string;
            };
            duration: {
              status: "manual";
              note: string;
            };
            subtitleSafeZone: {
              bottomMarginPx: number;
              note: string;
            };
            requiredListingFields: string[];
            manualFields: string[];
          };
          blockers: string[];
          warnings: string[];
          expectedFiles: string[];
          finalBaseName: string;
          sourceFingerprint: string;
          snapshot?: {
            project: {
              id: string;
              version: number;
              fingerprint: string;
            };
            adaptation: {
              id: string;
              version: number;
              fingerprint: string;
            };
            episode: {
              id: string;
              version: number;
              fingerprint: string;
            };
            profile: {
              id: string;
              version: string;
              title: string;
              platform: string;
              region: string;
              sourceUrl: string;
              sourceStatus: "internal_master";
              checkedAt: string;
              filenamePrefix: string;
              video: {
                width: number;
                height: number;
                videoCodec: string;
                audioCodec: string;
              };
              duration: {
                status: "manual";
                note: string;
              };
              subtitleSafeZone: {
                bottomMarginPx: number;
                note: string;
              };
              requiredListingFields: string[];
              manualFields: string[];
            };
            variant: {
              label: string;
              title: string;
              description: string;
              tags: string[];
              coverAssetId?: string;
              source?: "manual" | "ai_draft";
              id: string;
              projectId: string;
              adaptationId: string;
              version: number;
              versionNumber: number;
              createdAt: string;
              updatedAt: string;
              status: "candidate" | "adopted" | "archived";
              contentFingerprint: string;
              projectVersion: number;
              adaptationVersion: number;
              headRevision: number;
              adoptionVerified: boolean;
            };
            cover?: {
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
                  "image" | "audio" | "video" | "subtitle" | "project-package";
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
          };
        };
      };
    };
