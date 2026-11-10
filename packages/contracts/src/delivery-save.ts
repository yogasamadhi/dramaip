import { z } from "zod";
export const ManuscriptRightsSchema = z
  .object({
    basis: z.enum(["original", "authorized", "public-domain"]),
    note: z.string().trim().max(2_000),
    confirmed: z.literal(true),
  })
  .strict();
export const ManuscriptReceiptSchema = z.object({
  artifactRef: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  byteSize: z.number().int().nonnegative(),
  savedAt: z.string().datetime(),
});
