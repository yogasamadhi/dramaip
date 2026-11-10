import { createHash } from "node:crypto";
import type { Cleanup, UiRegistry } from "./internal.js";

/**
 * The UI contribution registry: declarative metadata each plugin registers,
 * hashed so the renderer can verify what it was served. `stage()` freezes
 * the published view while a candidate graph registers.
 */
export class ContributionRegistry implements UiRegistry {
  private published?: readonly ReturnType<
    UiRegistry["contributions"]
  >[number][];
  stage(): void {
    this.published = [...this.entries.values()];
  }
  publish(): void {
    this.published = undefined;
  }
  candidateContributions() {
    return [...this.entries.values()];
  }
  private readonly entries = new Map<
    string,
    ReturnType<UiRegistry["contributions"]>[number]
  >();

  register(contributions: Parameters<UiRegistry["register"]>[0]): Cleanup {
    const ids: string[] = [];
    for (const contribution of contributions) {
      if (this.entries.has(contribution.id))
        throw new Error(`duplicate UI contribution: ${contribution.id}`);
      const metadataHash = createHash("sha256")
        .update(
          canonicalJson({
            id: contribution.id,
            pluginId: contribution.pluginId,
            kind: contribution.kind,
            metadata: contribution.metadata,
          }),
        )
        .digest("hex");
      this.entries.set(contribution.id, { ...contribution, metadataHash });
      ids.push(contribution.id);
    }
    return () => {
      for (const id of ids) this.entries.delete(id);
    };
  }

  contributions(): readonly ReturnType<UiRegistry["contributions"]>[number][] {
    return this.published ?? [...this.entries.values()];
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
