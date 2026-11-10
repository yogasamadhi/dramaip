import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPinnedLookup,
  isAllowedResponseContentType,
  isPublicAddress,
  resolvePinnedAddress,
  safeHttpRequest,
  selectPinnedAddress,
} from "./safe-http-transport";

const servers: Array<{ close(): void }> = [];

afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

describe("SafeHttpTransport address policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.178",
    "198.19.255.254",
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

  it("rejects a DNS answer set containing a rebinding target", async () => {
    await expect(
      selectPinnedAddress(
        [
          { address: "1.1.1.1", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
        false,
      ),
    ).rejects.toThrow("not publicly routable");
  });

  it("recovers a proxy's synthetic DNS answer using independently validated public DNS", async () => {
    const systemLookup = vi.fn(async () => [
      { address: "198.18.0.178", family: 4 },
    ]);
    const publicLookup = vi.fn(async () => [
      { address: "104.18.7.160", family: 4 },
    ]);
    await expect(
      resolvePinnedAddress(
        new URL("https://public.example/mcp"),
        false,
        systemLookup,
        publicLookup,
      ),
    ).resolves.toEqual({ address: "104.18.7.160", family: 4 });
    expect(publicLookup).toHaveBeenCalledWith("public.example");
  });

  it("rejects private addresses from public DNS, including mixed answers", async () => {
    await expect(
      resolvePinnedAddress(
        new URL("https://rebind.example/"),
        false,
        async () => [{ address: "198.18.0.1", family: 4 }],
        async () => [
          { address: "1.1.1.1", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      ),
    ).rejects.toThrow("not publicly routable");
  });

  it.each([
    "https://198.18.0.1/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://service.local/",
    "https://service.internal/",
  ])(
    "never turns a local or literal target into a public lookup: %s",
    async (url) => {
      const publicLookup = vi.fn(async () => [
        { address: "1.1.1.1", family: 4 },
      ]);
      await expect(
        resolvePinnedAddress(
          new URL(url),
          false,
          async () => [{ address: "198.18.0.1", family: 4 }],
          publicLookup,
        ),
      ).rejects.toThrow("not publicly routable");
      expect(publicLookup).not.toHaveBeenCalled();
    },
  );

  it("does not hide mixed private DNS answers or ordinary network failures", async () => {
    const publicLookup = vi.fn(async () => [{ address: "1.1.1.1", family: 4 }]);
    await expect(
      resolvePinnedAddress(
        new URL("https://mixed.example/"),
        false,
        async () => [
          { address: "198.18.0.1", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ],
        publicLookup,
      ),
    ).rejects.toThrow("not publicly routable");
    await expect(
      resolvePinnedAddress(
        new URL("https://offline.example/"),
        false,
        async () => {
          throw new Error("DNS offline");
        },
        publicLookup,
      ),
    ).rejects.toThrow("DNS offline");
    expect(publicLookup).not.toHaveBeenCalled();
  });

  it("returns an address array when Electron requests lookup with all=true", async () => {
    const pinned = { address: "1.1.1.1", family: 4 as const };
    const result = await new Promise<{
      address: string | Array<{ address: string; family: number }>;
      family?: number;
    }>((resolve, reject) => {
      createPinnedLookup(pinned)(
        "provider.example",
        { all: true },
        (error, address, family) => {
          if (error) reject(error);
          else
            resolve({ address, ...(family === undefined ? {} : { family }) });
        },
      );
    });
    expect(result.address).toEqual([pinned]);
    expect(result.family).toBeUndefined();
  });

  it("returns the pinned scalar address for a single-address lookup", async () => {
    const result = await new Promise<{
      address: string | Array<{ address: string; family: number }>;
      family?: number;
    }>((resolve, reject) => {
      createPinnedLookup({ address: "2606:4700:4700::1111", family: 6 })(
        "provider.example",
        { all: false },
        (error, address, family) => {
          if (error) reject(error);
          else
            resolve({ address, ...(family === undefined ? {} : { family }) });
        },
      );
    });
    expect(result).toEqual({
      address: "2606:4700:4700::1111",
      family: 6,
    });
  });
});

describe("SafeHttpTransport response policy", () => {
  it("allows only explicitly supported text and MCP media types", () => {
    expect(isAllowedResponseContentType("application/dns-json", "json")).toBe(
      true,
    );
    expect(
      isAllowedResponseContentType("text/html; charset=utf-8", "text"),
    ).toBe(true);
    expect(isAllowedResponseContentType("text/markdown", "text")).toBe(true);
    expect(isAllowedResponseContentType("application/xhtml+xml", "text")).toBe(
      true,
    );
    expect(isAllowedResponseContentType("application/json", "text")).toBe(true);
    expect(isAllowedResponseContentType("application/json", "mcp")).toBe(true);
    expect(isAllowedResponseContentType("text/event-stream", "mcp")).toBe(true);
    expect(isAllowedResponseContentType("image/png", "text")).toBe(false);
    expect(isAllowedResponseContentType("application/pdf", "text")).toBe(false);
  });

  it("removes authorization when a redirect crosses origins", async () => {
    const destination = createServer((request, response) => {
      response.setHeader("Content-Type", "text/plain");
      response.end(
        `${request.headers.authorization ?? "no-authorization"}|${request.headers["x-api-key"] ?? "no-api-key"}|${request.headers["idempotency-key"] ?? "no-idempotency-key"}`,
      );
    });
    await new Promise<void>((resolve) =>
      destination.listen(0, "127.0.0.1", resolve),
    );
    servers.push(destination);
    const destinationAddress = destination.address();
    if (!destinationAddress || typeof destinationAddress === "string")
      throw new Error("test server did not bind");
    const origin = createServer((_request, response) => {
      response.statusCode = 302;
      response.setHeader(
        "Location",
        `http://127.0.0.1:${destinationAddress.port}/target`,
      );
      response.end();
    });
    await new Promise<void>((resolve) =>
      origin.listen(0, "127.0.0.1", resolve),
    );
    servers.push(origin);
    const originAddress = origin.address();
    if (!originAddress || typeof originAddress === "string")
      throw new Error("test server did not bind");

    const result = await safeHttpRequest({
      url: `http://127.0.0.1:${originAddress.port}/start`,
      method: "GET",
      accept: "text",
      maximumBytes: 1024,
      timeoutMs: 1_000,
      authorization: "Bearer must-not-cross-origin",
      apiKey: "must-not-cross-origin-api-key",
      idempotencyKey: "must-not-cross-origin-idempotency-key",
      allowHttp: true,
      allowPrivateNetwork: true,
    });
    expect(result.bytes.toString("utf8")).toBe(
      "no-authorization|no-api-key|no-idempotency-key",
    );
  });

  it("sends a DELETE request and idempotency key only to the provider origin", async () => {
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          method: request.method,
          idempotencyKey: request.headers["idempotency-key"],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("test server did not bind");
    const result = await safeHttpRequest({
      url: `http://127.0.0.1:${address.port}/task-1`,
      method: "DELETE",
      accept: "json",
      maximumBytes: 1_024,
      timeoutMs: 1_000,
      authorization: "Bearer secret",
      idempotencyKey: "delete-task-1",
      allowHttp: true,
      allowPrivateNetwork: true,
    });
    expect(JSON.parse(result.bytes.toString("utf8"))).toEqual({
      method: "DELETE",
      idempotencyKey: "delete-task-1",
    });
  });

  it("rejects an oversized response before returning partial content", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/plain");
      response.end("x".repeat(2_048));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("test server did not bind");
    await expect(
      safeHttpRequest({
        url: `http://127.0.0.1:${address.port}/large`,
        method: "GET",
        accept: "text",
        maximumBytes: 512,
        timeoutMs: 1_000,
        authorization: "",
        allowHttp: true,
        allowPrivateNetwork: true,
      }),
    ).rejects.toThrow("too large");
  });

  it("aborts a response that exceeds the request deadline", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/plain");
      response.write("started");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("test server did not bind");
    await expect(
      safeHttpRequest({
        url: `http://127.0.0.1:${address.port}/slow`,
        method: "GET",
        accept: "text",
        maximumBytes: 512,
        timeoutMs: 25,
        authorization: "",
        allowHttp: true,
        allowPrivateNetwork: true,
      }),
    ).rejects.toThrow();
  });
});
