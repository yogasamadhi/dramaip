import { describe, expect, it } from "vitest";
import { TestRoutes } from "./test-routes";

const URL_ = "dramaip-app://app/held/p/chapters";
const forwarded: Request[] = [];
const forward = async (request: Request) => {
  forwarded.push(request);
  return new Response(JSON.stringify({ via: "host", method: request.method }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
};

function routes() {
  forwarded.length = 0;
  const value = new TestRoutes();
  value.setPatterns([{ source: "^(.*)/held/([^/]*)/chapters$", flags: "" }]);
  return value;
}

describe("isolated E2E request routing", () => {
  it("leaves unmatched requests to the caller", async () => {
    const value = routes();
    expect(
      await value.handle(new Request("dramaip-app://app/passed"), forward),
    ).toBeUndefined();
  });

  it("holds a matched request until the test fulfills it", async () => {
    const value = routes();
    const response = value.handle(
      new Request(URL_, {
        method: "POST",
        headers: { "Idempotency-Key": "k" },
        body: JSON.stringify({ title: "第一章" }),
      }),
      forward,
    );
    const paused = await value.next();
    expect(paused).toMatchObject({ url: URL_, method: "POST" });
    expect(paused.headers["idempotency-key"]).toBe("k");
    expect(JSON.parse(Buffer.from(paused.body!, "base64").toString())).toEqual({
      title: "第一章",
    });
    await value.settle(paused.id, {
      kind: "fulfill",
      status: 503,
      headers: { "content-type": "application/json", "content-length": "999" },
      body: Buffer.from('{"code":"UNAVAILABLE"}').toString("base64"),
    });
    const result = (await response)!;
    expect(result.status).toBe(503);
    expect(result.headers.get("content-length")).toBeNull();
    expect(await result.json()).toEqual({ code: "UNAVAILABLE" });
    expect(forwarded).toHaveLength(0);
  });

  it("fetches from the Host without releasing, then continues with overrides", async () => {
    const value = routes();
    const response = value.handle(new Request(URL_), forward);
    const paused = await value.next();
    const fetched = await value.fetch(paused.id, {});
    expect(fetched.status).toBe(201);
    expect(JSON.parse(Buffer.from(fetched.body, "base64").toString())).toEqual({
      via: "host",
      method: "GET",
    });
    await value.settle(paused.id, { kind: "continue", method: "DELETE" });
    expect((await response)!.status).toBe(201);
    expect(forwarded.map((request) => request.method)).toEqual([
      "GET",
      "DELETE",
    ]);
  });

  it("fails an aborted request like a network error and ignores a second decision", async () => {
    const value = routes();
    const response = value.handle(new Request(URL_), forward);
    const paused = await value.next();
    await value.settle(paused.id, { kind: "abort" });
    await value.settle(paused.id, { kind: "continue" });
    expect((await response)!.type).toBe("error");
    expect(forwarded).toHaveLength(0);
  });

  it("drops a fulfilled body for a status that cannot carry one", async () => {
    const value = routes();
    const response = value.handle(new Request(URL_), forward);
    const paused = await value.next();
    await value.settle(paused.id, {
      kind: "fulfill",
      status: 204,
      headers: {},
      body: Buffer.from("ignored").toString("base64"),
    });
    expect((await response)!.status).toBe(204);
  });

  it("stops holding requests once its patterns are cleared", async () => {
    const value = routes();
    value.setPatterns([]);
    expect(await value.handle(new Request(URL_), forward)).toBeUndefined();
  });
});
