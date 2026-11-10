// @vitest-environment jsdom
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { LocaleRuntime } from "@dramaip/infra-locale/client";
import { SlotRegistry } from "@dramaip/infra-ui-renderer/client";
import type { PropsRenderSlots, TranslateNS } from "@dramaip/infra-ui-slots";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptPage, type AdaptPageProps } from "../src/client/AdaptPage.tsx";
import { apply, inject } from "../src/client/index.ts";

const owners = new Set<Fiber>();
afterEach(async () => {
  cleanup();
  for (const owner of owners) await owner.dispose();
  owners.clear();
});

const t = ((key: string) => key) as unknown as TranslateNS<"production">;

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
  const remote = { production: {}, automation: {}, system: {}, writing: {} };
  ctx.provide("remote", remote as never);
  for (const [name, namespace] of Object.entries(remote))
    ctx.provide(`remote.${name}`, namespace as never);
  await slotsFiber.await();
  return { ctx, remote, slots: ctx.get("slots") as SlotRegistry };
}

describe("production client apply", () => {
  it("needs Slots, copy and the Remote namespaces its tools call", () => {
    expect(inject).toEqual([
      "slots",
      "locale",
      "remote",
      "remote.production",
      "remote.automation",
      "remote.system",
      "remote.writing",
    ]);
  });

  it("registers the production tools once the tool slot is declared", async () => {
    const { ctx, remote, slots } = await bench();
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(slots.entries("workspace.tool")).toHaveLength(0);
    slots.register(
      {
        name: "root",
        priority: -1,
        children: { "workspace.tool": { kind: "keyed", scope: "root" } },
      },
      (_props: PropsRenderSlots<"workspace.tool">) => null,
    );
    const tools = slots.entries("workspace.tool");
    expect(tools.map((entry) => entry.options.key)).toEqual([
      "adaptation-diagnosis",
      "adaptation-strategy",
      "season-plan",
    ]);
    for (const tool of tools) {
      expect(tool.registrant).toBe("production-client");
      expect(tool.inject?.()).toEqual(remote);
    }
  });

  it("takes /adapt once the Studio client declares its routes", async () => {
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
          { entryKey: "/adapt" },
        ),
    );
    expect(
      slots.entries("studio.route").map((entry) => entry.options.key),
    ).toEqual(["/adapt"]);
  });
});

describe("the adaptation page", () => {
  it("hands the workbench its heading copy for either kind of project", () => {
    const renderSlot = vi.fn(
      (name: string, owner: unknown, options?: { entryKey?: string }) => (
        <span>{`${name} ${options?.entryKey} ${JSON.stringify(owner)}`}</span>
      ),
    );
    const props = { t, renderSlot } as unknown as AdaptPageProps;
    render(<AdaptPage {...props} />);
    expect(
      screen.getByText(
        `production.adapt body ${JSON.stringify({
          intro: {
            story: {
              title: "intro.story.title",
              description: "intro.story.description",
            },
            script: {
              title: "intro.script.title",
              description: "intro.script.description",
            },
          },
        })}`,
      ),
    ).toBeTruthy();
  });
});
