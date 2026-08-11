import { expect, test } from "bun:test";
import { createCloudReviewGateway } from "./cloud-review";

const envelope = (data: unknown) =>
  new Response(JSON.stringify({ code: "OK", message: "ok", data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

test("cloud review adapter uploads only selected media, then returns cursor-safe feedback", async () => {
  const requests: Array<{
    url: string;
    authorization?: string;
    method?: string;
  }> = [];
  const gateway = createCloudReviewGateway({
    baseUrl: "https://review.example.test",
    getAccessToken: async () => "short-lived-token",
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        authorization: headers.get("authorization") ?? undefined,
        method: init?.method,
      });
      if (url === "https://review.example.test/api/v1/review-packages")
        return envelope({
          package: {
            id: "remote-review-1",
            status: "uploading",
            syncCursor: 0,
            expiresAt: "2026-08-30T00:00:00.000Z",
          },
          shareToken: "share-token-only-returned-on-create",
          uploadTargets: [
            {
              mediaId: "clip-1",
              method: "PUT",
              url: "https://object.example.test/presigned-upload",
              requiredHeaders: [{ name: "x-checksum", value: "abc" }],
            },
          ],
        });
      if (url === "https://object.example.test/presigned-upload")
        return new Response(null, { status: 200 });
      if (url.endsWith("/complete"))
        return envelope({
          id: "remote-review-1",
          status: "published",
          syncCursor: 0,
          expiresAt: "2026-08-30T00:00:00.000Z",
        });
      if (url.includes("/sync?afterCursor=0"))
        return envelope({
          nextCursor: 2,
          comments: [
            {
              id: "comment-1",
              packageId: "remote-review-1",
              clientId: "member-comment-1",
              shotId: "shot-1",
              timecodeSeconds: 1.25,
              authorAlias: "成员甲",
              body: "加强停留。",
              resolved: false,
              cursor: 1,
              createdAt: "2026-08-12T00:00:00.000Z",
              updatedAt: "2026-08-12T00:00:00.000Z",
            },
          ],
          decisions: [
            {
              id: "decision-1",
              packageId: "remote-review-1",
              clientId: "guest-decision-1",
              shotId: "shot-1",
              decision: "request_changes",
              authorAlias: "访客乙",
              note: "补一个反应镜头。",
              cursor: 2,
              createdAt: "2026-08-12T00:00:01.000Z",
            },
          ],
        });
      throw new Error(`unexpected request ${url}`);
    },
  });

  const published = await gateway.publish({
    desktopPackageId: "desktop-review-1",
    title: "第 1 集审片",
    manifestJson: JSON.stringify({
      format: "dramaip-review",
      version: 1,
      workspaceId: "workspace-1",
      packageId: "desktop-review-1",
      media: [{ id: "clip-1" }],
    }),
    media: [
      {
        id: "clip-1",
        relativePath: "episode-1/clip-1.mp4",
        mimeType: "video/mp4",
        sizeBytes: 3,
        sha256: "a".repeat(64),
        bytes: new Uint8Array([1, 2, 3]),
      },
    ],
  });
  expect(published.status).toBe("published");
  expect(published.shareToken).toBe("share-token-only-returned-on-create");

  const synced = await gateway.sync(published.packageId, 0);
  expect(synced.nextCursor).toBe(2);
  expect(synced.comments[0]?.clientId).toBe("member-comment-1");
  expect(synced.decisions[0]?.clientId).toBe("guest-decision-1");
  expect(
    requests.find((item) => item.url.includes("object.example"))?.authorization,
  ).toBeUndefined();
  expect(
    requests
      .filter((item) => item.url.includes("review.example"))
      .every((item) => item.authorization === "Bearer short-lived-token"),
  ).toBe(true);
});

test("cloud review adapter rejects secret-bearing manifests before network access", async () => {
  const gateway = createCloudReviewGateway({
    baseUrl: "https://review.example.test",
    getAccessToken: async () => "short-lived-token",
    fetch: async () => {
      throw new Error("network must not be reached");
    },
  });
  await expect(
    gateway.publish({
      desktopPackageId: "desktop-review-2",
      title: "不安全的审片包",
      manifestJson: JSON.stringify({
        workspaceId: "workspace-1",
        accessToken: "never-upload",
      }),
      media: [
        {
          id: "clip-2",
          relativePath: "clip-2.mp4",
          mimeType: "video/mp4",
          sizeBytes: 1,
          sha256: "b".repeat(64),
          bytes: new Uint8Array([1]),
        },
      ],
    }),
  ).rejects.toThrow("secret-bearing");
});
