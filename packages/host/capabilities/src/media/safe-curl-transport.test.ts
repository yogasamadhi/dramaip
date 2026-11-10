import { describe, expect, it, vi } from "vitest";
import { safeCurlRequest } from "./safe-curl-transport";
import { resolvePinnedAddress } from "./safe-http-transport";

const input = {
  url: "https://public.example/search?q=weather",
  maximumBytes: 2048,
  timeoutMs: 15000,
};
const pinned = { address: "1.1.1.1", family: 4 as const };
const reply = (
  status = 200,
  body = "public text",
  headers = "Content-Type: text/plain",
) => Buffer.from(`HTTP/2 ${status}\r\n${headers}\r\n\r\n${body}`);

describe("curl public-network transport", () => {
  it("pins the target and sends only a structured HTTPS GET without shell/config/proxy expansion", async () => {
    const execute = vi.fn(async (_args: string[]) => reply());
    const resolveAddress = vi.fn(async () => pinned);
    const result = await safeCurlRequest(input, { execute, resolveAddress });
    expect(result.bytes.toString()).toBe("public text");
    expect(result.finalUrl).toBe(input.url);
    const args = execute.mock.calls[0]![0] as string[];
    expect(args[0]).toBe("--disable");
    expect(args).toContain("--globoff");
    expect(args).toContain("public.example:443:1.1.1.1");
    expect(args.slice(-2)).toEqual(["--url", input.url]);
    expect(args).not.toContain("--location");
    expect(args).not.toContain("--output");
    expect(resolveAddress).toHaveBeenCalledWith(new URL(input.url), false);
  });

  it.each([
    "file:///etc/passwd",
    "http://public.example/",
    "https://user:secret@public.example/",
  ])("refuses non-public URL forms before starting curl: %s", async (url) => {
    const execute = vi.fn(async (_args: string[]) => reply());
    await expect(
      safeCurlRequest(
        { ...input, url },
        { execute, resolveAddress: async () => pinned },
      ),
    ).rejects.toThrow("URL scheme");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    "https://127.0.0.1/",
    "https://169.254.169.254/",
    "https://198.18.0.1/",
    "https://[::1]/",
  ])("refuses private or synthetic literal addresses: %s", async (url) => {
    const execute = vi.fn(async (_args: string[]) => reply());
    await expect(
      safeCurlRequest(
        { ...input, url },
        { execute, resolveAddress: resolvePinnedAddress },
      ),
    ).rejects.toThrow("not publicly routable");
    expect(execute).not.toHaveBeenCalled();
  });

  it("checks every redirect and blocks a redirect into the local network", async () => {
    const execute = vi.fn(async () =>
      reply(302, "", "Location: https://127.0.0.1/private"),
    );
    await expect(
      safeCurlRequest(input, {
        execute,
        resolveAddress: async (url, allowPrivate) =>
          url.hostname === "public.example"
            ? pinned
            : resolvePinnedAddress(url, allowPrivate),
      }),
    ).rejects.toThrow("not publicly routable");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("pins a public redirect independently and returns its final URL", async () => {
    const execute = vi
      .fn(async (_args: string[]) => reply())
      .mockResolvedValueOnce(
        reply(302, "", "Location: https://second.example/page"),
      );
    const resolveAddress = vi.fn(async () => pinned);
    const result = await safeCurlRequest(input, { execute, resolveAddress });
    expect(result.finalUrl).toBe("https://second.example/page");
    expect(resolveAddress).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]![0]).toContain("second.example:443:1.1.1.1");
  });

  it("ignores early hints and validates the final response", async () => {
    const result = await safeCurlRequest(input, {
      resolveAddress: async () => pinned,
      execute: async () =>
        Buffer.concat([
          reply(103, "", "Link: </style.css>; rel=preload"),
          reply(),
        ]),
    });
    expect(result.status).toBe(200);
    expect(result.bytes.toString()).toBe("public text");
  });

  it("rejects binary and oversized responses", async () => {
    await expect(
      safeCurlRequest(input, {
        resolveAddress: async () => pinned,
        execute: async () =>
          reply(200, "binary", "Content-Type: application/pdf"),
      }),
    ).rejects.toThrow("content type");
    await expect(
      safeCurlRequest(
        { ...input, maximumBytes: 10 },
        { resolveAddress: async () => pinned, execute: async () => reply() },
      ),
    ).rejects.toThrow("too large");
  });

  it("stops redirect loops and does not start curl after its deadline", async () => {
    const execute = vi.fn(async (_args: string[]) =>
      reply(302, "", "Location: /again"),
    );
    await expect(
      safeCurlRequest(input, { execute, resolveAddress: async () => pinned }),
    ).rejects.toThrow("redirect limit");
    expect(execute).toHaveBeenCalledTimes(4);
    execute.mockClear();
    await expect(
      safeCurlRequest(
        { ...input, timeoutMs: 0 },
        { execute, resolveAddress: async () => pinned },
      ),
    ).rejects.toThrow("timed out");
    expect(execute).not.toHaveBeenCalled();
  });
});
