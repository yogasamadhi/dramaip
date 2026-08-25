import { describe, expect, it } from "vitest";
import { isPublicAddress } from "./safe-http-transport";

describe("SafeHttpTransport address policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "2001:db8::1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows globally routed address %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
});
