// @vitest-environment jsdom
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { LocaleRuntime } from "@dramaip/infra-locale/client";
import { SlotRegistry } from "@dramaip/infra-ui-renderer/client";
import type { PropsRenderSlots, TranslateNS } from "@dramaip/infra-ui-slots";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  automationPage,
  type AutomationPageProps,
} from "../src/client/AutomationPage.tsx";
import { apply, inject } from "../src/client/index.ts";

const owners = new Set<Fiber>();
afterEach(async () => {
  cleanup();
  for (const owner of owners) await owner.dispose();
  owners.clear();
});

const t = ((key: string) => key) as unknown as TranslateNS<"automation">;

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
  const remotes = Object.fromEntries(
    inject
      .filter((name) => name.startsWith("remote."))
      .map((name) => [name.slice("remote.".length), {}]),
  );
  ctx.provide("remote", remotes as never);
  for (const [name, remote] of Object.entries(remotes))
    ctx.provide(`remote.${name}`, remote as never);
  await slotsFiber.await();
  return { ctx, slots: ctx.get("slots") as SlotRegistry };
}

describe("automation client apply", () => {
  it("needs Slots, copy and the creation workbench's Remotes", () => {
    expect(inject).toEqual([
      "slots",
      "locale",
      "remote",
      "remote.agents",
      "remote.automation",
      "remote.delivery",
      "remote.knowledge",
      "remote.media",
      "remote.production",
      "remote.quality",
      "remote.system",
      "remote.timeline",
      "remote.workspace",
      "remote.writing",
    ]);
  });

  it("takes /tasks and /pending once the Studio client declares its routes", async () => {
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
          { entryKey: "/tasks" },
        ),
    );
    expect(
      slots.entries("studio.route").map((entry) => entry.options.key),
    ).toEqual(["/tasks", "/pending"]);
  });

  it("defines the creation workbench, source coverage and change preview factories", async () => {
    const { ctx, slots } = await bench();
    const define = vi.spyOn(slots, "registerFactory");
    await ctx.plugin({ inject: [...inject], apply }).await();
    expect(
      define.mock.calls.map(([options]) => [
        options.name,
        options.scope,
        options.locale,
      ]),
    ).toEqual([
      ["automation.creation-workbench", "root", "creation"],
      ["automation.creation-record", "root", "creation"],
      ["automation.creation-run", "root", "creation"],
      ["automation.source-coverage", "root", "creation"],
      ["automation.change-preview", "root", "automation"],
    ]);
  });
});

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const never = () => new Promise<never>(() => {});

/** A namespace whose every summary read answers an empty page. */
function face(own: Record<string, unknown> = {}) {
  return new Proxy(own, {
    get: (target, name: string) =>
      target[name] ?? ((id: string) => ok({ projectId: id, items: [] })),
  });
}

function mount(page: "tasks" | "pending", search: string) {
  const tasksWorklist = vi.fn(() => ok({ items: [] }));
  const renderFactorySlot = vi.fn(() => null);
  const Page = automationPage(page);
  const props = {
    t,
    renderFactorySlot,
    navigate: vi.fn(),
    useRoute: () => ({ params: {}, search }),
    useProjectScope: () => ({
      projects: [],
      projectId: "p-1",
      select: vi.fn(),
    }),
    useAssistantIntent: () => ({
      current: undefined,
      clear: vi.fn(),
      save: vi.fn(),
    }),
    automation: face({ tasksWorklist, tasksList: () => ok([]) }),
    delivery: face(),
    knowledge: face({ storyBibleList: () => ok([]) }),
    media: face(),
    production: face(),
    quality: face(),
    timeline: face(),
    workspace: face({
      projectsList: () => ok([{ id: "p-1", title: "p-1 title" }]),
      projectsGet: (id: string) => ok({ id }),
      importExtractionsList: () => ok([]),
    }),
    writing: face(),
    system: {
      events: vi.fn(() => ({
        [Symbol.asyncIterator]: () => ({ next: never }),
        dispose: vi.fn(),
      })),
    },
  } as unknown as AutomationPageProps;
  render(<Page {...props} />);
  return { tasksWorklist, renderFactorySlot };
}

describe("the automation pages", () => {
  it("heads the task center and reads the project's worklist", async () => {
    const { tasksWorklist } = mount("tasks", "?projectId=p-1");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "tasks.title",
    );
    expect(screen.getByText("tasks.description")).toBeTruthy();
    expect(await screen.findByText("tasks.empty")).toBeTruthy();
    expect(tasksWorklist).toHaveBeenCalledWith({
      category: "pending-result",
      projectId: "p-1",
      limit: 25,
    });
  });

  it("opens the agents client's new-task settings with the app's scope and a run card", async () => {
    const { renderFactorySlot } = mount("tasks", "?projectId=p-1");
    expect(await screen.findByText("tasks.empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "tasks.config.open" }));
    const call = (
      renderFactorySlot.mock.calls as unknown as [string, unknown][]
    ).find(([name]) => name === "agents.task-config");
    expect(call?.[1]).toMatchObject({
      route: "/tasks?projectId=p-1",
      scope: { projectId: "p-1" },
      intent: { current: undefined },
    });
    const { renderRun } = call![1] as {
      renderRun: (id: string, projectId: string) => unknown;
    };
    renderRun("w-1", "p-1");
    expect(renderFactorySlot).toHaveBeenLastCalledWith(
      "automation.creation-run",
      { id: "w-1", projectId: "p-1" },
    );
  });

  it("says whether the pending center shows one project or all of them", async () => {
    mount("pending", "?projectId=p-1");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "pending.title",
    );
    expect(screen.getByText("pending.description.project")).toBeTruthy();
    expect(await screen.findByText("pending.empty")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    mount("pending", "?projectId=");
    expect(screen.getByText("pending.description.all")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "pending.invalidProject",
    );
  });
});
