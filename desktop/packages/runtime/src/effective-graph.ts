import { createHash } from "node:crypto";

export type EffectiveGraphBuildPhase =
  | "resolve"
  | "validate"
  | "migration-preflight"
  | "stage"
  | "activate"
  | "validate-staged"
  | "publish"
  | "ready"
  | "failed";

export interface EffectiveGraphRevisionInput {
  readonly profile: string;
  readonly bundles: readonly string[];
  readonly plugins: readonly {
    id: string;
    version: string;
    config?: unknown;
  }[];
  readonly extensions: readonly unknown[];
  readonly apiVersion: string;
  readonly pluginApiVersion: string;
  readonly mode: string;
  readonly capabilities: Readonly<Record<string, boolean>>;
}

export interface EffectiveGraphBuildHooks<TStaged> {
  migrationPreflight(): void | Promise<void>;
  stage(): TStaged | Promise<TStaged>;
  activate(staged: TStaged): void | Promise<void>;
  validate(staged: TStaged): void | Promise<void>;
  publish(staged: TStaged): void | Promise<void>;
  dispose(staged: TStaged): void | Promise<void>;
}

export class EffectiveGraphBuilder {
  readonly revision: string;
  private readonly completed: EffectiveGraphBuildPhase[] = [
    "resolve",
    "validate",
  ];

  constructor(readonly input: EffectiveGraphRevisionInput) {
    this.revision = createHash("sha256")
      .update(canonicalJson(input))
      .digest("hex");
  }

  diagnostics(): {
    revision: string;
    phases: readonly EffectiveGraphBuildPhase[];
    status: "building" | "ready" | "failed";
  } {
    const last = this.completed.at(-1);
    return {
      revision: this.revision,
      phases: [...this.completed],
      status:
        last === "ready" ? "ready" : last === "failed" ? "failed" : "building",
    };
  }

  async build<TStaged>(
    hooks: EffectiveGraphBuildHooks<TStaged>,
  ): Promise<TStaged> {
    let staged: TStaged | undefined;
    try {
      await hooks.migrationPreflight();
      this.completed.push("migration-preflight");
      staged = await hooks.stage();
      this.completed.push("stage");
      await hooks.activate(staged);
      this.completed.push("activate");
      await hooks.validate(staged);
      this.completed.push("validate-staged");
      await hooks.publish(staged);
      this.completed.push("publish", "ready");
      return staged;
    } catch (error) {
      if (staged !== undefined) await hooks.dispose(staged);
      this.completed.push("failed");
      throw error;
    }
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
