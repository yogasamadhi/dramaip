import { expect, test } from "bun:test";
import { StudioClientError } from "@dramaip/client";
import { isDefiniteCreationStartRejection } from "./creation-request-keys";

const failure = (status: number, code: string) =>
  new StudioClientError(status, {
    code: code as "CONFLICT",
    message: "request failed",
    requestId: crypto.randomUUID(),
  });

test("explicit creation-start validation and domain rejection allow a fresh attempt after correction", () => {
  expect(
    isDefiniteCreationStartRejection(failure(400, "VALIDATION_ERROR")),
  ).toBe(true);
  expect(isDefiniteCreationStartRejection(failure(409, "CONFLICT"))).toBe(true);
});

test("transport, timeout, unknown and idempotency errors retain the original creation request key", () => {
  for (const cause of [
    new Error("network disconnected"),
    { status: 409, body: { code: "CONFLICT" } },
    failure(408, "CONFLICT"),
    failure(429, "CONFLICT"),
    failure(500, "INTERNAL_ERROR"),
    failure(504, "ROUTE_TIMEOUT"),
    failure(409, "IDEMPOTENCY_CONFLICT"),
    failure(409, "INTERNAL_ERROR"),
  ])
    expect(isDefiniteCreationStartRejection(cause)).toBe(false);
});
