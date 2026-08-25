import { verifyCanonical } from "./crypto.js";
import { ExtensionManifestSchema } from "./manifest.js";
import { z } from "zod";

const RegistryVersionSchema = z
  .object({
    version: z.string(),
    packageUrl: z.string().url(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    size: z
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024),
    manifest: ExtensionManifestSchema,
    publisherPublicKey: z.string().min(1).max(20_000),
  })
  .strict();

const RegistryEntrySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    versions: z.array(RegistryVersionSchema).min(1).max(100),
  })
  .strict();

export const ExtensionRegistryPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    registryId: z.string().regex(/^[a-z][a-z0-9.-]{2,100}$/u),
    generatedAt: z.string().datetime(),
    extensions: z.array(RegistryEntrySchema).max(10_000),
  })
  .strict();

export const SignedExtensionRegistrySchema = z
  .object({
    payload: ExtensionRegistryPayloadSchema,
    keyId: z.string().min(3).max(100),
    signature: z.string().min(40).max(1_000),
  })
  .strict();

export type ExtensionRegistryPayload = z.infer<
  typeof ExtensionRegistryPayloadSchema
>;
export type SignedExtensionRegistry = z.infer<
  typeof SignedExtensionRegistrySchema
>;

export function verifyExtensionRegistry(
  value: unknown,
  input: { readonly keyId: string; readonly publicKeyPem: string },
): ExtensionRegistryPayload {
  const signed = SignedExtensionRegistrySchema.parse(value);
  if (signed.keyId !== input.keyId)
    throw new Error("Extension Registry signing key is not trusted");
  if (!verifyCanonical(signed.payload, signed.signature, input.publicKeyPem))
    throw new Error("Extension Registry signature is invalid");
  const ids = signed.payload.extensions.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Extension Registry contains duplicate extension ids");
  return signed.payload;
}
