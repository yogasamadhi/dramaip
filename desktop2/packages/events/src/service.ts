import { randomUUID } from "node:crypto";

import { Service, type Context } from "@deepseek-ai/cordis";

import type { DomainEvent } from "@dramaip/contracts";
import type {
  ConsumerDiagnostic,
  DurableConsumer,
  EventRuntime,
  JsonValue,
  LiveEvent,
  UnitOfWork,
} from "@dramaip/plugin-api";

interface ConsumerState extends ConsumerDiagnostic {
  consumer: DurableConsumer;
  nextAttemptAt: number;
}

interface EventRow {
  cursor: number;
  event_id: string;
  type: DomainEvent["type"];
  plugin_id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  payload_json: string;
  occurred_at: string;
}

function toEvent(row: EventRow): DomainEvent {
  return {
    cursor: row.cursor,
    eventId: row.event_id,
    type: row.type,
    pluginId: row.plugin_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    payload: JSON.parse(row.payload_json) as JsonValue,
    occurredAt: row.occurred_at,
  };
}

export class EventRuntimeService extends Service implements EventRuntime {
  static provide = "eventRuntime";

  private readonly liveListeners = new Set<(event: LiveEvent) => void>();
  private readonly consumers = new Map<string, ConsumerState>();
  private draining?: Promise<void>;

  constructor(
    ctx: Context,
    private readonly uow: UnitOfWork,
    pollIntervalMs = 250,
  ) {
    super(ctx, "eventRuntime");
    const timer = setInterval(() => void this.drain(), pollIntervalMs);
    timer.unref();
    ctx.effect(() => () => clearInterval(timer), "events.consumer-poll");
  }

  publishLive(input: Omit<LiveEvent, "id" | "occurredAt">): void {
    const event: LiveEvent = {
      ...input,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
    for (const listener of this.liveListeners) listener(event);
  }

  subscribeLive(listener: (event: LiveEvent) => void): () => void {
    this.liveListeners.add(listener);
    return () => this.liveListeners.delete(listener);
  }

  replay(afterCursor: number, limit = 500): DomainEvent[] {
    return this.uow.execute((tx) =>
      tx
        .all<EventRow>(
          `SELECT cursor, event_id, type, plugin_id, aggregate_type, aggregate_id,
                  aggregate_version, payload_json, occurred_at
             FROM domain_events
            WHERE cursor > ?
            ORDER BY cursor ASC
            LIMIT ?`,
          afterCursor,
          Math.min(Math.max(limit, 1), 2_000),
        )
        .map(toEvent),
    );
  }

  registerConsumer(consumer: DurableConsumer): () => Promise<void> {
    if (this.consumers.has(consumer.id))
      throw new Error(`duplicate durable consumer: ${consumer.id}`);
    const checkpoint = this.uow.execute((tx) => {
      const row = tx.get<{ cursor: number }>(
        "SELECT cursor FROM event_consumer_checkpoints WHERE consumer_id = ?",
        consumer.id,
      );
      if (!row) {
        tx.run(
          `INSERT INTO event_consumer_checkpoints (consumer_id, plugin_id, cursor, updated_at)
           VALUES (?, ?, 0, ?)`,
          consumer.id,
          consumer.pluginId,
          new Date().toISOString(),
        );
      }
      return row?.cursor ?? 0;
    });
    this.consumers.set(consumer.id, {
      consumer,
      id: consumer.id,
      pluginId: consumer.pluginId,
      critical: consumer.critical,
      checkpoint,
      consecutiveFailures: 0,
      status: "healthy",
      nextAttemptAt: 0,
    });
    void this.drain();

    let disposed = false;
    return async () => {
      if (disposed) return;
      disposed = true;
      this.consumers.delete(consumer.id);
      await this.draining;
    };
  }

  diagnostics(): readonly ConsumerDiagnostic[] {
    return [...this.consumers.values()].map(
      ({ consumer: _consumer, nextAttemptAt: _next, ...diagnostic }) => ({
        ...diagnostic,
      }),
    );
  }

  async drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.drainInternal().finally(() => {
      this.draining = undefined;
    });
    return this.draining;
  }

  private async drainInternal(): Promise<void> {
    for (const state of this.consumers.values()) {
      if (state.status === "degraded" || Date.now() < state.nextAttemptAt)
        continue;
      while (this.consumers.get(state.id) === state) {
        const event = this.replay(state.checkpoint, 1)[0];
        if (!event) break;
        try {
          await state.consumer.handle(event);
          this.uow.execute((tx) => {
            tx.run(
              `UPDATE event_consumer_checkpoints
                  SET cursor = ?, updated_at = ?
                WHERE consumer_id = ?`,
              event.cursor,
              new Date().toISOString(),
              state.id,
            );
          });
          state.checkpoint = event.cursor;
          state.consecutiveFailures = 0;
          state.status = "healthy";
          state.lastError = undefined;
          state.nextAttemptAt = 0;
        } catch (error) {
          state.consecutiveFailures += 1;
          state.lastError =
            error instanceof Error ? error.message : String(error);
          if (state.consecutiveFailures >= 10) {
            state.status = "degraded";
          } else {
            state.status = "retrying";
            const delay = Math.min(
              30_000,
              100 * 2 ** (state.consecutiveFailures - 1),
            );
            state.nextAttemptAt = Date.now() + delay;
          }
          break;
        }
      }
    }
  }
}
