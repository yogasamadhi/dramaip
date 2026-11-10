import type { ApiError } from "@dramaip/contracts/product";

export class StudioClientError extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.name = "StudioClientError";
    this.status = status;
    this.body = body;
  }
}

export function asApiError(value: unknown): ApiError {
  const source = value as Partial<ApiError> & {
    title?: string;
    detail?: string;
    traceId?: string;
  };
  return {
    code: source.code ?? "INTERNAL_ERROR",
    message: source.message ?? source.detail ?? source.title ?? "请求失败",
    requestId: source.requestId ?? source.traceId ?? crypto.randomUUID(),
    ...(source.details === undefined ? {} : { details: source.details }),
  };
}
