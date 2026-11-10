import { createInterface } from "node:readline";
import {
  SUBPROCESS_CONTROL_ENV,
  openInheritedControlChannel,
} from "@dramaip/infra-subprocess/control";

/** The parent channel an engine sidecar receives commands on. */
export type SidecarParentPort = {
  testHarness?: true;
  postMessage(message: unknown): void;
  on(event: "message", cb: (event: { data: unknown }) => void): void;
};

/**
 * Newline-delimited JSON over the control channel a Host-managed subprocess
 * inherits. The sidecar exits when its parent closes the channel: nothing
 * else can reach it any more.
 */
function controlChannelPort(): SidecarParentPort {
  const channel = openInheritedControlChannel();
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const lines = createInterface({ input: channel, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      return;
    }
    for (const listener of listeners) listener({ data });
  });
  // The channel is half-open, so a parent that dies shows up as the end of
  // its readable side; "close" alone would wait for a write that never comes.
  channel.on("end", () => process.exit(0));
  channel.on("close", () => process.exit(0));
  channel.on("error", () => process.exit(1));
  return {
    postMessage(message) {
      channel.write(`${JSON.stringify(message)}\n`);
    },
    on(_event, cb) {
      listeners.push(cb);
    },
  };
}

/**
 * The sidecar's parent channel: Electron's `process.parentPort` under a
 * utilityProcess (and the tests' fake port), or the inherited control channel
 * when the Desktop Host started this sidecar through its subprocess service.
 * @returns the port, or undefined when the process has no parent channel.
 */
export function sidecarParentPort(): SidecarParentPort | undefined {
  const parentPort = (
    process as NodeJS.Process & { parentPort?: SidecarParentPort }
  ).parentPort;
  if (parentPort) return parentPort;
  return process.env[SUBPROCESS_CONTROL_ENV] === "pipe"
    ? controlChannelPort()
    : undefined;
}
