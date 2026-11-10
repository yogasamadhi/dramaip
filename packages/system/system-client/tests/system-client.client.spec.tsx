// @vitest-environment jsdom
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { LocaleRuntime } from "@dramaip/infra-locale/client";
import { SlotRegistry } from "@dramaip/infra-ui-renderer/client";
import {
  resolveSlotLabel,
  type PropsRenderSlots,
  type Translate,
} from "@dramaip/infra-ui-slots";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, inject } from "../src/client/index.ts";
import {
  AppearanceSection,
  type AppearanceSectionProps,
} from "../src/client/AppearanceSection.tsx";
import {
  DiagnosticsSection,
  type DiagnosticsSectionProps,
} from "../src/client/DiagnosticsSection.tsx";
import {
  SettingsPage,
  type SettingsPageProps,
} from "../src/client/SettingsPage.tsx";
import { zh } from "../src/client/locale.ts";

const owners = new Set<Fiber>();
afterEach(async () => {
  cleanup();
  for (const owner of owners) await owner.dispose();
  owners.clear();
});

/** Copy with its key and parameters visible, so assertions name the key. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}(${JSON.stringify(params)})` : key) as Translate<
  keyof typeof zh
>;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = (message: string) =>
  Promise.resolve({
    ok: false as const,
    error: { code: "system/host-unavailable", message },
  });

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
  const system = { diagnostics: vi.fn() };
  ctx.provide("remote", { system } as never);
  ctx.provide("remote.system", system as never);
  await slotsFiber.await();
  return { ctx, slots: ctx.get("slots") as SlotRegistry, system };
}

describe("system client apply", () => {
  it("needs Slots, copy and the system Remote namespace", () => {
    expect(inject).toEqual(["slots", "locale", "remote", "remote.system"]);
  });

  it("takes /settings once the Studio client declares its routes, then adds the appearance and diagnostics sections", async () => {
    const { ctx, slots, system } = await bench();
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
            navigate: () => {},
            useProjectScope: () => ({
              projects: [],
              projectId: "",
              select: () => {},
            }),
            useProductionScope: vi.fn(),
            useEpisodeScope: vi.fn(),
            useAssistantIntent: vi.fn(),
            useRoute: vi.fn(),
            useProjectRecord: vi.fn(),
            useNovelWorkspace: vi.fn(),
            useNovelQuickStart: vi.fn(),
          },
          { entryKey: "/settings" },
        ),
    );
    expect(slots.entries("studio.route").map((e) => e.options.key)).toEqual([
      "/settings",
    ]);
    expect(slots.spec("settings.section")).toEqual({
      kind: "list",
      scope: "root",
    });
    const [appearance, section] = slots.entries("settings.section");
    expect(appearance?.options).toMatchObject({
      id: "settings-appearance",
      order: 20,
    });
    expect(slots.spec("settings.general.item")).toEqual({
      kind: "list",
      scope: "root",
    });
    expect(resolveSlotLabel(appearance?.options.label)).toBe(
      ctx.locale.bind("system")("appearance.nav"),
    );
    expect(section?.options).toMatchObject({
      id: "settings-advanced",
      order: 40,
    });
    expect(resolveSlotLabel(section?.options.label)).toBe(
      ctx.locale.bind("system")("diagnostics.nav"),
    );
    expect(section?.inject?.()).toEqual({ system });
  });
});

describe("the settings page", () => {
  const props = (
    rows: { id: string; label: string | undefined }[],
    navigate = vi.fn(),
  ) => {
    const renderSlot = vi.fn(
      (
        _key: string,
        _owner: { close: () => void },
        opts?: { only?: string },
      ) => <p>{`section ${opts?.only}`}</p>,
    );
    return {
      renderSlot,
      navigate,
      value: {
        t,
        navigate,
        renderSlot,
        useSections: () => rows,
      } as unknown as SettingsPageProps,
    };
  };

  it("lists the labelled sections and renders every section under its anchor", () => {
    const { value } = props([
      { id: "settings-ai", label: "AI" },
      { id: "settings-ledger", label: undefined },
      { id: "settings-advanced", label: "Advanced" },
    ]);
    const { container } = render(<SettingsPage {...value} />);
    const nav = screen.getByRole("navigation", { name: "page.nav" });
    expect(
      [...nav.querySelectorAll("button")].map((button) => button.textContent),
    ).toEqual(["AI", "Advanced"]);
    expect(
      [...container.querySelectorAll("[id]")].map((node) => node.id),
    ).toEqual(["settings-ai", "settings-ledger", "settings-advanced"]);
    expect(screen.getByText("section settings-ledger")).toBeTruthy();
  });

  it("scrolls to a section and closes back to the app's home", () => {
    const { value, renderSlot, navigate } = props([
      { id: "settings-ai", label: "AI" },
    ]);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<SettingsPage {...value} />);
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    renderSlot.mock.calls[0]![1].close();
    expect(navigate).toHaveBeenCalledWith("/");
  });
});

describe("the appearance section", () => {
  it("stacks the general rows the owning features register", () => {
    const renderSlot = vi.fn(() => <p>rows</p>);
    const value = {
      t,
      renderSlot,
      close: () => {},
    } as unknown as AppearanceSectionProps;
    render(<AppearanceSection {...value} />);
    expect(
      screen.getByRole("heading", { name: "appearance.title" }),
    ).toBeTruthy();
    expect(screen.getByText("rows")).toBeTruthy();
    expect(renderSlot).toHaveBeenCalledWith("settings.general.item", {});
  });
});

describe("the diagnostics section", () => {
  const report = {
    traceId: "trace-1",
    plugins: [{ id: "a" }, { id: "b" }],
    migrations: [{ id: "m1" }],
    eventConsumers: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
    host: { healthy: true },
  };

  function mount(system: Record<string, unknown>) {
    const value = {
      t,
      system,
      close: () => {},
    } as unknown as DiagnosticsSectionProps;
    return render(<DiagnosticsSection {...value} />);
  }

  it("reports the vault state, collects the summary and exports the report", async () => {
    const saveTextFile = vi.fn(() => ok({ saved: true }));
    mount({
      credentialStatus: () => ok({ available: true }),
      diagnostics: () => ok(report),
      saveTextFile,
    });
    expect(
      await screen.findByText(
        'diagnostics.vault({"state":"diagnostics.vault.available"})',
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "diagnostics.collect" }),
      );
    });
    const summary = screen.getByLabelText("diagnostics.summary");
    expect(
      [...summary.querySelectorAll("dd")].map((node) => node.textContent),
    ).toEqual(["2", "1", "3", "diagnostics.host.healthy"]);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "diagnostics.export" }),
      );
    });
    expect(saveTextFile).toHaveBeenCalledWith({
      suggestedName: "diagnostics.fileName",
      content: JSON.stringify(report, null, 2),
    });
    expect(screen.getByText("diagnostics.exported")).toBeTruthy();
  });

  it("names a failed call instead of showing a stale summary", async () => {
    mount({
      credentialStatus: () => failed("Desktop Host is unavailable"),
      diagnostics: () => failed("Desktop Host is unavailable"),
      saveTextFile: vi.fn(),
    });
    expect(
      await screen.findByText(
        'diagnostics.vault({"state":"diagnostics.vault.unavailable"})',
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "diagnostics.collect" }),
      );
    });
    expect(
      screen.getByText(
        'diagnostics.failed({"message":"Desktop Host is unavailable"})',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("diagnostics.summary")).toBeNull();
  });
});
