import type { EventEnvelope, Task, TaskStatus } from "@sdns/schema";

const transitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ["running", "canceled", "interrupted"],
  running: ["succeeded", "failed", "canceled", "interrupted"],
  succeeded: [],
  failed: [],
  canceled: [],
  interrupted: ["queued"],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return transitions[from].includes(to);
}
export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to))
    throw new Error(`Invalid task transition: ${from} -> ${to}`);
}
export type TaskEvent = EventEnvelope;
export type TaskRecord = Task;
