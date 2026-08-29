import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPinnedLookup,
  isAllowedResponseContentType,
  isPublicAddress,
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
          else resolve({ address, family });
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
          else resolve({ address, family });
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
        `${request.headers.authorization ?? "no-authorization"}|${request.headers["x-api-key"] ?? "no-api-key"}`,
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
      allowHttp: true,
      allowPrivateNetwork: true,
    });
    expect(result.bytes.toString("utf8")).toBe("no-authorization|no-api-key");
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
