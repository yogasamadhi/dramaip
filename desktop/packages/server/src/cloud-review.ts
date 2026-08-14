/**
 * Minimal, renderer-free adapter for the platform review service.
 *
 * The renderer never owns a platform token. Callers resolve a short-lived token
 * from the local credential vault immediately before invoking this adapter. Media
 * bytes are sent only to the presigned upload URLs returned by the platform; the
 * bearer token is deliberately never forwarded to object storage.
 */
export type CloudReviewMedia = {
  id: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
};

export type CloudReviewComment = {
  id: string;
  packageId: string;
  clientId: string;
  shotId: string;
  timecodeSeconds: number;
  authorAlias: string;
  body: string;
  resolved: boolean;
  cursor: number;
  createdAt: string;
  updatedAt: string;
};

export type CloudReviewDecision = {
  id: string;
  packageId: string;
  clientId: string;
  shotId: string;
  decision: "approve" | "return" | "request_changes" | "note";
  authorAlias: string;
  note: string;
  cursor: number;
  createdAt: string;
};

export type CloudReviewSync = {
  nextCursor: number;
  comments: CloudReviewComment[];
  decisions: CloudReviewDecision[];
};

export type CloudReviewGateway = {
  publish(input: {
    desktopPackageId: string;
    title: string;
    manifestJson: string;
    pin?: string;
    media: CloudReviewMedia[];
  }): Promise<{
    packageId: string;
    shareToken: string;
    status: string;
    syncCursor: number;
    expiresAt: string;
  }>;
  sync(packageId: string, afterCursor: number): Promise<CloudReviewSync>;
  delete(packageId: string): Promise<{ packageId: string; status: string }>;
};

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createCloudReviewGateway(input: {
  baseUrl: string;
  getAccessToken: () => Promise<string | undefined>;
  fetch?: FetchLike;
}): CloudReviewGateway {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const request = input.fetch ?? fetch;

  const platformRequest = async <T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> => {
    const token = await input.getAccessToken();
    if (!token?.trim())
      throw new Error("Cloud review credential is unavailable");
    const response = await request(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const payload = await jsonRecord(response);
    if (!response.ok || payload.code !== "OK" || !("data" in payload))
      throw new Error(`Cloud review request failed (${response.status})`);
    return payload.data as T;
  };

  return {
    async publish(publishInput) {
      assertPublishInput(publishInput);
      const created = await platformRequest<CreatedPackage>(
        "/api/v1/review-packages",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId: readManifestWorkspace(publishInput.manifestJson),
            desktopPackageId: publishInput.desktopPackageId,
            title: publishInput.title,
            manifestJson: publishInput.manifestJson,
            ...(publishInput.pin ? { pin: publishInput.pin } : {}),
            media: publishInput.media.map(mediaDeclaration),
          }),
        },
      );
      const targets = new Map(
        created.uploadTargets.map((target) => [target.mediaId, target]),
      );
      if (
        targets.size !== publishInput.media.length ||
        publishInput.media.some((media) => !targets.has(media.id))
      ) {
        await deleteAfterFailedPublish(platformRequest, created.package.id);
        throw new Error("Cloud review upload target mismatch");
      }
      try {
        for (const media of publishInput.media) {
          const target = targets.get(media.id)!;
          const upload = await request(target.url, {
            method: target.method,
            headers: Object.fromEntries(
              target.requiredHeaders.map((header) => [
                header.name,
                header.value,
              ]),
            ),
            body: Buffer.from(media.bytes),
          });
          if (!upload.ok)
            throw new Error(`Cloud review upload failed (${upload.status})`);
        }
        const completed = await platformRequest<PlatformPackage>(
          `/api/v1/review-packages/${encodeURIComponent(created.package.id)}/complete`,
          { method: "POST" },
        );
        return {
          packageId: completed.id,
          shareToken: created.shareToken,
          status: completed.status,
          syncCursor: completed.syncCursor,
          expiresAt: completed.expiresAt,
        };
      } catch (error) {
        await deleteAfterFailedPublish(platformRequest, created.package.id);
        throw error;
      }
    },
    async sync(packageId, afterCursor) {
      if (
        !packageId.trim() ||
        !Number.isSafeInteger(afterCursor) ||
        afterCursor < 0
      )
        throw new Error("Invalid cloud review sync cursor");
      const result = await platformRequest<PlatformSync>(
        `/api/v1/review-packages/${encodeURIComponent(packageId)}/sync?afterCursor=${afterCursor}`,
      );
      return {
        nextCursor: result.nextCursor,
        comments: result.comments.map(commentFromPlatform),
        decisions: result.decisions.map(decisionFromPlatform),
      };
    },
    async delete(packageId) {
      if (!packageId.trim())
        throw new Error("Cloud review package is required");
      const deleted = await platformRequest<PlatformDeleted>(
        `/api/v1/review-packages/${encodeURIComponent(packageId)}`,
        { method: "DELETE" },
      );
      return { packageId: deleted.packageId, status: deleted.status };
    },
  };
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password
  )
    throw new Error("Cloud review base URL is invalid");
  return url.toString().replace(/\/$/, "");
}

