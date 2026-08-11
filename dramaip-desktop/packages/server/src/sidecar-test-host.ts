/**
 * Node's test runner has no Electron utilityProcess parentPort.  This tiny host
 * adapts child-process IPC to the small parentPort surface the production
 * sidecar expects, so contract tests exercise the real HTTP server.
 */
type MessagePortLike = {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
};

const port: MessagePortLike = {
  postMessage(message) {
    process.send?.(message);
  },
  on(_event, listener) {
    process.on("message", (data) => listener({ data }));
  },
};

(process as NodeJS.Process & { parentPort?: MessagePortLike }).parentPort =
  port;

await import("./sidecar");

export {};
