export type SupervisorStatus =
  | "created"
  | "starting"
  | "ready"
  | "degraded"
  | "restarting"
  | "stopping"
  | "stopped";

export interface SupervisorSnapshot {
  readonly name: string;
  readonly status: SupervisorStatus;
  readonly generation: number;
  readonly pid?: number;
  readonly startedAt?: string;
  readonly health: boolean;
  readonly restartCount: number;
  readonly lastExit?: { code?: number; occurredAt: string };
  readonly configured?: boolean;
  readonly authenticated?: boolean;
  readonly pendingRequestCount: number;
}

export class ManagedComponentState {
  private status: SupervisorStatus = "created";
  private generation = 0;
  private pid: number | undefined;
  private startedAt: string | undefined;
  private health = false;
  private restartCount = 0;
  private lastExit: SupervisorSnapshot["lastExit"];
  private configured: boolean | undefined;
  private authenticated: boolean | undefined;

  constructor(readonly name: string) {}

  beginStart(restarting = false): number {
    this.status = restarting ? "restarting" : "starting";
    this.generation += 1;
    this.health = false;
    this.pid = undefined;
    this.startedAt = new Date().toISOString();
    if (restarting) this.restartCount += 1;
    return this.generation;
  }

  attach(pid: number | undefined): void {
    this.pid = pid;
  }

  ready(input: { configured?: boolean; authenticated?: boolean }): void {
    this.status = "ready";
    this.health = true;
    this.configured = input.configured;
    this.authenticated = input.authenticated;
  }

  exited(code?: number): void {
    this.status = "degraded";
    this.health = false;
    this.pid = undefined;
    this.lastExit = { code, occurredAt: new Date().toISOString() };
  }

  stopping(): void {
    this.status = "stopping";
  }

  stopped(): void {
    this.status = "stopped";
    this.health = false;
    this.pid = undefined;
  }

  snapshot(pendingRequestCount = 0): SupervisorSnapshot {
    return {
      name: this.name,
      status: this.status,
      generation: this.generation,
      ...(this.pid === undefined ? {} : { pid: this.pid }),
      ...(this.startedAt === undefined ? {} : { startedAt: this.startedAt }),
      health: this.health,
      restartCount: this.restartCount,
      ...(this.lastExit === undefined ? {} : { lastExit: this.lastExit }),
      ...(this.configured === undefined ? {} : { configured: this.configured }),
      ...(this.authenticated === undefined
        ? {}
        : { authenticated: this.authenticated }),
      pendingRequestCount,
    };
  }
}

export class RestartBudget {
  private readonly crashes: number[] = [];
  private stableTimer: ReturnType<typeof setTimeout> | undefined;

  nextDelay(): number | undefined {
    const now = Date.now();
    this.prune(now);
    if (this.crashes.length >= 5) return undefined;
    this.crashes.push(now);
    const base = Math.min(30_000, 500 * 2 ** (this.crashes.length - 1));
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }

  snapshot(): {
    attemptsInWindow: number;
    remaining: number;
    exhausted: boolean;
    windowMs: number;
    maximumAttempts: number;
  } {
    this.prune(Date.now());
    return {
      attemptsInWindow: this.crashes.length,
      remaining: Math.max(0, 5 - this.crashes.length),
      exhausted: this.crashes.length >= 5,
      windowMs: 300_000,
      maximumAttempts: 5,
    };
  }

  markStable(): void {
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = setTimeout(() => {
      this.crashes.length = 0;
      this.stableTimer = undefined;
    }, 120_000);
  }

  dispose(): void {
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = undefined;
  }

  private prune(now: number): void {
    while (this.crashes[0] !== undefined && now - this.crashes[0] > 300_000)
      this.crashes.shift();
  }
}
