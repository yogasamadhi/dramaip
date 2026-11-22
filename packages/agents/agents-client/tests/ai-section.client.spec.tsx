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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

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
      id: "openai-codex",
      name: "OpenAI Codex",
      protocol: "Pi",
      sourceUrl: "https://github.com/earendil-works/pi",
      subscriptionLabel: "OpenAI (ChatGPT Plus/Pro)",
      subscriptionOnly: true,
      models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
    },
    {
      id: "azure",
      name: "Azure",
      protocol: "Pi",
      baseUrl: "",
      sourceUrl: "https://github.com/earendil-works/pi",
      models: [{ id: "gpt-5.4", label: "GPT-5.4", recommended: true }],
    },
    {
      id: "anthropic",
      name: "Anthropic",
      protocol: "Pi",
      baseUrl: "https://api.anthropic.com",
      sourceUrl: "https://github.com/earendil-works/pi",
      subscriptionLabel: "Claude Pro/Max",
      models: [{ id: "claude-sonnet", label: "Claude Sonnet" }],
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
  options: {
    providers?: ProviderRecord[];
    vault?: VaultState;
    activeProviderId?: string;
    followActivation?: boolean;
    cloudSignedIn?: boolean;
    /** Vault reads answered in turn before the vault state. */
    vaultReads?: Promise<unknown>[];
  } = {},
) {
  const vaultReads = [...(options.vaultReads ?? [])];
  const providers = options.providers ?? [];
  let activeProviderId = options.activeProviderId;
  let cloudSignedIn = options.cloudSignedIn ?? true;
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
    providersActivateForAgent: vi.fn((id: string): Promise<unknown> => {
      if (options.followActivation) activeProviderId = id;
      return ok({ message: "activated" });
    }),
    enginesList: vi.fn(() =>
      ok([{ kind: "pi", name: "Pi", version: "1.0", status: "available" }]),
    ),
    enginesGetGlobalSettings: vi.fn(() =>
      ok({
        defaultEngineKind: "pi",
        ...(activeProviderId ? { activeProviderId } : {}),
      }),
    ),
    enginesGetProjectSettings: vi.fn(() => ok({ defaultEngineKind: "pi" })),
    enginesUpdateGlobalSettings: vi.fn(
      (settings: { defaultEngineKind: string }) => ok(settings),
    ),
    enginesUpdateProjectSettings: vi.fn(() => ok(null)),
  };
  let piPending = false;
  let piSignedIn = false;
  const system = {
    piSubscription: vi.fn((_provider: string, action: string) => {
      if (action === "start") piPending = true;
      if (action === "answer") {
        piPending = false;
        piSignedIn = true;
      }
      return ok({
        signedIn: piSignedIn,
        pending: piPending,
        notices: [],
        modelIds: piSignedIn ? ["gpt-5.5"] : [],
        ...(piPending
          ? {
              prompt: {
                id: "pi-prompt",
                type: "manual_code",
                message: "Paste callback",
              },
            }
          : {}),
        failed: false,
      });
    }),
    cloudAiSummary: vi.fn(() =>
      ok({
        available: true,
        pending: false,
        signedIn: cloudSignedIn,
        models: cloudSignedIn ? ["hosted-flash"] : [],
        email: cloudSignedIn ? "writer@example.com" : undefined,
      }),
    ),
    cloudAiSignIn: vi.fn(() => {
      cloudSignedIn = true;
      return ok(null);
    }),

    credentialStatus: vi.fn(
      (): Promise<unknown> =>
        vaultReads.shift() ?? ok(options.vault ?? unlocked),
    ),
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
  it("uses Pi authorization to save a Codex model without capturing an API key", async () => {
    const { agents, system } = mount();
    const api = within(
      screen.getByRole("tabpanel", { name: "providers.api.mode" }),
    );
    await api.findByRole("option", { name: "Anthropic" });
    expect(api.queryByRole("option", { name: "OpenAI Codex" })).toBeNull();
    expect(api.getByRole("option", { name: "providers.other" })).toBeTruthy();
    expect(system.piSubscription).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("tab", { name: "providers.pi.mode" }), {
      key: "Enter",
    });
    const pi = within(
      screen.getByRole("tabpanel", { name: "providers.pi.mode" }),
    );
    expect(pi.getByRole("option", { name: "OpenAI Codex" })).toBeTruthy();
    expect(pi.getByRole("option", { name: "Anthropic" })).toBeTruthy();
    expect(pi.queryByRole("option", { name: "DeepSeek" })).toBeNull();
    expect(pi.queryByRole("option", { name: "providers.other" })).toBeNull();
    expect(pi.queryByRole("button", { name: "providers.key.new" })).toBeNull();
    fireEvent.change(pi.getByLabelText("providers.pi.provider"), {
      target: { value: "openai-codex" },
    });
    const save = screen.getByRole<HTMLButtonElement>("button", {
      name: "providers.add",
    });
    expect(save.disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "providers.pi.signIn" }),
    );
    await screen.findByText("providers.pi.pending");
    fireEvent.click(screen.getByText("providers.pi.manual"));
    fireEvent.change(screen.getByLabelText("providers.pi.code"), {
      target: { value: "fixture-code" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "providers.pi.submit" }),
    );
    await screen.findByText("providers.pi.connected");
    expect(system.piSubscription).toHaveBeenCalledWith(
      "openai-codex",
      "answer",
      { promptId: "pi-prompt", value: "fixture-code" },
    );
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await screen.findByText(
      'providers.connected({"name":"OpenAI (ChatGPT Plus/Pro)"})',
    );
    expect(system.createCredentialCaptureSession).not.toHaveBeenCalled();
    const [input] = agents.providersCreate.mock.calls[0] as unknown as [
      { payload: Record<string, unknown> },
    ];
    expect(input.payload).toMatchObject({
      Pi服务商: "openai-codex",
      模型名称: "gpt-5.5",
      认证方式: "piSubscription",
    });
    expect(input.payload).not.toHaveProperty("凭据引用");
    expect(input.payload).not.toHaveProperty("服务地址");
    expect(agents.providersActivateForAgent).toHaveBeenCalledOnce();
  });

  it("opens a saved subscription in its own tab and keeps API key settings separate", async () => {
    const subscription = {
      id: "provider-codex",
      title: "Codex subscription",
      version: 1,
      payload: {
        服务类型: "智能模型",
        模型名称: "gpt-5.5",
        Pi服务商: "openai-codex",
        认证方式: "piSubscription",
      },
    };
    mount({
      providers: [saved, subscription],
      activeProviderId: subscription.id,
    });
    const pi = within(
      await screen.findByRole("tabpanel", { name: "providers.pi.mode" }),
    );
    const card = within(pi.getByRole("article", { name: /Codex subscription/u }));
    expect(pi.queryByRole("article", { name: /DeepSeek/u })).toBeNull();
    await pi.findByRole("option", { name: "OpenAI Codex" });
    fireEvent.click(card.getByRole("button", { name: "providers.edit" }));

    const apiTab = screen.getByRole("tab", { name: "providers.api.mode" });
    fireEvent.keyDown(apiTab, { key: "Enter" });
    const api = within(
      screen.getByRole("tabpanel", { name: "providers.api.mode" }),
    );
    expect(api.getByRole("article", { name: /DeepSeek/u })).toBeTruthy();
    expect(api.queryByRole("article", { name: /Codex subscription/u })).toBeNull();
    expect(api.queryByRole("button", { name: "providers.saveEdit" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("tab", { name: "providers.pi.mode" }), {
      key: "Enter",
    });
    expect(pi.getByRole("button", { name: "providers.saveEdit" })).toBeTruthy();
  });

  it("starts cloud sign-in directly from the Cloud AI card", async () => {
    const { agents, system } = mount({
      providers: [saved],
      activeProviderId: saved.id,
      cloudSignedIn: false,
    });
    const cloud = within(screen.getByRole("region", { name: "cloud.title" }));
    const signIn = await cloud.findByRole("button", { name: "cloud.signIn" });
    expect(cloud.queryByRole("button", { name: "cloud.activate" })).toBeNull();
    expect(
      cloud.queryByRole("button", { name: "cloud.accountHeading" }),
    ).toBeNull();
    fireEvent.click(signIn);
    expect(system.cloudAiSignIn).toHaveBeenCalledOnce();
    expect(await screen.findByLabelText("cloud.model")).toBeTruthy();
    const account = within(
      screen.getByRole("region", { name: "cloud.accountHeading" }),
    );
    expect(account.getByText("writer@example.com")).toBeTruthy();
    expect(agents.providersActivateForAgent).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("region", { name: "cloud.byok" })).getByText(
        "cloud.active",
      ),
    ).toBeTruthy();
  });

  it("uses a saved cloud model and switches back to the saved BYOK provider", async () => {
    const cloud = {
      id: "provider-cloud",
      title: "Cloud AI",
      version: 1,
      payload: {
        服务类型: "智能模型",
        模型名称: "hosted-flash",
        认证方式: "hosted",
      },
    };
    const { agents, system, announce } = mount({
      providers: [saved, cloud],
      activeProviderId: saved.id,
      followActivation: true,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "cloud.accountHeading" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "cloud.activate" }),
    );
    await waitFor(() => expect(announce).toHaveBeenCalledWith(cloud.id));
    expect(agents.providersActivateForAgent).toHaveBeenCalledWith(
      cloud.id,
      undefined,
      undefined,
      expect.any(String),
    );
    expect(agents.providersCreate).not.toHaveBeenCalled();
    expect(system.createCredentialCaptureSession).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "cloud.title" })).getByText(
          "cloud.active",
        ),
      ).toBeTruthy(),
    );
    const byok = await screen.findByRole("button", {
      name: "cloud.activateByok",
    });
    fireEvent.click(byok);
    await waitFor(() => expect(announce).toHaveBeenLastCalledWith(saved.id));
    expect(agents.providersActivateForAgent).toHaveBeenLastCalledWith(
      saved.id,
      undefined,
      undefined,
      expect.any(String),
    );
    expect(agents.providersDelete).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "cloud.byok" })).getByText(
          "cloud.active",
        ),
      ).toBeTruthy(),
    );
  });

  it("saves a cloud model without switching away from BYOK", async () => {
    const { agents } = mount({
      providers: [saved],
      activeProviderId: saved.id,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "cloud.accountHeading" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "cloud.save" }));
    await screen.findByText("cloud.saved");
    expect(agents.providersActivateForAgent).not.toHaveBeenCalled();
    expect(localStorage.getItem("dramaip.ai.cloud-model")).toBe("hosted-flash");
  });

  it("authorizes and saves the selected model's native endpoint", async () => {
    const { agents, system } = mount();
    const api = within(
      screen.getByRole("tabpanel", { name: "providers.api.mode" }),
    );
    fireEvent.change(await api.findByLabelText("providers.model"), {
      target: { value: "deepseek-reasoner" },
    });
    fireEvent.click(screen.getByRole("button", { name: "providers.add" }));
    await screen.findByText('providers.connected({"name":"DeepSeek"})');
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
    await screen.findByText('providers.connected({"name":"Azure"})');
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
      within(screen.getByRole("tabpanel", { name: "providers.api.mode" }))
        .getByLabelText<HTMLSelectElement>("providers.model").value,
    ).toBe("deepseek-chat");
    fireEvent.click(screen.getByRole("button", { name: "providers.add" }));
    await screen.findByText('providers.connected({"name":"DeepSeek"})');
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
    // One save connects the model and makes it every project's default.
    expect(agents.providersActivateForAgent).toHaveBeenCalledWith(
      "provider-2",
      undefined,
      undefined,
      expect.any(String),
    );
    expect(agents.enginesUpdateGlobalSettings).toHaveBeenCalledWith(
      { defaultEngineKind: "pi", defaultModel: { modelId: "deepseek-chat" } },
      undefined,
      expect.any(String),
    );
    expect(announce).toHaveBeenLastCalledWith("provider-2");
  });

  it("saves without connecting when the default box is cleared", async () => {
    const { agents } = mount();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "providers.makeDefault" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "providers.add" }));
    await screen.findByText('providers.saved({"name":"DeepSeek"})');
    expect(agents.providersActivateForAgent).not.toHaveBeenCalled();
    expect(agents.enginesUpdateGlobalSettings).not.toHaveBeenCalled();
  });

  it("explains a model that saved but could not be applied", async () => {
    const { agents } = mount();
    agents.providersActivateForAgent.mockImplementation(() =>
      failed("service down"),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "providers.add" }),
    );
    await screen.findByText(
      'providers.connectFailed({"name":"DeepSeek","message":"service down"})',
    );
  });

  it("marks the default model and offers no activation on it", async () => {
    mount({ providers: [saved], activeProviderId: "provider-1" });
    const card = await screen.findByRole("article", {
      name: 'providers.card({"name":"DeepSeek"})',
    });
    await within(card).findByText("providers.isDefault");
    expect(
      within(card).queryByRole("button", { name: "providers.activate" }),
    ).toBeNull();
  });

  it("says the vault is being prepared, then retries a failed read", async () => {
    const { system } = mount({ vaultReads: [failed("not yet")] });
    await screen.findByText("providers.vaultLoading");
    await waitFor(
      () => expect(system.credentialStatus).toHaveBeenCalledTimes(2),
      {
        timeout: 3_000,
      },
    );
    await waitFor(() =>
      expect(screen.queryByText("providers.vaultLoading")).toBeNull(),
    );
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
    await screen.findByText('providers.connected({"name":"DeepSeek"})');
    expect(agents.enginesUpdateGlobalSettings).toHaveBeenCalledWith(
      { defaultEngineKind: "pi", defaultModel: { modelId: "deepseek-chat" } },
      undefined,
      expect.any(String),
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
    await within(status).findByText("engines.available");
    // The engine behind the AI is not named.
    expect(within(status).queryByText("Pi")).toBeNull();
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
