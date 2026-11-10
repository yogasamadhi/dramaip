import { z } from "zod";

export const CapabilityStateSchema = z.enum([
  "unavailable",
  "experimental",
  "verified",
]);
export type CapabilityState = z.infer<typeof CapabilityStateSchema>;

export const CapabilityEvidenceSchema = z.object({
  id: z.string().min(1).max(200),
  verifiedAt: z.string().datetime(),
  environment: z.string().min(1).max(240),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type CapabilityEvidence = z.infer<typeof CapabilityEvidenceSchema>;

export const CapabilityDescriptorSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u),
    state: CapabilityStateSchema,
    version: z.string().min(1),
    evidence: CapabilityEvidenceSchema.optional(),
    limitations: z.array(z.string().min(1).max(500)).default([]),
    requiredHostCapabilities: z.array(z.string().min(1)).default([]),
    requiredProviderCapabilities: z.array(z.string().min(1)).default([]),
  })
  .superRefine((descriptor, context) => {
    if (descriptor.state === "verified" && !descriptor.evidence) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "verified capabilities require immutable evidence",
      });
    }
    if (descriptor.state !== "verified" && descriptor.evidence) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "only verified capabilities may publish evidence",
      });
    }
  });
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;

export function defineCapabilityDescriptor(
  input: z.input<typeof CapabilityDescriptorSchema>,
): CapabilityDescriptor {
  return Object.freeze(CapabilityDescriptorSchema.parse(input));
}
