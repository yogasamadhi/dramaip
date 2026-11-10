// @vitest-environment jsdom
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { LocaleRuntime } from "@dramaip/infra-locale/client";
import { SlotRegistry } from "@dramaip/infra-ui-renderer/client";
import type { PropsRenderSlots, TranslateNS } from "@dramaip/infra-ui-slots";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProducePage,
  type ProducePageProps,
} from "../src/client/ProducePage.tsx";
import { apply, inject } from "../src/client/index.ts";

const owners = new Set<Fiber>();
afterEach(async () => {
  cleanup();
  for (const owner of owners) await owner.dispose();
  owners.clear();
});

const t = ((key: string) => key) as unknown as TranslateNS<"media">;

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

describe("media client apply", () => {
  it("needs Slots and copy", () => {
    expect(inject).toEqual(["slots", "locale"]);
  });

  it("defines the delivery evidence factory", async () => {
    const { ctx, slots } = await bench();
    const define = vi.spyOn(slots, "registerFactory");
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(
      define.mock.calls.map(([options]) => [
        options.name,
        options.scope,
        options.locale,
      ]),
    ).toEqual([["media.delivery-evidence", "root", "media"]]);
  });

  it("takes /produce once the Studio client declares its routes", async () => {
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
          { entryKey: "/produce" },
        ),
    );
    expect(
      slots.entries("studio.route").map((entry) => entry.options.key),
    ).toEqual(["/produce"]);
  });
});

function mount(search: string) {
  const renderSlot = vi.fn(
    (name: string, owner: unknown, options?: { entryKey?: string }) => (
      <span>{`${name} ${options?.entryKey} ${JSON.stringify(owner)}`}</span>
    ),
  );
  const props = {
    t,
    renderSlot,
    useRoute: () => ({ params: {}, search }),
  } as unknown as ProducePageProps;
  render(<ProducePage {...props} />);
}

describe("the production page", () => {
  it("heads the production workbench and lays out its body", () => {
    mount("?projectId=p-1&stage=storyboard");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "produce.title",
    );
    expect(screen.getByText("produce.description")).toBeTruthy();
    expect(screen.getByText("media.produce body {}")).toBeTruthy();
  });

  it.each(["mediaSourceReviewId", "audioRevisionId", "audioResolutionId"])(
    "shows the media object a %s link returns to, with its heading copy",
    (name) => {
      mount(`?projectId=p-1&${name}=r-1`);
      expect(screen.queryByRole("heading")).toBeNull();
      expect(
        screen.getByText(
          `media.review body ${JSON.stringify({
            title: "review.title",
            description: "review.description",
          })}`,
        ),
      ).toBeTruthy();
    },
  );
});
