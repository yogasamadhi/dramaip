import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { ContributionRegistry, type RunningKernel } from "@dramaip/kernel";
import { RuntimeRouteRegistry } from "@dramaip/http";
import { RuntimeDevelopment } from "./development.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((base) => rm(base, { recursive: true, force: true })),
  );
});

async function fixture({ ready = true }: { ready?: boolean } = {}) {
  const base = await mkdtemp(join(tmpdir(), "dramaip-development-test-"));
  directories.push(base);
  await mkdir(join(base, "profiles/safe"), { recursive: true });
  await mkdir(join(base, "plugins/system/src"), { recursive: true });
  const config = join(base, "profiles/safe/cordis.patch.yml");
  const module = join(base, "plugins/system/src/index.js");
  await writeFile(config, "[]\n");
  await writeFile(module, "export const accepted = 1;\n");
  let activeConfiguration = "initial";
  const publications: string[] = [];
  const kernel: RunningKernel = {
    pluginOrder: [],
    ui: new ContributionRegistry(),
    context: {} as RunningKernel["context"],
    service: () => undefined,
    diagnostics: () => ({
      profile: "test",
      plugins: [],
      routes: [],
      bridgeRouteCount: 0,
      effects: [],
      services: [],
    }),
    configurationFingerprint: () =>
      createHash("sha256").update(activeConfiguration).digest("hex"),
    settle: async () => {},
    setGraphRevision: () => {},
    dispose: async () => {},
  };
  const registry = new RuntimeRouteRegistry();
  const development = new RuntimeDevelopment({
    base,
    kernel: () => kernel,
    registry,
    publish: (revision) => publications.push(revision),
    restart: () => {
      throw new Error("Unexpected supervised restart");
    },
  });
  if (ready) await development.ready();
  return {
    development,
    registry,
    config,
    module,
    publications,
    activate: (value: string) => {
      activeConfiguration = value;
    },
  };
}

describe("active native configuration graph publication", () => {
  it("distinguishes actual activations sharing the same pending disk snapshot", async () => {
    const f = await fixture();
    await writeFile(f.config, "- id: system\n  config: { reloadProbe: 1 }\n");
    await f.development.run(async () => true);
    await f.development.run(async () => {
      f.activate("applied-next");
      return true;
    });
    expect(f.publications).toHaveLength(2);
    expect(f.publications[0]).not.toBe(f.publications[1]);
  });

  it("does not publish an unactivated disk configuration as a new graph", async () => {
    const f = await fixture();
    await f.development.run(async () => true);
    await writeFile(f.config, "- id: system\n  config: { pendingFuture: 2 }\n");
    await f.development.run(async () => true);
    expect(f.publications).toHaveLength(2);
    expect(f.publications[0]).toBe(f.publications[1]);
  });

  it("preserves exact revision for duplicate events and equivalent configuration bytes", async () => {
    const f = await fixture();
    await f.development.run(async () => true);
    await writeFile(
      f.config,
      "# equivalent formatting, not a new activation\n[]\n",
    );
    await f.development.run(async () => true);
    expect(f.publications[0]).toBe(f.publications[1]);
  });

  it("restores a rejected import without changing the last successful graph", async () => {
    const f = await fixture();
    await f.development.run(async () => true);
    const original = await readFile(f.module, "utf8");
    await writeFile(f.module, "this is invalid ESM !!!");
    await f.development.run(async () => false);
    expect(f.publications).toHaveLength(1);
    expect(await readFile(f.module, "utf8")).toBe(original);
    await f.development.run(async () => true);
    expect(f.publications[0]).toBe(f.publications[1]);
  });
});