function readManifestWorkspace(manifestJson: string): string {
  const manifest = JSON.parse(manifestJson) as JsonRecord;
  const workspaceId = manifest.workspaceId;
  if (typeof workspaceId !== "string" || !workspaceId.trim())
    throw new Error("Cloud review manifest must name a workspace");
  return workspaceId.trim();
}

function assertPublishInput(input: {
  desktopPackageId: string;
  title: string;
  manifestJson: string;
  media: CloudReviewMedia[];
}): void {
  if (
    !input.desktopPackageId.trim() ||
    !input.title.trim() ||
    !input.media.length
  )
    throw new Error("Cloud review publish input is incomplete");
  if (
    input.media.some(
      (media) =>
        !media.id ||
        !media.relativePath ||
        !media.mimeType ||
        media.sizeBytes !== media.bytes.byteLength,
    )
  )
    throw new Error("Cloud review media declaration is invalid");
  // Reject a manifest that accidentally contains a secret-bearing key before it
  // can leave the local machine. This is intentionally stricter than the API.
  if (
    /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)/i.test(
      input.manifestJson,
    )
  )
    throw new Error("Cloud review manifest contains a secret-bearing field");
}

async function deleteAfterFailedPublish(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
  packageId: string,
): Promise<void> {
  await request(`/api/v1/review-packages/${encodeURIComponent(packageId)}`, {
    method: "DELETE",
  }).catch(() => undefined);
}

async function jsonRecord(response: Response): Promise<JsonRecord> {
  const value: unknown = await response.json().catch(() => undefined);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function mediaDeclaration(media: CloudReviewMedia) {
  return {
    id: media.id,
    relativePath: media.relativePath,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    sha256: media.sha256,
  };
}

type PlatformPackage = {
  id: string;
  status: string;
  syncCursor: number;
  expiresAt: string;
};
type CreatedPackage = {
  package: PlatformPackage;
  shareToken: string;
  uploadTargets: Array<{
    mediaId: string;
    method: string;
    url: string;
    requiredHeaders: Array<{ name: string; value: string }>;
  }>;
};
type PlatformSync = {
  nextCursor: number;
  comments: Array<{
    id: string;
    packageId: string;
    clientId: string;
    shotId: string;
    timecodeSeconds: number;
    authorAlias: string;
    body: string;
    resolved: boolean;
    cursor: number;
    createdAt: string;
    updatedAt: string;
  }>;
  decisions: Array<{
    id: string;
    packageId: string;
    clientId: string;
    shotId: string;
    decision: "approve" | "return" | "request_changes" | "note";
    authorAlias: string;
    note: string;
    cursor: number;
    createdAt: string;
  }>;
};
type PlatformDeleted = { packageId: string; status: string };

function commentFromPlatform(
  comment: PlatformSync["comments"][number],
): CloudReviewComment {
  return { ...comment };
}

function decisionFromPlatform(
  decision: PlatformSync["decisions"][number],
): CloudReviewDecision {
  return { ...decision };
}
