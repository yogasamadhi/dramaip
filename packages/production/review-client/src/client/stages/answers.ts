/**
 * The shapes of the review answers the Remote types only as JSON values;
 * the stages read them as the review routes answer them.
 */

/** A versioned offline compliance rule profile: local evidence, not legal advice. */
export interface ComplianceProfile {
  id: string;
  version: string;
  title: string;
  sourceStatus: "official" | "consultation" | "platform_guidance" | "unknown";
  publishedAt: string;
  regions: string[];
  integrityStatus: "verified" | "unchecked" | "invalid";
  active: boolean;
}

/** The compliance preflight of one episode. */
export interface CompliancePreflight {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  visibleLabel?: string;
  sourceFingerprint: string;
}

/** What an offline review import took in. */
export interface OfflineImport {
  packageId: string;
  commentCount: number;
  decisionCount: number;
}

/** A cloud review platform's binding of one package. */
export interface CloudBinding {
  shareUrl: string;
  status: string;
  expiresAt: string;
}

/** The hashed publish preview of a cloud review, before any upload. */
export interface CloudPreview {
  workspaceId: string;
  manifestJson: string;
  media: Array<{
    id: string;
    relativePath: string;
    sizeBytes: number;
    sha256: string;
  }>;
  storageBytes: number;
  maxStorageBytes: number;
  retention: string;
  costEstimate: string;
}

/** A published cloud review. */
export interface CloudPublished {
  shareUrl: string;
  expiresAt: string;
}

/** What one cursor sync took in. */
export interface CloudSynced {
  commentCount: number;
  decisionCount: number;
}

/** A deleted cloud review. */
export interface CloudDeleted {
  localFeedbackPreserved: boolean;
}
