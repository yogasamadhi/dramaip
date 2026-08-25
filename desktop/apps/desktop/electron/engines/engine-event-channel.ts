import type { HostEngineStreamEvent } from "@dramaip/desktop-host";

const MAX_EVENTS = 1_000;
const MAX_BYTES = 4 * 1024 * 1024;

export class EngineEventChannel implements AsyncIterable<HostEngineStreamEvent> {
  private readonly queued: HostEngineStreamEvent[] = [];
  private pending:
    ((value: HostEngineStreamEvent | undefined) => void) | undefined;
  private queuedBytes = 0;
  private closed = false;

  push(event: HostEngineStreamEvent): void {
    if (this.closed) return;
    const bytes = Buffer.byteLength(JSON.stringify(event), "utf8");
    if (
      this.queued.length >= MAX_EVENTS ||
      this.queuedBytes + bytes > MAX_BYTES
    ) {
      this.finish({
        type: "error",
        message: "智能引擎事件流超过背压限制，任务已中断。",
      });
      return;
    }
    const pending = this.pending;
    if (pending) {
      this.pending = undefined;
      pending(event);
      return;
    }
    this.queued.push(event);
    this.queuedBytes += bytes;
  }

  finish(finalEvent?: HostEngineStreamEvent): void {
    if (this.closed) return;
    if (finalEvent) {
      const pending = this.pending;
      if (pending) {
        this.pending = undefined;
        pending(finalEvent);
      } else {
        this.queued.push(finalEvent);
        this.queuedBytes += Buffer.byteLength(
          JSON.stringify(finalEvent),
          "utf8",
        );
      }
    }
    this.closed = true;
    if (this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      pending(undefined);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<HostEngineStreamEvent> {
    while (true) {
      const event = await this.next();
      if (!event) return;
      yield event;
    }
  }

  private next(): Promise<HostEngineStreamEvent | undefined> {
    const queued = this.queued.shift();
    if (queued) {
      this.queuedBytes -= Buffer.byteLength(JSON.stringify(queued), "utf8");
      return Promise.resolve(queued);
    }
    if (this.closed) return Promise.resolve(undefined);
    return new Promise((resolvePromise) => {
      this.pending = resolvePromise;
    });
  }
}
