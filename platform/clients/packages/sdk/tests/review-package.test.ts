import assert from "node:assert/strict";
import { test } from "vitest"
;

import { createApiClient } from "../src/index";

const checksum = "a".repeat(64);
const packageView = {
  id: "package-1",
  workspaceId: "workspace-1",
  desktopPackageId: "desktop-package-1",
  title: "第 1 集审片",
  status: "published",
  manifestJson: '{"format":"dramaip-review"}',
  storageBytes: 12,
  syncCursor: 2,
  expiresAt: "2026-08-13T00:00:00Z",
  createdAt: "2026-08-12T00:00:00Z",
  media: [
    {
      id: "media-1",
      relativePath: "media/shot-1.mp4",
      mimeType: "video/mp4",
      sizeBytes: 12,
      sha256: checksum,
      status: "complete",
    },
  ],
};

test("uses the existing protected review-package endpoints with normalized desktop shapes", async () => {
  const client = createApiClient({
    baseURL: "http://example.test",
    getAccessToken: () => "access-token",
  });
  const calls: Array<{
    method?: string;
    url?: string;
    data?: unknown;
    params?: unknown;
  }> = [];
  client.http.defaults.adapter = async (config) => {
    calls.push({
      method: config.method,
      url: config.url,
      data: config.data,
      params: config.params,
    });
    const url = config.url ?? "";
    let data: unknown;
    if (url === "/api/v1/review-packages")
      data = {
        package: { ...packageView, status: "uploading" },
        shareToken: "share-token",
        uploadTargets: [
          {
            mediaId: "media-1",
            method: "PUT",
            url: "https://storage.example.test/upload",
            requiredHeaders: [],
            expiresAt: "2026-08-12T01:00:00Z",
          },
        ],
      };
    else if (url.endsWith("/upload-target"))
      data = {
        mediaId: "media-1",
        method: "PUT",
        url: "https://storage.example.test/upload-refresh",
        requiredHeaders: [],
        expiresAt: "2026-08-12T01:00:00Z",
      };
    else if (url.endsWith("/complete")) data = packageView;
    else if (url.endsWith("/sync"))
      data = {
        nextCursor: 2,
        comments: [
          {
            id: "comment-1",
            packageId: "package-1",
            clientId: "comment-client",
            shotId: "shot-1",
            timecodeSeconds: 1.25,
            authorAlias: "成员",
            body: "请调整节奏",
            resolved: false,
            cursor: 1,
            createdAt: "2026-08-12T00:00:00Z",
            updatedAt: "2026-08-12T00:00:00Z",
          },
        ],
        decisions: [
          {
            id: "decision-1",
            packageId: "package-1",
            clientId: "decision-client",
            shotId: "shot-1",
            decision: "request_changes",
            authorAlias: "管理员",
            note: "返修",
            cursor: 2,
            createdAt: "2026-08-12T00:00:01Z",
          },
        ],
      };
    else if (config.method === "delete")
      data = { packageId: "package-1", status: "deleted" };
    else throw new Error(`unexpected request ${config.method} ${url}`);
    return {
      data: {
        code: "OK",
        message: "OK",
        data,
        requestId: "request-1",
        traceId: "trace-1",
      },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };

  const created = await client.createReviewPackage({
    workspace_id: "workspace-1",
    desktop_package_id: "desktop-package-1",
    title: "第 1 集审片",
    manifest_json: '{"format":"dramaip-review"}',
    media: [
      {
        id: "media-1",
        relative_path: "media/shot-1.mp4",
        mime_type: "video/mp4",
        size_bytes: 12,
        sha256: checksum,
      },
    ],
  });
  assert.equal(created.share_token, "share-token");
  assert.equal(created.package.desktop_package_id, "desktop-package-1");
  assert.equal(JSON.parse(String(calls[0]?.data)).workspaceId, "workspace-1");
  const complete = await client.completeReviewPackage("package-1");
  assert.equal(complete.status, "published");
  const sync = await client.syncReviewPackage("package-1", 0);
  assert.equal(sync.comments[0]?.timecode_seconds, 1.25);
  assert.equal(sync.decisions[0]?.decision, "request_changes");
  const deleted = await client.deleteReviewPackage("package-1");
  assert.equal(deleted.status, "deleted");
  assert.ok(
    calls.some(
      (call) =>
        call.url?.endsWith("/sync") &&
        JSON.stringify(call.params).includes("afterCursor"),
    ),
  );
});
