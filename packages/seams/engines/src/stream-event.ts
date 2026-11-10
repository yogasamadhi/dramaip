/**
 * The projection of a sidecar's raw run events onto the Host stream event
 * vocabulary. Only the known event kinds pass; web-research tool payloads are
 * trimmed to the bounded detail the conversation view renders.
 */

import { normalizeAgentUsage, type JsonValue } from "@dramaip/contracts";
import type { HostEngineStreamEvent } from "@dramaip/host-contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function structuredToolValue(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.structuredContent)) return value.structuredContent;
  const content = Array.isArray(value.content) ? value.content : [];
  for (const item of content) {
    if (!isRecord(item) || typeof item.text !== "string") continue;
    try {
      const parsed = JSON.parse(item.text) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Non-JSON tool text is intentionally not projected into Runtime state.
    }
  }
  return value;
}

function webToolDetail(value: Record<string, unknown>): JsonValue | undefined {
  if (value.tool !== "dramaip_curl") return undefined;
  if (value.status === "started") {
    const args = isRecord(value.arguments) ? value.arguments : {};
    return {
      arguments: {
        ...(typeof args.url === "string"
          ? { url: args.url.slice(0, 4000) }
          : {}),
        ...(typeof args.maxCharacters === "number"
          ? { maxCharacters: args.maxCharacters }
          : {}),
      },
    };
  }
  if (typeof value.error === "string")
    return { error: value.error.slice(0, 500) };
  const result = structuredToolValue(value.result);
  if (!result) return undefined;
  return {
    result: {
      ...(typeof result.title === "string"
        ? { title: result.title.slice(0, 500) }
        : {}),
      ...(typeof result.url === "string"
        ? { url: result.url.slice(0, 4000) }
        : {}),
      ...(typeof result.contentType === "string"
        ? { contentType: result.contentType.slice(0, 200) }
        : {}),
      ...(typeof result.retrievedAt === "string"
        ? { retrievedAt: result.retrievedAt }
        : {}),
      ...(typeof result.truncated === "boolean"
        ? { truncated: result.truncated }
        : {}),
    },
  };
}

export function hostEngineStreamEvent(
  value: Record<string, unknown>,
): HostEngineStreamEvent | undefined {
  if (value.type === "activity" && value.activity === "thinking")
    return { type: "activity", activity: "thinking" };
  if (value.type === "content.delta" && typeof value.delta === "string")
    return { type: "content.delta", delta: value.delta };
  if (
    value.type === "tool" &&
    typeof value.tool === "string" &&
    (value.status === "started" ||
      value.status === "completed" ||
      value.status === "failed")
  ) {
    const detail = webToolDetail(value);
    const status = typeof value.error === "string" ? "failed" : value.status;
    return {
      type: "tool",
      status,
      tool: value.tool,
      ...(typeof value.itemId === "string" ? { itemId: value.itemId } : {}),
      ...(detail ? { detail } : {}),
    };
  }
  if (value.type === "usage")
    return {
      type: "usage",
      ...normalizeAgentUsage(value),
    };
  return undefined;
}
