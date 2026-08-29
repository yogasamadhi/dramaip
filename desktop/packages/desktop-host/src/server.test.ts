import { afterEach, describe, expect, it } from "vitest";
import { createDesktopHost, type DesktopHostActions } from "./index.js";

const servers: Array<{ close(): void }> = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()!.close();
});

describe("Desktop Host server", () => {
  it("waits for the listening handshake and returns the assigned port", async () => {
    const host = createDesktopHost({
      accessToken: "desktop-host-port-test",
      capabilities: [],
      actions: {} as DesktopHostActions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    expect(server.port).toBeGreaterThan(0);

    const response = await fetch(
      `http://${server.hostname}:${server.port}/host/v1/health`,
      {
        headers: { Authorization: "Bearer desktop-host-port-test" },
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ healthy: true });
  });

  it("returns normalized granted documents without exposing file paths", async () => {
    const actions = {
      readGrantedDocument: async () => ({
        name: "story.docx",
        format: "docx" as const,
        content: "## 第一章\n\n正文",
        size: 128,
      }),
    } as unknown as DesktopHostActions;
    const host = createDesktopHost({
      accessToken: "desktop-host-document-test",
      capabilities: [],
      actions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    const response = await fetch(
      `http://${server.hostname}:${server.port}/host/v1/files/grants/grant-1/document`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer desktop-host-document-test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ maximumBytes: 1024 }),
      },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      name: "story.docx",
      format: "docx",
      content: "## 第一章\n\n正文",
    });
    expect(JSON.stringify(body)).not.toContain("path");
  });

  it("keeps public search and webpage reading behind authenticated Host routes", async () => {
    const actions = {
      webSearch: async () => ({
        provider: "exa" as const,
        text: "[Result](https://example.com)",
        coverage: "test",
      }),
      readWebPage: async () => ({
        title: "Example",
        url: "https://example.com/",
        content: "safe text",
        contentType: "text/html",
        retrievedAt: "2026-08-29T00:00:00.000Z",
        truncated: false,
      }),
    } as unknown as DesktopHostActions;
    const host = createDesktopHost({
      accessToken: "desktop-host-web-test",
      capabilities: [],
      actions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    const baseUrl = `http://${server.hostname}:${server.port}`;
    const headers = {
      Authorization: "Bearer desktop-host-web-test",
      "Content-Type": "application/json",
    };

    const search = await fetch(`${baseUrl}/host/v1/web/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "exa",
        query: "DramaIP",
        limit: 8,
        sessionId: "session-1",
      }),
    });
    expect(search.status).toBe(200);
    await expect(search.json()).resolves.toMatchObject({ provider: "exa" });

    const read = await fetch(`${baseUrl}/host/v1/web/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: "https://example.com",
        maxCharacters: 20_000,
      }),
    });
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ content: "safe text" });

    const privateScheme = await fetch(`${baseUrl}/host/v1/web/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: "http://127.0.0.1/private",
        maxCharacters: 20_000,
      }),
    });
    expect(privateScheme.status).toBe(400);
    const unauthorised = await fetch(`${baseUrl}/host/v1/web/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "exa",
        query: "DramaIP",
        limit: 8,
        sessionId: "session-1",
      }),
    });
    expect(unauthorised.status).toBe(401);
  });
});
