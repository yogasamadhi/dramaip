import { createHash } from "node:crypto";

import type { UnitOfWork } from "@dramaip/plugin-api";

import { ApiProblem, requireIdempotencyKey } from "./problem.ts";

interface StoredResponse {
  request_hash: string;
  response_status: number;
  response_headers_json: string;
  response_body: Uint8Array | null;
}

export async function idempotentResponse<T extends Response>(
  uow: UnitOfWork,
  request: Request,
  scope: string,
  requestBody: unknown,
  execute: () => Promise<T>,
): Promise<T> {
  const key = requireIdempotencyKey(request);
  const requestHash = createHash("sha256")
    .update(JSON.stringify(requestBody))
    .digest("hex");
  const existing = uow.execute((tx) =>
    tx.get<StoredResponse>(
      `SELECT request_hash, response_status, response_headers_json, response_body
         FROM idempotency_records
        WHERE scope = ? AND idempotency_key = ?`,
      scope,
      key,
    ),
  );
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ApiProblem(
        409,
        "IDEMPOTENCY_CONFLICT",
        "this Idempotency-Key was used with another request body",
      );
    }
    const responseBody = existing.response_body
      ? Uint8Array.from(existing.response_body)
      : null;
    return new Response(responseBody, {
      status: existing.response_status,
      headers: JSON.parse(existing.response_headers_json) as Record<
        string,
        string
      >,
    }) as T;
  }

  const response = await execute();
  const body = new Uint8Array(await response.clone().arrayBuffer());
  const headers = Object.fromEntries(response.headers.entries());
  try {
    uow.execute((tx) => {
      tx.run(
        `INSERT INTO idempotency_records
         (scope, idempotency_key, request_hash, response_status, response_headers_json, response_body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        scope,
        key,
        requestHash,
        response.status,
        JSON.stringify(headers),
        body,
        new Date().toISOString(),
      );
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("UNIQUE"))
      throw error;
    return idempotentResponse(uow, request, scope, requestBody, execute);
  }
  return response;
}
