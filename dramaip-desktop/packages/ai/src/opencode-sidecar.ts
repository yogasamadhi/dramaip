/**
 * OpenCode Desktop-compatible engine host. The packaged server bundle is supplied
 * by DRAMAIP_OPENCODE_SERVER_MODULE so the application never relies on PATH or
 * imports sdk-next into the Renderer process.
 */
import { mkdir } from "node:fs/promises";

type StartCommand = {
  type: "start";
  hostname: string;
  port: number;
  password: string;
  userDataPath: string;
  serverModule?: string;
  workspacePath: string;
  mcp?: { url: string; token: string };
  agentProvider?: {
    providerId: string;
    providerKind: "openai" | "anthropic" | "google";
    model: string;
    baseUrl?: string;
    environmentName:
      "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "GOOGLE_GENERATIVE_AI_API_KEY";
    secret: string;
  };
};
type Command = StartCommand | { type: "stop" };
type ParentPort = {
  postMessage(message: unknown): void;
  on(event: "message", cb: (event: { data: unknown }) => void): void;
};
type Listener = { stop(close?: boolean): void | Promise<void> };

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!parentPort)
  throw new Error("OpenCode 引擎必须作为 Electron utilityProcess 运行");
let listener: Listener | undefined;

parentPort.on("message", (event) => {
  const command = event.data as Partial<Command>;
  if (command.type === "stop") return void stop();
  if (command.type === "start") return void start(command as StartCommand);
});

async function start(command: StartCommand): Promise<void> {
  try {
    if (!command.serverModule) {
      parentPort!.postMessage({
        type: "unavailable",
        reason: "尚未打包 OpenCode 服务运行文件",
      });
      return;
    }
    process.env.OPENCODE_SERVER_USERNAME = "opencode";
    process.env.OPENCODE_SERVER_PASSWORD = command.password;
    process.env.XDG_STATE_HOME = command.userDataPath;
    process.env.XDG_CONFIG_HOME = `${command.userDataPath}/config`;
    process.env.XDG_DATA_HOME = `${command.userDataPath}/data`;
    process.env.NO_PROXY = appendLoopback(process.env.NO_PROXY);
    process.env.no_proxy = appendLoopback(process.env.no_proxy);
    if (command.agentProvider)
      process.env[command.agentProvider.environmentName] =
        command.agentProvider.secret;
    await mkdir(command.workspacePath, { recursive: true });
    process.chdir(command.workspacePath);
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(
      sandboxedConfig(command.mcp, command.agentProvider),
    );
    const mod = (await import(command.serverModule)) as {
      Server?: {
        listen(input: {
          hostname: string;
          port: number;
          username: string;
          password: string;
          cors: string[];
        }): Promise<Listener>;
      };
    };
    if (!mod.Server) throw new Error("OpenCode 服务运行文件缺少 Server 导出");
    listener = await mod.Server.listen({
      hostname: command.hostname,
      port: command.port,
      username: "opencode",
      password: command.password,
      cors: ["dramaip://renderer"],
    });
    parentPort!.postMessage({ type: "ready" });
  } catch (error) {
    parentPort!.postMessage({
      type: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function sandboxedConfig(
  mcp: StartCommand["mcp"],
  agentProvider: StartCommand["agentProvider"],
): Record<string, unknown> {
  return {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    snapshot: false,
    permission: {
      bash: "deny",
      edit: "deny",
      read: "deny",
      glob: "deny",
      grep: "deny",
      list: "deny",
      external_directory: "deny",
      webfetch: "deny",
      websearch: "deny",
      task: "deny",
      lsp: "deny",
      skill: "deny",
      question: "deny",
    },
    agent: {
      build: {
        mode: "primary",
        steps: 8,
        prompt:
          "你是 DramaIP 中文创作助手。只能使用获准的 DramaIP MCP 只读工具；禁止写文件、执行命令、读取任意本地路径、浏览网络或声称已提交修订。只返回正式分析、结构化结果和待确认建议，不得输出隐藏思维链。",
      },
    },
    ...(agentProvider
      ? {
          model: `${agentProvider.providerKind}/${agentProvider.model}`,
          provider: {
            [agentProvider.providerKind]: {
              options: agentProvider.baseUrl
                ? { baseURL: agentProvider.baseUrl }
                : {},
            },
          },
        }
      : {}),
    ...(mcp
      ? {
          mcp: {
            dramaip: {
              type: "remote",
              url: mcp.url,
              headers: { Authorization: `Bearer ${mcp.token}` },
              oauth: false,
            },
          },
        }
      : {}),
  };
}

async function stop(): Promise<void> {
  await listener?.stop();
  listener = undefined;
  parentPort!.postMessage({ type: "stopped" });
  process.exit(0);
}

function appendLoopback(current: string | undefined): string {
  const hosts = new Set(
    (current ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const host of ["127.0.0.1", "localhost", "::1"]) hosts.add(host);
  return [...hosts].join(",");
}
