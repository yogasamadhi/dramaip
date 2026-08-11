import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-24/cloud-review-contract.json"),
    "utf8",
  ),
) as { version: number; guarantees: string[]; media: { mimeType: string } };

test("LM6-24 将最小上传、凭据隔离和 client cursor 回流固定为跨栈契约", () => {
  const schema = readFileSync(
    join(root, "packages/schema/src/index.ts"),
    "utf8",
  );
  const protocol = readFileSync(
    join(root, "packages/protocol/src/index.ts"),
    "utf8",
  );
  const database = readFileSync(
    join(root, "packages/db/src/operational-schema.ts"),
    "utf8",
  );
  const gateway = readFileSync(
    join(root, "packages/server/src/cloud-review.ts"),
    "utf8",
  );
  const server = readFileSync(
    join(root, "packages/server/src/sidecar.ts"),
    "utf8",
  );
  const app = readFileSync(join(root, "packages/app/src/main.tsx"), "utf8");
  const nodeContract = readFileSync(
    join(root, "packages/server/src/sidecar.node.test.ts"),
    "utf8",
  );
  const electron = readFileSync(
    join(root, "tests/electron/lm6-24.spec.ts"),
    "utf8",
  );
  const guide = readFileSync(join(root, "docs/product/USER_GUIDE.md"), "utf8");

  expect(fixture.version).toBe(1);
  expect(fixture.media.mimeType).toBe("video/mp4");
  expect(fixture.guarantees).toContain("no-bearer-to-object-storage");
  expect(schema).toContain("CloudReviewPublishInput");
  expect(protocol).toContain("cloud-publish");
  expect(database).toContain("cloud_review_connections");
  expect(database).toContain("cloud_review_events");
  expect(gateway).toContain("bearer token is deliberately never forwarded");
  expect(server).toContain("cloudReviewSelectedMedia");
  expect(server).toContain("upsertCloudReviewEvent");
  expect(app).toContain("发布清单（确认后才会上传）");
  expect(app).toContain("按游标同步意见");
  expect(nodeContract).toContain("cloudReviewObjectAuthorization");
  expect(electron).toContain("可选云审片");
  expect(guide).toContain("可选云审片");
});