describe("M4 activated configuration recovery journal", () => {
  const pending = "- id: system\n  config: { reloadProbe: 2 }\n";
  const journal = async (f: Awaited<ReturnType<typeof fixture>>) => {
    const value = JSON.parse(
      await readFile(join(dirname(f.config), "../../.last-good.json"), "utf8"),
    ) as { files: [string, string][] };
    return new Map(
      value.files.map(([path, bytes]) => [
        path,
        Buffer.from(bytes, "base64").toString("utf8"),
      ]),
    );
  };
  it("waits for the initial graph and recovery baseline before running an initial native callback", async () => {
    const f = await fixture({ ready: false });
    let activated = 0;
    const queued = f.development.run(
      async () => {
        activated++;
        return false;
      },
      new Map([[f.config, Buffer.from("[]\n")]]),
    );
    void queued.catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(activated).toBe(0);
    expect(f.publications).toEqual([]);
    await f.development.ready();
    expect(activated).toBe(1);
    await queued;
    expect(activated).toBe(1);
    expect(f.development.diagnostics().lastError).toBeUndefined();
    expect((await journal(f)).get("plugins/system/src/index.js")).toBe(
      "export const accepted = 1;\n",
    );
  });
  it("does not announce boot readiness while a queued initial callback is publishing", async () => {
    const f = await fixture({ ready: false }),
      active = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    let ready = false;
    const queued = f.development.run(
      async () => {
        active.resolve();
        await release.promise;
        return false;
      },
      new Map([[f.config, Buffer.from("[]\n")]]),
    );
    void queued.catch(() => undefined);
    const startup = f.development.ready().then(() => {
      ready = true;
    });
    try {
      await active.promise;
      expect(ready).toBe(false);
    } finally {
      release.resolve();
      await Promise.allSettled([queued, startup]);
    }
    expect(ready).toBe(true);
    expect(f.development.diagnostics().lastError).toBeUndefined();
  });
  it("does not erase a later complete configuration when an earlier parse rejection reaches recovery", async () => {
    const f = await fixture();
    await writeFile(f.config, "[");
    const earlier = new Error("Controlled earlier invalid patch list");
    await writeFile(f.config, pending);
    await f.development.rejectConfig(earlier);
    expect(await readFile(f.config, "utf8")).toBe(pending);
    expect(f.development.diagnostics().lastError).toBe(earlier.message);
    expect((await journal(f)).get("profiles/safe/cordis.patch.yml")).toBe(
      "[]\n",
    );
  });
  it("releases queued initial callbacks on boot failure without running an activation", async () => {
    const f = await fixture({ ready: false });
    let activated = false;
    const queued = f.development.run(async () => {
      activated = true;
      return true;
    });
    void queued.catch(() => undefined);
    await Promise.resolve();
    f.development.abortInitialization(
      new Error("Controlled initial graph failure"),
    );
    await expect(queued).rejects.toThrow("Controlled initial graph failure");
    expect(activated).toBe(false);
    expect(f.publications).toEqual([]);
  });
  it("does not journal pending invalid configuration during an unrelated successful module publication", async () => {
    const f = await fixture();
    await writeFile(f.config, "[");
    await f.development.run(async () => true);
    expect(await readFile(f.config, "utf8")).toBe("[");
    expect((await journal(f)).get("profiles/safe/cordis.patch.yml")).toBe(
      "[]\n",
    );
  });
  it("journals exact successfully activated inputs rather than later disk bytes while preserving future edits", async () => {
    const f = await fixture(),
      observed = new Map([[f.config, Buffer.from(pending)]]),
      future = "- id: system\n  config: { reloadProbe: 3 }\n";
    await writeFile(f.config, future);
    await f.development.run(async () => {
      f.activate("actual-two");
      return true;
    }, observed);
    expect(await readFile(f.config, "utf8")).toBe(future);
    expect((await journal(f)).get("profiles/safe/cordis.patch.yml")).toBe(
      pending,
    );
    await f.development.run(async () => true);
    expect((await journal(f)).get("profiles/safe/cordis.patch.yml")).toBe(
      pending,
    );
  });
  it("restores a rejected module without erasing a pending complete configuration", async () => {
    const f = await fixture(),
      original = await readFile(f.module, "utf8");
    await writeFile(f.config, pending);
    await writeFile(f.module, "invalid module");
    await f.development.run(async () => false);
    expect(await readFile(f.module, "utf8")).toBe(original);
    expect(await readFile(f.config, "utf8")).toBe(pending);
  });
  it("acknowledges equivalent validated config without a new graph or capturing pending invalid code", async () => {
    const f = await fixture(),
      original = await readFile(f.module, "utf8"),
      equivalent = "# valid equivalent native patches\n[]\n";
    await f.development.run(async () => true);
    const before = [...f.publications];
    await f.development.rejectConfig(new Error("earlier parse rejection"));
    await writeFile(f.module, "invalid pending code");
    await writeFile(f.config, equivalent);
    await f.development.run(
      async () => false,
      new Map([[f.config, Buffer.from(equivalent)]]),
    );
    expect(f.publications).toEqual(before);
    expect(f.development.diagnostics().lastError).toBeUndefined();
    expect((await journal(f)).get("profiles/safe/cordis.patch.yml")).toBe(
      equivalent,
    );
    expect((await journal(f)).get("plugins/system/src/index.js")).toBe(
      original,
    );
  });
  it("acknowledges a serially confirmed equivalent native callback without beginning a router reload", async () => {
    const f = await fixture(),
      equivalent = "# same accepted native patch tree\n[]\n";
    await f.development.run(async () => true);
    const before = [...f.publications],
      begin = vi.spyOn(f.registry, "beginReload");
    let called = false;
    await f.development.rejectConfig(new Error("earlier parse error"));
    await f.development.run(
      async () => {
        called = true;
        return false;
      },
      new Map([[f.config, Buffer.from(equivalent)]]),
      () => true,
    );
    expect(called).toBe(false);
    expect(begin).not.toHaveBeenCalled();
    expect(f.publications).toEqual(before);
    expect(f.development.diagnostics().lastError).toBeUndefined();
    expect((await journal(f)).get("profiles/safe/cordis.patch.yml")).toBe(
      equivalent,
    );
  });
  it("refuses foreign and non-config receipts without changing the accepted journal", async () => {
    const f = await fixture(),
      before = await journal(f);
    for (const filename of [join(tmpdir(), "outside-cordis.yml"), f.module])
      await expect(
        f.development.run(
          async () => false,
          new Map([[filename, Buffer.from(pending)]]),
        ),
      ).rejects.toThrow("receipt");
    expect(await journal(f)).toEqual(before);
    expect(f.publications).toEqual([]);
  });
});
