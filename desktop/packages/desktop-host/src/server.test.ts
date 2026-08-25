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
});
