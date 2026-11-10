/**
 * Diagnostics redaction: what may cross the Host boundary in a diagnostics
 * report.
 * @module @dramaip/system-system/diagnostics
 */

const SENSITIVE_DIAGNOSTIC_KEY =
  /(?:authorization|password|secret|token|credential|api.?key|prompt|(?:^|_)path$|Path$)/iu;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u;

/** Recursively makes diagnostics safe to cross the Runtime HTTP boundary. */
export function redactDiagnostics(
  value: unknown,
  key = "",
  depth = 0,
): unknown {
  if (SENSITIVE_DIAGNOSTIC_KEY.test(key)) return "[REDACTED]";
  if (depth > 20) return "[MAX_DEPTH]";
  if (typeof value === "string") {
    if (ABSOLUTE_PATH.test(value)) return "[REDACTED_PATH]";
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer [REDACTED]")
      .replace(
        /((?:accessToken|apiKey|credential|secret|password))\s*[:=]\s*[^\s,}]+/giu,
        "$1=[REDACTED]",
      );
  }
  if (Array.isArray(value))
    return value.map((entry) => redactDiagnostics(entry, key, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactDiagnostics(entryValue, entryKey, depth + 1),
      ]),
    );
  return value;
}
