import {
  createHash,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signCanonical(value: unknown, privateKeyPem: string): string {
  return signBytes(
    null,
    Buffer.from(canonicalJson(value)),
    privateKeyPem,
  ).toString("base64");
}

export function verifyCanonical(
  value: unknown,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    return verifyBytes(
      null,
      Buffer.from(canonicalJson(value)),
      publicKeyPem,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
