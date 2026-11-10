// @vitest-environment jsdom
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { LocaleRuntime } from "@dramaip/infra-locale/client";
import { SlotRegistry } from "@dramaip/infra-ui-renderer/client";
import type { PropsRenderSlots, TranslateNS } from "@dramaip/infra-ui-slots";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CreativePage,
  type CreativePageProps,
} from "../src/client/CreativePage.tsx";
import { apply, inject } from "../src/client/index.ts";

const owners = new Set<Fiber>();
afterEach(async () => {
  cleanup();
  for (const owner of owners) await owner.dispose();
  owners.clear();
});

const t = ((key: string) => key) as unknown as TranslateNS<"quality">;

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
  await slotsFiber.await();
  return { ctx, slots: ctx.get("slots") as SlotRegistry };
}

describe("quality client apply", () => {
  it("needs Slots and copy", () => {
    expect(inject).toEqual(["slots", "locale"]);
  });

  it("takes /create once the Studio client declares its routes", async () => {
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
          { entryKey: "/create" },
        ),
    );
    expect(
      slots.entries("studio.route").map((entry) => entry.options.key),
    ).toEqual(["/create"]);
  });
});

function mount(search: string, activeProjectId: string) {
  const renderSlot = vi.fn((name: string, owner: unknown) => (
    <span>{`${name} ${JSON.stringify(owner)}`}</span>
  ));
  const props = {
    t,
    renderSlot,
    useRoute: () => ({ params: {}, search }),
    useProjectScope: () => ({
      projects: [],
      projectId: activeProjectId,
      select: vi.fn(),
    }),
  } as unknown as CreativePageProps;
  render(<CreativePage {...props} />);
  return { renderSlot };
}

describe("the creative analysis page", () => {
  it("lays out the sections for the project and change set the address names", () => {
    mount("?projectId=p-1&changeSetId=c-1", "active");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "page.title",
    );
    expect(
      screen.getByText(
        'quality.section {"projectId":"p-1","changeSetId":"c-1"}',
      ),
    ).toBeTruthy();
  });

  it("falls back to the app's active project, and to none", () => {
    mount("", "active");
    expect(
      screen.getByText(
        'quality.section {"projectId":"active","changeSetId":null}',
      ),
    ).toBeTruthy();
    cleanup();
    const { renderSlot } = mount("", "");
    expect(renderSlot).toHaveBeenCalledWith("quality.section", {
      projectId: undefined,
      changeSetId: null,
    });
  });
});
