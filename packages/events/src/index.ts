import { randomUUID } from "node:crypto";
import type { DomainEvent, RealtimeEvent } from "@dramaip/contracts";
import type {
  Cleanup,
  DurableEventConsumer,
  EventConsumerDiagnostic,
  EventRuntime,
  UnitOfWork,
} from "@dramaip/plugin-api/internal";
import { DomainEventSchemaRegistry } from "./event-schema.js";

export {
  DomainEventSchemaRegistry,
  type DomainEventManifestEntry,
  type DomainEventPatternEntry,
  type DomainEventUpcaster,
} from "./event-schema.js";

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
  private readonly domainListeners = new Set<(event: DomainEvent) => void>();
  private readonly consumers = new Map<string, ConsumerState>();
  private draining: Promise<void> | undefined;
  private drainRequested = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly stopAfterCommit: Cleanup;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly schemas?: DomainEventSchemaRegistry,
  ) {
    this.stopAfterCommit = uow.onAfterCommit((events) => {
      for (const event of events)
        for (const listener of this.domainListeners) listener(event);
      void this.drain();
    });
  }

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

  subscribeDomain(listener: (event: DomainEvent) => void): Cleanup {
    this.domainListeners.add(listener);
    return () => {
      this.domainListeners.delete(listener);
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
        .map(toDomainEvent)
        .map((event) => this.schemas?.upcast(event) ?? event),
    );
  }

  registerConsumer(consumer: DurableEventConsumer): Cleanup {
    if (this.consumers.has(consumer.id))
      throw new Error(`duplicate durable consumer: ${consumer.id}`);
    if (consumer.eventTypes.length === 0)
      throw new Error(
        `durable consumer has no declared events: ${consumer.id}`,
      );
    if (
      this.schemas &&
      consumer.eventTypes.some((type) => !this.schemas!.has(type))
    )
      throw new Error(
        `durable consumer subscribes to an undeclared event: ${consumer.id}`,
      );
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
      ({ consumer: _consumer, ...diagnostic }) => diagnostic,
    );
  }

  retryConsumer(id: string): boolean {
    const state = this.consumers.get(id);
    if (!state) return false;
    state.status = "healthy";
    state.consecutiveFailures = 0;
    state.lastError = undefined;
    state.nextAttemptAt = 0;
    state.deadLetterCursor = undefined;
    this.uow.execute((transaction) =>
      transaction.run(
        "DELETE FROM event_consumer_failures WHERE consumer_id = ?",
        id,
      ),
    );
    void this.drain();
    return true;
  }

  dispose(): void {
    this.stopAfterCommit();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.listeners.clear();
    this.domainListeners.clear();
    this.consumers.clear();
  }

  async drain(): Promise<void> {
    if (this.draining) {
      this.drainRequested = true;
      return this.draining;
    }
    this.draining = this.drainAll().finally(() => {
      this.draining = undefined;
      if (this.drainRequested) {
        this.drainRequested = false;
        void this.drain();
      }
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
          if (state.consumer.eventTypes.includes(event.type))
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
          state.deadLetterCursor = undefined;
          this.uow.execute((transaction) =>
            transaction.run(
              "DELETE FROM event_consumer_failures WHERE consumer_id = ? AND cursor = ?",
              state.id,
              event.cursor,
            ),
          );
        } catch (error) {
          state.consecutiveFailures += 1;
          state.lastError =
            error instanceof Error ? error.message : String(error);
          state.status =
            state.consecutiveFailures >= 10 ? "degraded" : "retrying";
          state.deadLetterCursor =
            state.status === "degraded" ? event.cursor : undefined;
          state.nextAttemptAt =
            Date.now() +
            Math.min(30_000, 100 * 2 ** (state.consecutiveFailures - 1));
          const failedAt = new Date().toISOString();
          this.uow.execute((transaction) =>
            transaction.run(
              `INSERT INTO event_consumer_failures(
                 consumer_id, cursor, event_id, attempts, status, last_error,
                 first_failed_at, last_failed_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(consumer_id, cursor) DO UPDATE SET
                 attempts = excluded.attempts,
                 status = excluded.status,
                 last_error = excluded.last_error,
                 last_failed_at = excluded.last_failed_at`,
              state.id,
              event.cursor,
              event.eventId,
              state.consecutiveFailures,
              state.status === "degraded" ? "dead-letter" : "retrying",
              state.lastError,
              failedAt,
              failedAt,
            ),
          );
          if (state.status !== "degraded") this.scheduleRetry();
          break;
        }
      }
    }
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const next = Math.min(
      ...[...this.consumers.values()]
        .filter((state) => state.status === "retrying")
        .map((state) => state.nextAttemptAt),
    );
    if (!Number.isFinite(next)) return;
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined;
        void this.drain();
      },
      Math.max(0, next - Date.now()),
    );
  }
}
