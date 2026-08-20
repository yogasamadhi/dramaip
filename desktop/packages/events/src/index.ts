import { randomUUID } from "node:crypto";
import type { DomainEvent, RealtimeEvent } from "@dramaip/contracts";
import type {
  Cleanup,
  DurableEventConsumer,
  EventConsumerDiagnostic,
  EventRuntime,
  UnitOfWork,
} from "@dramaip/plugin-api/internal";

interface ConsumerState extends EventConsumerDiagnostic {
  consumer: DurableEventConsumer;
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

function toDomainEvent(row: EventRow): DomainEvent {
  return {
    cursor: row.cursor,
    eventId: row.event_id,
    type: row.type,
    pluginId: row.plugin_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    payload: JSON.parse(row.payload_json),
    occurredAt: row.occurred_at,
  };
}

export class PersistentEventRuntime implements EventRuntime {
  private readonly listeners = new Set<(event: RealtimeEvent) => void>();
  private readonly consumers = new Map<string, ConsumerState>();
  private draining: Promise<void> | undefined;

  constructor(private readonly uow: UnitOfWork) {}

  publishLive(input: {
    type: string;
    payload: RealtimeEvent["payload"];
  }): void {
    const event: RealtimeEvent = {
      id: randomUUID(),
      type: input.type,
      payload: input.payload,
      occurredAt: new Date().toISOString(),
    };
    for (const listener of this.listeners) listener(event);
  }

  subscribeLive(listener: (event: RealtimeEvent) => void): Cleanup {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  replay(afterCursor: number, limit = 500): readonly DomainEvent[] {
    return this.uow.execute((transaction) =>
      transaction
        .all<EventRow>(
          `SELECT cursor, event_id, type, plugin_id, aggregate_type, aggregate_id,
                  aggregate_version, payload_json, occurred_at
             FROM domain_events
            WHERE cursor > ?
            ORDER BY cursor ASC
            LIMIT ?`,
          Math.max(0, afterCursor),
          Math.min(Math.max(limit, 1), 2_000),
        )
        .map(toDomainEvent),
    );
  }

  registerConsumer(consumer: DurableEventConsumer): Cleanup {
    if (this.consumers.has(consumer.id))
      throw new Error(`duplicate durable consumer: ${consumer.id}`);
    const checkpoint = this.uow.execute((transaction) => {
      const row = transaction.get<{ cursor: number }>(
        "SELECT cursor FROM event_consumer_checkpoints WHERE consumer_id = ?",
        consumer.id,
      );
      if (!row)
        transaction.run(
          "INSERT INTO event_consumer_checkpoints(consumer_id, plugin_id, cursor, updated_at) VALUES (?, ?, 0, ?)",
          consumer.id,
          consumer.pluginId,
          new Date().toISOString(),
        );
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
    return () => {
      this.consumers.delete(consumer.id);
    };
  }

  diagnostics(): readonly EventConsumerDiagnostic[] {
    return [...this.consumers.values()].map(
      ({ consumer: _consumer, nextAttemptAt: _nextAttemptAt, ...diagnostic }) =>
        diagnostic,
    );
  }

  async drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.drainAll().finally(() => {
      this.draining = undefined;
    });
    return this.draining;
  }

  private async drainAll(): Promise<void> {
    for (const state of this.consumers.values()) {
      if (state.status === "degraded" || Date.now() < state.nextAttemptAt)
        continue;
      while (this.consumers.get(state.id) === state) {
        const event = this.replay(state.checkpoint, 1)[0];
        if (!event) break;
        try {
          await state.consumer.handle(event);
          this.uow.execute((transaction) =>
            transaction.run(
              "UPDATE event_consumer_checkpoints SET cursor = ?, updated_at = ? WHERE consumer_id = ?",
              event.cursor,
              new Date().toISOString(),
              state.id,
            ),
          );
          state.checkpoint = event.cursor;
          state.consecutiveFailures = 0;
          state.status = "healthy";
          state.lastError = undefined;
          state.nextAttemptAt = 0;
        } catch (error) {
          state.consecutiveFailures += 1;
          state.lastError =
            error instanceof Error ? error.message : String(error);
          state.status =
            state.consecutiveFailures >= 10 ? "degraded" : "retrying";
          state.nextAttemptAt =
            Date.now() +
            Math.min(30_000, 100 * 2 ** (state.consecutiveFailures - 1));
          break;
        }
      }
    }
  }
}
