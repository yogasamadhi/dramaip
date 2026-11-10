// @vitest-environment jsdom
import type { Translate } from "@dramaip/infra-ui-slots";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSection, type AiSectionProps } from "../src/client/AiSection.tsx";
import type { ProviderRecord, VaultState } from "../src/client/ai-settings.ts";
import { zh } from "../src/client/locale.ts";

afterEach(cleanup);

// jsdom lays nothing out; the edit form scrolls itself into view.
Element.prototype.scrollIntoView = () => {};

/** Copy with its key and parameters visible, so assertions name the key. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}(${JSON.stringify(params)})` : key) as Translate<
  keyof typeof zh
>;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const failed = (message: string) =>
  Promise.resolve({
    ok: false as const,
    error: { code: "agents/failed", message },
  });

const catalog = {
  release: "Pi 1.5.0",
  updatedAt: "2026-11-04",
  providers: [
    {
      id: "deepseek",
      name: "DeepSeek",
      protocol: "OpenAI 兼容文本",
      baseUrl: "https://api.deepseek.com",
      apiKeyUrl: "https://platform.deepseek.com/api_keys",
      sourceUrl: "https://api-docs.deepseek.com",
      models: [
        { id: "deepseek-chat", label: "DeepSeek Chat", recommended: true },
        {
          id: "deepseek-reasoner",
          label: "DeepSeek Reasoner",
          baseUrl: "https://reasoning.example/v1",
        },
      ],
    },
    {
      id: "azure",
      name: "Azure",
      protocol: "Pi",
      baseUrl: "",
      sourceUrl: "https://github.com/earendil-works/pi",
      models: [{ id: "gpt-5.4", label: "GPT-5.4", recommended: true }],
    },
  ],
};

const saved: ProviderRecord = {
  id: "provider-1",
  title: "DeepSeek",
  version: 3,
  payload: {
    服务类型: "智能模型",
    模型名称: "deepseek-chat",
    服务地址: "https://api.deepseek.com",
    调用协议: "OpenAI 兼容文本",
    凭据引用: "cred-old",
    预设服务商: "deepseek",
  },
};

const unlocked: VaultState = {
  available: true,
  storage: "local_file",
  locked: false,
};

function mount(
  options: { providers?: ProviderRecord[]; vault?: VaultState } = {},
) {
  const providers = options.providers ?? [];
  const agents = {
    providersCatalog: vi.fn(() => ok(catalog)),
    providersList: vi.fn(() => ok(providers)),
    providersCreate: vi.fn(() => ok({ id: "provider-2" })),
    providersUpdate: vi.fn(() => ok(saved)),
    providersDelete: vi.fn(() => ok(null)),
    providersGet: vi.fn(() => ok(saved)),
    providersTestConnection: vi.fn((): Promise<unknown> =>
      ok({ ok: true, message: "connected" }),
    ),
    providersActivateForAgent: vi.fn(() => ok({ message: "activated" })),
    enginesList: vi.fn(() =>
      ok([{ kind: "pi", name: "Pi", version: "1.0", status: "available" }]),
    ),
    enginesGetGlobalSettings: vi.fn(() => ok({ defaultEngineKind: "pi" })),
    enginesGetProjectSettings: vi.fn(() => ok({ defaultEngineKind: "pi" })),
    enginesUpdateGlobalSettings: vi.fn(
      (settings: { defaultEngineKind: string }) => ok(settings),
    ),
    enginesUpdateProjectSettings: vi.fn(() => ok(null)),
  };
  const system = {
    credentialStatus: vi.fn(() => ok(options.vault ?? unlocked)),
    createCredentialCaptureSession: vi.fn(() =>
      ok({
        captureSessionId: "capture-1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ),
    createCredentialUnlockSession: vi.fn(),
    credentialSession: vi.fn(() =>
      ok({ status: "completed", credentialRef: "cred-new" }),
    ),
    removeCredential: vi.fn(() => ok(null)),
    openExternal: vi.fn(() => ok(null)),
  };
  const workspace = {
    projectsList: vi.fn(() => ok([{ id: "project-1", title: "Novel" }])),
  };
  const announce = vi.fn();
  const props = {
    t,
    close: () => {},
    agents,
    system,
    workspace,
    announce,
  } as unknown as AiSectionProps;
  render(<AiSection {...props} />);
  return { agents, system, workspace, announce };
}

describe("the AI connection settings section", () => {
  it("authorizes and saves the selected model's native endpoint", async () => {
    const { agents, system } = mount();
    fireEvent.change(await screen.findByLabelText("providers.model"), {
      target: { value: "deepseek-reasoner" },
    });
    fireEvent.click(screen.getByRole("button", { name: "providers.add" }));
    await screen.findByText('providers.saved({"name":"DeepSeek"})');
    expect(system.createCredentialCaptureSession).toHaveBeenCalledWith(
      expect.objectContaining({ allowedOrigin: "https://reasoning.example" }),
    );
    expect(agents.providersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          Pi服务商: "deepseek",
          服务地址: "https://reasoning.example/v1",
          模型名称: "deepseek-reasoner",
        }),
      }),
      undefined,
      expect.any(String),
    );
  });

  it("requires an account-specific endpoint before capturing an Azure key", async () => {
    const { agents, system } = mount();
    fireEvent.change(await screen.findByLabelText("providers.preset"), {
      target: { value: "azure" },
    });
    fireEvent.click(screen.getByRole("button", { name: "providers.add" }));
    await screen.findByText("providers.endpointRequired");
    expect(system.createCredentialCaptureSession).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("providers.baseUrl"), {
      target: { value: "https://my-resource.openai.azure.com/openai/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "providers.add" }));
    await screen.findByText('providers.saved({"name":"Azure"})');
    expect(agents.providersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          Pi服务商: "azure",
          服务地址: "https://my-resource.openai.azure.com/openai/v1",
        }),
      }),
      undefined,
      expect.any(String),
    );
  });

  it("adds a catalog provider: the key goes through the capture window and the provider keeps only its reference", async () => {
    const { agents, system, announce } = mount();
    await screen.findByText(
      'providers.catalog({"date":"2026-11-04","release":"Pi 1.5.0"})',
    );
    expect(
      ((await screen.findByLabelText("providers.model")) as HTMLSelectElement)
        .value,
    ).toBe("deepseek-chat");
    fireEvent.click(screen.getByRole("button", { name: "providers.add" }));
    await screen.findByText('providers.saved({"name":"DeepSeek"})');
    expect(system.createCredentialCaptureSession).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "provider-authentication",
        policyId: "provider.catalog.deepseek",
        allowedOrigin: "https://api.deepseek.com",
      }),
    );
    const [input, ifMatch, key] = agents.providersCreate.mock
      .calls[0] as unknown as [
      { title: string; payload: Record<string, unknown> },
      unknown,
      string,
    ];
    expect(input.title).toBe("DeepSeek");
    expect(input.payload).toMatchObject({
      服务类型: "智能模型",
      模型名称: "deepseek-chat",
      凭据引用: "cred-new",
      预设服务商: "deepseek",
      Pi服务商: "deepseek",
      模型目录版本: "Pi 1.5.0",
    });
    expect(ifMatch).toBeUndefined();
    expect(typeof key).toBe("string");
    expect(announce).toHaveBeenCalledWith(undefined);
    expect(agents.providersList).toHaveBeenCalledTimes(2);
  });

  it("refuses to ask for a key while the vault is unavailable", async () => {
    const { agents, system } = mount({
      vault: {
        available: false,
        storage: "unavailable",
        locked: false,
        message: "no vault here",
      },
    });
    await screen.findByText("no vault here");
    fireEvent.click(screen.getByRole("button", { name: "providers.add" }));
    await screen.findByText("providers.vaultRequired");
    expect(system.createCredentialCaptureSession).not.toHaveBeenCalled();
    expect(agents.providersCreate).not.toHaveBeenCalled();
  });

  it("edits a saved provider in place and keeps its key", async () => {
    const { agents, system } = mount({ providers: [saved] });
    const card = await screen.findByRole("article", {
      name: 'providers.card({"name":"DeepSeek"})',
    });
    fireEvent.click(
      within(card).getByRole("button", { name: "providers.edit" }),
    );
    expect(
      screen
        .getByRole("status")
        .textContent?.includes('providers.editing({"name":"DeepSeek"})'),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "providers.saveEdit" }));
    await screen.findByText('providers.saved({"name":"DeepSeek"})');
    expect(system.createCredentialCaptureSession).not.toHaveBeenCalled();
    expect(agents.providersUpdate).toHaveBeenCalledWith(
      "provider-1",
      expect.objectContaining({
        version: 3,
        payload: expect.objectContaining({ 凭据引用: "cred-old" }),
      }),
      '"3"',
      expect.any(String),
    );
  });

  it("tells the page which provider passed its test, and which became the assistant's", async () => {
    const { agents, announce } = mount({ providers: [saved] });
    const card = await screen.findByRole("article", {
      name: 'providers.card({"name":"DeepSeek"})',
    });
    fireEvent.click(
      within(card).getByRole("button", { name: "providers.test" }),
    );
    await screen.findByText(
      'ai.result({"name":"DeepSeek","message":"connected"})',
    );
    expect(announce).toHaveBeenCalledWith("provider-1");
    const enginesReads = agents.enginesList.mock.calls.length;
    fireEvent.click(
      within(card).getByRole("button", { name: "providers.activate" }),
    );
    await screen.findByText(
      'ai.result({"name":"DeepSeek","message":"activated"})',
    );
    expect(announce).toHaveBeenLastCalledWith("provider-1");
    await waitFor(() =>
      expect(agents.enginesList.mock.calls.length).toBeGreaterThan(
        enginesReads,
      ),
    );
  });

  it("shows a failed test's message and announces nothing", async () => {
    const { agents, announce } = mount({ providers: [saved] });
    agents.providersTestConnection.mockImplementation(() =>
      failed("unreachable"),
    );
    const card = await screen.findByRole("article", {
      name: 'providers.card({"name":"DeepSeek"})',
    });
    fireEvent.click(
      within(card).getByRole("button", { name: "providers.test" }),
    );
    await screen.findByText("unreachable");
    expect(announce).not.toHaveBeenCalled();
  });

  it("deletes a provider after the confirmation, and its stored key with it", async () => {
    const { agents, system } = mount({ providers: [saved] });
    const card = await screen.findByRole("article", {
      name: 'providers.card({"name":"DeepSeek"})',
    });
    fireEvent.click(
      within(card).getByRole("button", { name: "providers.remove" }),
    );
    expect(agents.providersDelete).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "providers.remove.action" }),
    );
    await waitFor(() =>
      expect(system.removeCredential).toHaveBeenCalledWith("cred-old"),
    );
    expect(agents.providersDelete).toHaveBeenCalledWith(
      "provider-1",
      undefined,
      expect.any(String),
    );
  });

  it("lists the engines and saves the global default", async () => {
    const { agents } = mount();
    const status = await screen.findByLabelText("engines.status");
    await within(status).findByText("Pi");
    expect(within(status).getByText("Pi")).toBeTruthy();
    expect(within(status).getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByLabelText("engines.globalEngine")).toBeNull();
    expect(screen.queryByLabelText("engines.projectEngine")).toBeNull();
    fireEvent.change(screen.getByLabelText("engines.globalModel"), {
      target: { value: " gpt-5 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "engines.saveGlobal" }));
    await screen.findByText("engines.savedGlobal");
    expect(agents.enginesUpdateGlobalSettings).toHaveBeenCalledWith(
      { defaultEngineKind: "pi", defaultModel: { modelId: "gpt-5" } },
      undefined,
      expect.any(String),
    );
  });

  it("saves a project's default only once a project is chosen", async () => {
    const { agents } = mount();
    await screen.findByRole("option", { name: "Novel" });
    const save = screen.getByRole("button", { name: "engines.saveProject" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("engines.project"), {
      target: { value: "project-1" },
    });
    await waitFor(() =>
      expect(agents.enginesGetProjectSettings).toHaveBeenCalledWith(
        "project-1",
      ),
    );
    fireEvent.click(save);
    await screen.findByText("engines.savedProject");
    expect(agents.enginesUpdateProjectSettings).toHaveBeenCalledWith(
      "project-1",
      { defaultEngineKind: "pi" },
      undefined,
      expect.any(String),
    );
  });
});
