// @vitest-environment jsdom
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { LocaleRuntime } from "@dramaip/infra-locale/client";
import { SlotRegistry } from "@dramaip/infra-ui-renderer/client";
import type { PropsRenderSlots, TranslateNS } from "@dramaip/infra-ui-slots";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InspirationPage,
  type InspirationPageProps,
} from "../src/client/InspirationPage.tsx";
import { apply, inject } from "../src/client/index.ts";

const owners = new Set<Fiber>();
afterEach(async () => {
  cleanup();
  for (const owner of owners) await owner.dispose();
  owners.clear();
});

const t = ((key: string) => key) as unknown as TranslateNS<"agents">;

async function bench() {
  const root = new Context();
  let ctx: Context | undefined;
  const owner = root.plugin((owned: Context) => {
    ctx = owned;
  });
  owners.add(owner);
  await owner.await();
  if (ctx === undefined) throw new Error("the fixture owner did not activate");
  const slotsFiber = ctx.plugin(SlotRegistry);
  ctx.provide("locale", new LocaleRuntime(ctx));
  const remote = {
    agents: {},
    knowledge: {},
    quality: {},
    system: {},
    workspace: {},
    writing: {},
    production: {},
  };
  ctx.provide("remote", remote as never);
  ctx.provide("remote.agents", remote.agents as never);
  ctx.provide("remote.knowledge", remote.knowledge as never);
  ctx.provide("remote.quality", remote.quality as never);
  ctx.provide("remote.system", remote.system as never);
  ctx.provide("remote.workspace", remote.workspace as never);
  ctx.provide("remote.writing", remote.writing as never);
  ctx.provide("remote.production", remote.production as never);
  await slotsFiber.await();
  return { ctx, slots: ctx.get("slots") as SlotRegistry, remote };
}

describe("agents client apply", () => {
  it("needs Slots, copy and the namespaces its views use", () => {
    expect(inject).toEqual([
      "slots",
      "locale",
      "remote",
      "remote.agents",
      "remote.knowledge",
      "remote.quality",
      "remote.system",
      "remote.workspace",
      "remote.writing",
      "remote.production",
    ]);
  });

  it("defines the new-task settings Factory under the agents copy", async () => {
    const { ctx, slots } = await bench();
    const define = vi.spyOn(slots, "registerFactory");
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(
      define.mock.calls.map(([options]) => [
        options.name,
        options.scope,
        options.locale,
      ]),
    ).toEqual([["agents.task-config", "root", "agents"]]);
  });

  it("adds the AI section once the settings page declares its sections, and relays connection verdicts", async () => {
    const { ctx, slots, remote } = await bench();
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(slots.entries("settings.section")).toHaveLength(0);
    slots.register(
      {
        name: "root",
        priority: -1,
        children: { "settings.section": { kind: "list", scope: "root" } },
      },
      ({ renderSlot }: PropsRenderSlots<"settings.section">) =>
        renderSlot("settings.section", { close: () => {} }),
    );
    const [entry] = slots.entries("settings.section");
    expect(entry?.options).toMatchObject({
      id: "settings-ai",
      order: 10,
    });
    expect(entry?.registrant).toBe("agents-client");
    const ready = vi.fn();
    ctx.on("studio/provider-ready", ready);
    const injected = entry?.inject?.() as {
      agents: unknown;
      system: unknown;
      workspace: unknown;
      announce: (id: string | undefined) => void;
    };
    expect(injected.agents).toBe(remote.agents);
    expect(injected.system).toBe(remote.system);
    expect(injected.workspace).toBe(remote.workspace);
    injected.announce("provider-1");
    expect(ready).toHaveBeenCalledWith("provider-1");
  });

  it("takes /inspiration once the Studio client declares its routes", async () => {
    const { ctx, slots } = await bench();
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(slots.entries("studio.route")).toHaveLength(0);
    slots.register(
      {
        name: "root",
        priority: -1,
        children: { "studio.route": { kind: "keyed", scope: "root" } },
      },
      ({ renderSlot }: PropsRenderSlots<"studio.route">) =>
        renderSlot(
          "studio.route",
          {
            navigate: vi.fn(),
            useRoute: vi.fn(),
            useProjectRecord: vi.fn(),
            useNovelWorkspace: vi.fn(),
            useNovelQuickStart: vi.fn(),
            useProjectScope: vi.fn(),
            useProductionScope: vi.fn(),
            useEpisodeScope: vi.fn(),
            useAssistantIntent: vi.fn(),
          },
          { entryKey: "/inspiration" },
        ),
    );
    expect(
      slots.entries("studio.route").map((entry) => entry.options.key),
    ).toEqual(["/inspiration"]);
  });
});

describe("the inspiration space page", () => {
  it("lays the space out under its heading copy with the conversion in its slot", () => {
    const renderSlot = vi.fn(
      (name: string, owner: unknown, options?: { entryKey?: string }) => (
        <span>{`${name} ${options?.entryKey} ${JSON.stringify(owner)}`}</span>
      ),
    );
    const pending = () => new Promise(() => {});
    const remotes = new Proxy({}, { get: () => vi.fn(pending) });
    const props = {
      t,
      renderSlot,
      agents: remotes,
      knowledge: remotes,
      quality: remotes,
      system: {
        events: () => ({
          dispose: () => undefined,
          [Symbol.asyncIterator]: () => ({ next: pending }),
        }),
      },
    } as unknown as InspirationPageProps;
    render(<InspirationPage {...props} />);
    expect(
      screen.getByRole("heading", { name: "inspiration.title" }),
    ).toBeTruthy();
    expect(screen.getByText("inspiration.description")).toBeTruthy();
    expect(renderSlot).not.toHaveBeenCalled();
  });
});
