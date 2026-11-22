import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { AuthStorage } from "../../../vendor/pi/packages/coding-agent/src/core/auth-storage.ts";
import { SettingsManager } from "../../../vendor/pi/packages/coding-agent/src/core/settings-manager.ts";
import { registerLazyOAuthFlows } from "../../../vendor/pi/packages/ai/src/lazy-oauth.ts";
import { createModels } from "../../../vendor/pi/packages/ai/src/models.ts";
import { builtinProviders } from "../../../vendor/pi/packages/ai/src/providers/all.ts";
import type {
  PiSubscriptionAction,
  PiSubscriptionAnswer,
  PiSubscriptionNotice,
  PiSubscriptionPrompt,
  PiSubscriptionStatus,
} from "../../../packages/host/contracts/src/pi-subscription.ts";

const runtimes = new Map<string, ReturnType<typeof createRuntime>>();

function createRuntime(path: string) {
  registerLazyOAuthFlows();
  const credentials = AuthStorage.create(path);
  const models = createModels({ credentials });
  for (const provider of builtinProviders()) {
    if (provider.auth.oauth?.isSubscription)
      models.setProvider({ ...provider, auth: { oauth: provider.auth.oauth } });
  }
  return { credentials, models };
}

export function piSubscriptionRuntime(path: string) {
  let runtime = runtimes.get(path);
  if (!runtime) {
    runtime = createRuntime(path);
    runtimes.set(path, runtime);
  }
  return runtime;
}

interface Attempt {
  provider: string;
  controller: AbortController;
  done: Promise<void>;
  notices: Map<PiSubscriptionNotice["type"], PiSubscriptionNotice>;
  prompt?: { description: PiSubscriptionPrompt; answer(value: string): void };
}

type LoginFailure = Pick<
  PiSubscriptionStatus,
  "failureReason" | "exchangeStatus"
>;

function loginFailure(error: unknown): LoginFailure {
  if (!(error instanceof Error)) return {};
  // Pi's upstream errors can contain provider response bodies or credentials.
  // Send only the failure stage and HTTP status to the renderer.
  if (/^Credential store modify failed for /.test(error.message))
    return { failureReason: "storage" };
  const rejected = /^OpenAI Codex token exchange failed \((\d{3})\):/.exec(
    error.message,
  );
  if (rejected)
    return { failureReason: "exchange", exchangeStatus: Number(rejected[1]) };
  if (
    error.name === "TimeoutError" ||
    (error instanceof TypeError && error.message === "fetch failed")
  )
    return { failureReason: "network" };
  return {};
}

/** Present Pi's native provider prompts and notices in the desktop settings. */
export function createPiSubscriptionLogin(
  path: string,
  openBrowser?: (url: string) => Promise<void>,
) {
  const { credentials, models } = piSubscriptionRuntime(path);
  const settings = SettingsManager.create(dirname(path), dirname(path), {
    projectTrusted: false,
  });
  const failures = new Map<string, LoginFailure>();
  const closing = new AbortController();
  let running: Attempt | undefined;

  const start = (provider: string) => {
    closing.signal.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([
      closing.signal,
      controller.signal,
      AbortSignal.timeout(10 * 60_000),
    ]);
    const attempt: Attempt = {
      provider,
      controller,
      done: Promise.resolve(),
      notices: new Map(),
    };
    running = attempt;
    failures.delete(provider);
    attempt.done = models
      .login(
        provider,
        "oauth",
        {
          signal,
          notify(event) {
            if (signal.aborted) return;
            attempt.notices.set(event.type, event);
            if (event.type === "auth_url")
              void openBrowser?.(event.url).catch(() => undefined);
          },
          async prompt({ signal: promptSignal, ...prompt }) {
            const wait = promptSignal
              ? AbortSignal.any([signal, promptSignal])
              : signal;
            return new Promise<string>((resolve, reject) => {
              wait.throwIfAborted();
              const clear = () => {
                delete attempt.prompt;
                wait.removeEventListener("abort", abort);
              };
              const abort = () => {
                clear();
                reject(wait.reason);
              };
              attempt.prompt = {
                description: { ...prompt, id: randomUUID() },
                answer(value) {
                  clear();
                  resolve(value);
                },
              };
              wait.addEventListener("abort", abort, { once: true });
            });
          },
        },
        { getDeviceId: () => settings.getOrCreateDeviceId() },
      )
      .then(
        () => {},
        (error: unknown) => {
          if (!controller.signal.aborted && !closing.signal.aborted)
            failures.set(
              provider,
              loginFailure(signal.aborted ? signal.reason : error),
            );
        },
      )
      .finally(async () => {
        controller.abort();
        await settings.flush();
        running = undefined;
      });
  };

  return {
    async act(
      provider: string,
      action: PiSubscriptionAction,
      answer?: PiSubscriptionAnswer,
    ): Promise<PiSubscriptionStatus> {
      if (!models.getProvider(provider))
        throw new Error("Pi 未为此服务商提供订阅登录。");
      const current = running?.provider === provider ? running : undefined;
      if (action === "start") {
        if (running && !current)
          throw new Error("请先结束正在进行的 Pi 授权。");
        if (!running) start(provider);
      } else if (action === "answer") {
        const prompt = current?.prompt;
        if (
          !prompt ||
          !answer ||
          answer.promptId !== prompt.description.id ||
          typeof answer.value !== "string" ||
          answer.value.length > 4096 ||
          (prompt.description.type === "select" &&
            !prompt.description.options?.some(({ id }) => id === answer.value))
        )
          throw new Error("当前授权步骤已结束，或提供的内容无效。");
        prompt.answer(answer.value);
      } else if (action === "cancel") {
        current?.controller.abort();
        await current?.done;
        failures.delete(provider);
      } else if (action === "logout") {
        if (current) throw new Error("请先取消进行中的 Pi 登录。");
        await models.logout(provider);
        failures.delete(provider);
      }
      const signedIn = (await credentials.list()).some(
        (entry) => entry.providerId === provider && entry.type === "oauth",
      );
      const modelIds = signedIn
        ? (await models.getAvailable(provider)).map(({ id }) => id)
        : [];
      const login = running?.provider === provider ? running : undefined;
      return {
        signedIn,
        modelIds,
        pending: Boolean(login),
        failed: failures.has(provider),
        ...failures.get(provider),
        notices: login ? [...login.notices.values()] : [],
        ...(login?.prompt ? { prompt: login.prompt.description } : {}),
      };
    },
    async ready(provider: string, model: string): Promise<boolean> {
      const signal = AbortSignal.timeout(20_000);
      return (
        (await models.getAvailable(provider, { signal })).some(
          ({ id }) => id === model,
        ) && Boolean(await models.getAuth(provider, { signal }))
      );
    },
    async close() {
      closing.abort();
      await running?.done;
    },
  };
}
