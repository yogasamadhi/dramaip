import { describe, expect, it } from "vitest";
import {
  CapabilityDescriptorSchema,
  defineCapabilityDescriptor,
} from "./capability.js";

describe("CapabilityDescriptor", () => {
  it("does not allow a capability to claim verification without evidence", () => {
    expect(
      CapabilityDescriptorSchema.safeParse({
        id: "timeline.render",
        state: "verified",
        version: "1",
      }).success,
    ).toBe(false);
  });

  it("normalizes optional requirement and limitation lists", () => {
    expect(
      defineCapabilityDescriptor({
        id: "timeline.render",
        state: "unavailable",
        version: "1",
      }),
    ).toEqual({
      id: "timeline.render",
      state: "unavailable",
      version: "1",
      limitations: [],
      requiredHostCapabilities: [],
      requiredProviderCapabilities: [],
    });
  });
});
