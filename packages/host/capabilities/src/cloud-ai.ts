import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import type { CloudAiSummary } from "@dramaip/host-contracts";
import type { HostCredentials } from "./credentials.ts";

const CONTRACT = "X-DramaIP-Contract-Version";
const MAX_BODY = 2 << 20;

interface Session {
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
}

class CloudError extends Error {
  constructor(
    readonly status: number,
    code: string,
  ) {
    super(code);
  }
}

function endpoint(value: string): URL {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error(
      "Cloud endpoint requires an HTTPS origin or development loopback",
    );
  return url;
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** Only this Host capability handles account tokens. Pi gets a loopback-only credential. */
export class CloudAi {
  private readonly api: URL;
  private readonly portal: URL;
  private readonly sessionPath: string;
  private readonly secret = randomBytes(32).toString("base64url");
  private readonly ready: Promise<void>;
  private session: Session | undefined;
  private login: AbortController | undefined;
  private refresh: Promise<Session> | undefined;
  private proxy: Server | undefined;
  private proxyPort: Promise<number> | undefined;
  private requestSession = new AbortController();
  private notice: string | undefined;
  private signingOut = false;
  private closed = false;

  constructor(
    private readonly directory: string,
    private readonly credentials: HostCredentials,
    private readonly openExternal: (url: string) => Promise<void>,
    api = process.env.DRAMAIP_CLOUD_API_URL ?? "https://api.dramaip.cn",
    portal = process.env.DRAMAIP_CLOUD_PORTAL_URL ?? "https://dramaip.cn",
  ) {
    this.api = endpoint(api);
    this.portal = endpoint(portal);
    this.sessionPath = join(directory, "cloud-ai-session.ref");
    this.ready = this.load();
  }

  private policy() {
    return { purpose: "dramaip-cloud-session", allowedOrigin: this.api.origin };
  }

  private async load(): Promise<void> {
    const ref = await readFile(this.sessionPath, "utf8").catch(() => "");
    if (!ref) return;
    const value = await this.credentials.resolve(ref.trim(), {
      purpose: this.policy().purpose,
      origin: this.api.origin,
    });
    if (value) {
      try {
        this.session = JSON.parse(value) as Session;
      } catch {
        this.notice = "CLOUD_AI_SIGN_IN_REQUIRED";
      }
    }
  }

  private async save(session: Session): Promise<void> {
    const old = await readFile(this.sessionPath, "utf8").catch(() => "");
    const { credentialRef } = await this.credentials.vault.store(
      JSON.stringify(session),
      this.policy(),
    );
    const temp = this.sessionPath + "." + randomUUID();
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(temp, credentialRef, { mode: 0o600, flag: "wx" });
      await rename(temp, this.sessionPath);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      await this.credentials
        .removeCredential(credentialRef)
        .catch(() => undefined);
      throw error;
    }
    this.session = session;
    if (old)
      await this.credentials
        .removeCredential(old.trim())
        .catch(() => undefined);
  }

  private async call<T>(
    path: string,
    options: {
      body?: object;
      session?: Session;
      deviceId?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const timeout = AbortSignal.timeout(12_000);
    const response = await fetch(new URL(path, this.api), {
      method: options.body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: {
        [CONTRACT]: "2",
        ...(options.session
          ? { Authorization: "Bearer " + options.session.accessToken }
          : {}),
        ...(options.deviceId ? { "X-Device-Id": options.deviceId } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
      signal: options.signal
        ? AbortSignal.any([timeout, options.signal])
        : timeout,
    });
    const result = (await response.json().catch(() => null)) as {
      data: T;
      code?: string;
    } | null;
    if (!response.ok || result?.code !== "OK")
      throw new CloudError(
        response.status,
        result?.code ?? "CLOUD_AI_UNAVAILABLE",
      );
    return result.data;
  }

  private async issue(
    path: string,
    body: object,
    deviceId: string,
    signal?: AbortSignal,
  ) {
    const value = await this.call<
      Omit<Session, "deviceId" | "expiresAt"> & { expiresIn: number }
    >(path, { body, deviceId, ...(signal ? { signal } : {}) });
    if (
      !value.accessToken ||
      !value.refreshToken ||
      !Number.isFinite(value.expiresIn) ||
      value.expiresIn <= 0 ||
      typeof value.email !== "string"
    )
      throw new Error("Invalid account response");
    const { accessToken, refreshToken, email } = value;
    const session = {
      deviceId,
      accessToken,
      refreshToken,
      email,
      expiresAt: Date.now() + value.expiresIn * 1000,
    };
    await this.save(session);
    return session;
  }

  private async credential(): Promise<Session> {
    await this.ready;
    const session = this.session;
    if (!session || this.signingOut || this.closed)
      throw new CloudError(401, "CLOUD_AI_SIGN_IN_REQUIRED");
    if (session.expiresAt > Date.now() + 30_000) return session;
    this.refresh ??= this.issue(
      "/api/v1/auth/token/refresh",
      { refreshToken: session.refreshToken },
      session.deviceId,
    )
      .catch(async (error: unknown) => {
        if (error instanceof CloudError && error.status === 401)
          await this.clearSession();
        throw error;
      })
      .finally(() => {
        this.refresh = undefined;
      });
    return this.refresh;
  }

  async summary(): Promise<CloudAiSummary> {
    await this.ready;
    const status = {
      available: true,
      pending: this.login !== undefined,
      signedIn: this.session !== undefined,
      ...(this.session
        ? {
            email: this.session.email,
            accountUrl: new URL("/account", this.portal).href,
          }
        : {}),
      ...(this.notice ? { message: this.notice } : {}),
    };
    if (!this.session || this.signingOut) return { ...status, models: [] };
    try {
      const session = await this.credential();
      const [models, balance] = await Promise.all([
        this.call<Array<string | { id: string; name: string }>>(
          "/api/v1/models?view=catalogue",
          { session },
        ),
        this.call<{ remainingTokens: number }>("/api/v1/quota/balance", {
          session,
        }).catch(() => undefined),
      ]);
      return {
        ...status,
        models: models.map((model) =>
          typeof model === "string" ? model : model.id,
        ),
        modelNames: Object.fromEntries(
          models.flatMap((model) =>
            typeof model === "string" ? [] : [[model.id, model.name]],
          ),
        ),
        ...(balance ? { remainingTokens: balance.remainingTokens } : {}),
      };
    } catch {
      return {
        ...status,
        models: [],
        signedIn: this.session !== undefined,
        message: this.session
          ? "CLOUD_AI_UNAVAILABLE"
          : "CLOUD_AI_SIGN_IN_REQUIRED",
      };
    }
  }

  async signIn(): Promise<void> {
    await this.ready;
    if (this.login || this.session || this.signingOut || this.closed) return;
    const vault = await this.credentials.credentialStorageStatus();
    if (!vault.available) throw new Error("请先解锁本地凭据保险库。");
    if (this.login || this.session || this.signingOut || this.closed) return;
    const controller = new AbortController();
    this.login = controller;
    this.notice = undefined;
    void this.authorize(
      AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
    )
      .catch(() => {
        if (!controller.signal.aborted) this.notice = "CLOUD_AI_LOGIN_FAILED";
      })
      .finally(() => {
        if (this.login === controller) this.login = undefined;
      });
  }

  private async authorize(signal: AbortSignal): Promise<void> {
    const deviceId = randomUUID();
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    let accept: (code: string) => void = () => undefined;
    const server = createServer((req, res) => {
      if (!req.url?.startsWith("/callback?")) {
        res.writeHead(400).end("Invalid authorization");
        return;
      }
      const url = new URL(req.url, "http://127.0.0.1");
      const code = url.searchParams.get("code");
      if (
        req.method !== "GET" ||
        url.pathname !== "/callback" ||
        url.searchParams.get("state") !== state ||
        !code ||
        !/^[A-Za-z0-9_-]{43}$/.test(code)
      ) {
        res.writeHead(400).end("Invalid authorization");
        return;
      }
      res
        .writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        })
        .end("尽意账号已授权。请返回桌面应用。");
      accept(code);
    });
    try {
      const port = await listen(server);
      const redirectUri = "http://127.0.0.1:" + port + "/callback";
      const url = new URL("/desktop/authorize", this.portal);
      url.search = new URLSearchParams({
        state,
        code_challenge: challenge,
        redirect_uri: redirectUri,
        device_id: deviceId,
      }).toString();
      const code = new Promise<string>((resolve) => {
        accept = resolve;
      });
      signal.throwIfAborted();
      await this.openExternal(url.href);
      const authorizationCode = await new Promise<string>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        void code.then((value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        });
      });
      await this.issue(
        "/api/v1/auth/desktop/token",
        { authorizationCode, codeVerifier: verifier, redirectUri, deviceId },
        deviceId,
        signal,
      );
    } finally {
      server.close();
      server.closeAllConnections();
    }
  }

  private async clearSession(): Promise<void> {
    const ref = await readFile(this.sessionPath, "utf8").catch(() => "");
    await rm(this.sessionPath, { force: true });
    this.session = undefined;
    this.requestSession.abort();
    this.requestSession = new AbortController();
    if (ref) await this.credentials.removeCredential(ref.trim());
  }

  async signOut(): Promise<void> {
    await this.ready;
    if (this.login || this.signingOut) return;
    this.signingOut = true;
    this.requestSession.abort();
    try {
      await this.refresh?.catch(() => undefined);
      const refreshToken = this.session?.refreshToken;
      await this.clearSession();
      if (refreshToken)
        await this.call("/api/v1/auth/token/revoke", {
          body: { refreshToken },
        }).catch(() => undefined);
      this.notice = undefined;
    } finally {
      this.signingOut = false;
    }
  }

  async connection(
    model: string,
  ): Promise<{ baseUrl: string; secret: string }> {
    const state = await this.summary();
    if (!state.signedIn) throw new Error("请先登录尽意账号。");
    if (!state.models.includes(model))
      throw new Error("该云 AI 模型当前不可用。");
    if (!this.proxyPort) {
      const server = createServer({ requestTimeout: 15_000 }, (req, res) => {
        void this.forward(req, res);
      });
      this.proxy = server;
      this.proxyPort = listen(server).catch((error: unknown) => {
        this.proxyPort = undefined;
        this.proxy = undefined;
        throw error;
      });
    }
    return {
      baseUrl: "http://127.0.0.1:" + (await this.proxyPort) + "/v1",
      secret: this.secret,
    };
  }

  private async forward(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const expected = Buffer.from("Bearer " + this.secret);
    const header = Buffer.from(req.headers.authorization ?? "");
    if (
      req.method !== "POST" ||
      req.url !== "/v1/chat/completions" ||
      header.length !== expected.length ||
      !timingSafeEqual(header, expected)
    ) {
      res.writeHead(403).end();
      return;
    }
    const aborted = new AbortController();
    res.once("close", () => aborted.abort());
    const signal = AbortSignal.any([
      aborted.signal,
      this.requestSession.signal,
      AbortSignal.timeout(300_000),
    ]);
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req as AsyncIterable<Buffer>) {
        bytes += chunk.length;
        if (bytes > MAX_BODY) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >;
      const session = await this.credential();
      const sessionId = req.headers["x-ai-session-id"];
      const response = await fetch(
        new URL("/api/v1/chats/completions", this.api),
        {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            [CONTRACT]: "2",
            Authorization: "Bearer " + session.accessToken,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
            ...(typeof sessionId === "string" &&
            /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
              ? { "X-AI-Session-Id": sessionId }
              : {}),
          },
          body: JSON.stringify({
            ...body,
            max_tokens: body.max_tokens ?? body.max_completion_tokens ?? 4096,
          }),
        },
      );
      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => null)) as {
          code?: string;
        } | null;
        throw new CloudError(
          response.status,
          result?.code ?? "CLOUD_AI_UNAVAILABLE",
        );
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      });
      await pipeline(Readable.fromWeb(response.body as ReadableStream), res, {
        signal,
      });
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const code =
        error instanceof CloudError ? error.message : "CLOUD_AI_UNAVAILABLE";
      res
        .writeHead(error instanceof CloudError ? error.status : 502, {
          "Content-Type": "application/json",
        })
        .end(
          JSON.stringify({
            error: { code, message: code, type: "hosted_ai_error" },
          }),
        );
    }
  }

  dispose(): void {
    this.closed = true;
    this.login?.abort();
    this.requestSession.abort();
    this.proxy?.close();
    this.proxy?.closeAllConnections();
  }
}
