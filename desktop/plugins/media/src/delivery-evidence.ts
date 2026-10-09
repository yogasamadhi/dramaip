import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  MediaByteVerificationSchema,
  MediaDeliveryEvidenceSchema,
  MediaDeliveryEvidenceQuerySchema,
  mediaDeclarationStatus,
  type MediaDeliveryEvidence,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  type PluginContext,
} from "@dramaip/plugin-api/internal";

class EvidenceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Only Media tables and public owner services. No Host, files, models, writes or latest-version substitution. */
export function createMediaDeliveryEvidence(
  context: PluginContext,
  records: MediaRecordService,
  workspace: WorkspaceProjectService,
) {
  const read = (
    id: string,
    projectId: string,
    recordVersion: number,
  ): MediaDeliveryEvidence => {
    const record = records.get(id);
    if (!workspace.get(projectId) || !record || record.projectId !== projectId)
      throw new EvidenceError(404, "NOT_FOUND");
    if (record.version !== recordVersion)
      throw new EvidenceError(412, "MEDIA_EVIDENCE_VERSION_CHANGED");
    const source = records.sourceStatus(id);
    if (!source) throw new EvidenceError(503, "MEDIA_EVIDENCE_UNAVAILABLE");
    const archive = records.archivedArtifact(id, projectId, recordVersion);
    const row = context.uow.execute((tx) =>
      tx.get<{
        id: string;
        request_hash: string;
        verified_at: string;
        value_json: string;
      }>(
        "SELECT id,request_hash,verified_at,value_json FROM media_byte_verifications WHERE project_id=? AND record_id=? AND record_version=? ORDER BY verified_at DESC,id DESC LIMIT 1",
        projectId,
        id,
        recordVersion,
      ),
    );
    let latestByteRead: MediaDeliveryEvidence["latestByteRead"];
    if (row) {
      const original = MediaByteVerificationSchema.parse(
          JSON.parse(row.value_json),
        ),
        descriptor = original.descriptor;
      if (
        original.id !== row.id ||
        original.verifiedAt !== row.verified_at ||
        descriptor.recordId !== id ||
        descriptor.projectId !== projectId ||
        descriptor.recordVersion !== recordVersion ||
        hash({ descriptor }) !== row.request_hash
      )
        throw new EvidenceError(503, "MEDIA_EVIDENCE_INVALID");
      const matches =
        archive &&
        descriptor.origin === "managed-archive" &&
        descriptor.artifactRef === archive.artifactId &&
        descriptor.sha256 === archive.sha256 &&
        descriptor.sizeBytes === archive.sizeBytes &&
        descriptor.mimeType === archive.mimeType &&
        descriptor.kind === archive.kind;
      latestByteRead = {
        id: original.id,
        verifiedAt: original.verifiedAt,
        descriptor,
        evidence: original.evidence,
        currentArchiveBinding:
          archive && descriptor.origin === "managed-archive"
            ? matches
              ? "matching-archive-metadata"
              : "changed-archive-metadata"
            : "not-rechecked",
      };
    }
    const declarations = mediaDeclarationStatus(record.payload, record.kind);
    const result = MediaDeliveryEvidenceSchema.parse({
      recordId: id,
      projectId,
      recordVersion,
      kind: record.kind,
      scope: "exact-media-record-metadata",
      releaseReady: false,
      qualityState: "unverified",
      settlementState: "unknown",
      currentFileIntegrity: "not-read",
      declarations,
      source,
      ...(archive ? { archive } : {}),
      ...(latestByteRead ? { latestByteRead } : {}),
      blockers: [
        ...(declarations.rightsStatus === "restricted"
          ? ["DECLARED_RIGHTS_RESTRICTED"]
          : []),
        ...(declarations.providerStatus === "unavailable"
          ? ["DECLARED_PROVIDER_UNAVAILABLE"]
          : []),
        ...(source.state === "stale" ? ["SOURCE_STALE"] : []),
        ...(source.state === "unverified" ? ["SOURCE_UNVERIFIED"] : []),
        ...(!archive ? ["ARCHIVE_UNAVAILABLE"] : []),
      ],
      unknowns: [
        "CONTENT_QUALITY_UNVERIFIED",
        "LEGAL_RIGHTS_UNVERIFIED",
        "SETTLEMENT_UNKNOWN",
        "CURRENT_FILE_NOT_READ",
      ],
    });
    const final = records.get(id);
    if (!final || hash(final) !== hash(record))
      throw new EvidenceError(412, "MEDIA_EVIDENCE_VERSION_CHANGED");
    return result;
  };
  const route = defineRouteContribution({
    id: "media:delivery-evidence",
    pluginId: "media",
    method: "get",
    path: "/api/v2/media-records/{id}/delivery-evidence",
    operationId: "media.deliveryEvidence",
    policy: { idempotency: "forbidden" },
    declaration: createRoute({
      method: "get",
      path: "/api/v2/media-records/{id}/delivery-evidence",
      operationId: "media.deliveryEvidence",
      request: {
        params: z.object({ id: z.string().uuid() }),
        query: MediaDeliveryEvidenceQuerySchema,
      },
      responses: {
        200: {
          description:
            "Exact Media metadata only, never legal/quality/settlement or current byte approval",
          content: {
            "application/json": { schema: MediaDeliveryEvidenceSchema },
          },
        },
        ...Object.fromEntries(
          [400, 404, 412, 503].map((status) => [
            status,
            {
              description: "Exact owner evidence unavailable",
              content: {
                "application/problem+json": { schema: ProblemDetailsSchema },
              },
            },
          ]),
        ),
      },
    } as never),
    handler: (c: {
      req: {
        param(name: string): string;
        query(): Record<string, string>;
        queries(): Record<string, string[]>;
      };
      header(name: string, value: string): void;
      json(value: unknown, status?: number): Response;
    }) => {
      try {
        const raw = c.req.query();
        if (!/^(?:0|[1-9]\d*)$/u.test(raw.recordVersion ?? ""))
          throw new EvidenceError(400, "VALIDATION_ERROR");
        const q = MediaDeliveryEvidenceQuerySchema.parse(raw);
        if (
          Object.values(c.req.queries()).some((values) => values.length !== 1)
        )
          throw new EvidenceError(400, "VALIDATION_ERROR");
        let value: MediaDeliveryEvidence;
        try {
          value = read(c.req.param("id"), q.projectId, q.recordVersion);
        } catch (error) {
          if (error instanceof EvidenceError) throw error;
          throw new EvidenceError(503, "MEDIA_EVIDENCE_UNAVAILABLE");
        }
        c.header("Cache-Control", "no-store");
        c.header("ETag", `"media-delivery-evidence:${hash(value)}"`);
        return c.json(value);
      } catch (error) {
        const status =
          error instanceof EvidenceError
            ? error.status
            : error instanceof z.ZodError
              ? 400
              : 503;
        return new Response(
          JSON.stringify({
            type: "about:blank",
            title: "原素材交付证据未能完整核对，不使用旧结果或最新版本替代。",
            status,
            code:
              error instanceof EvidenceError
                ? error.code
                : status === 400
                  ? "VALIDATION_ERROR"
                  : "MEDIA_EVIDENCE_UNAVAILABLE",
            traceId: crypto.randomUUID(),
          }),
          {
            status,
            headers: {
              "Content-Type": "application/problem+json",
              "Cache-Control": "no-store",
            },
          },
        );
      }
    },
  });
  return { read, route };
}
