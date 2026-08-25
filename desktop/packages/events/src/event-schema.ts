import {
  JsonValueSchema,
  type DomainEvent,
  type JsonValue,
} from "@dramaip/contracts";
import type { PendingDomainEvent } from "@dramaip/plugin-api/internal";

export interface DomainEventManifestEntry {
  readonly owner: string;
}

export interface DomainEventPatternEntry extends DomainEventManifestEntry {
  readonly pattern: string;
}

export interface DomainEventUpcaster {
  readonly fromType: DomainEvent["type"];
  readonly toType: DomainEvent["type"];
  upcast(payload: JsonValue): JsonValue;
}

export class DomainEventSchemaRegistry {
  private readonly upcasters = new Map<string, DomainEventUpcaster>();

  constructor(
    private readonly manifest: Readonly<
      Record<string, DomainEventManifestEntry>
    >,
    patterns: readonly DomainEventPatternEntry[] = [],
  ) {
    this.patterns = patterns.map((entry) => ({
      entry,
      expression: new RegExp(entry.pattern, "u"),
    }));
  }

  private readonly patterns: readonly {
    entry: DomainEventPatternEntry;
    expression: RegExp;
  }[];

  private declaration(type: string): DomainEventManifestEntry | undefined {
    return (
      this.manifest[type] ??
      this.patterns.find(({ expression }) => expression.test(type))?.entry
    );
  }

  has(type: string): boolean {
    return Boolean(this.declaration(type));
  }

  validate(event: PendingDomainEvent): void {
    const declared = this.declaration(event.type);
    if (!declared)
      throw new Error(`undeclared domain event type: ${event.type}`);
    if (declared.owner !== event.pluginId)
      throw new Error(
        `domain event owner mismatch: ${event.type} is owned by ${declared.owner}`,
      );
    if (!JsonValueSchema.safeParse(event.payload).success)
      throw new Error(`domain event payload is not JSON: ${event.type}`);
  }

  registerUpcaster(upcaster: DomainEventUpcaster): () => void {
    if (this.upcasters.has(upcaster.fromType))
      throw new Error(`duplicate event upcaster: ${upcaster.fromType}`);
    const source = this.manifest[upcaster.fromType];
    const target = this.manifest[upcaster.toType];
    if (!source || !target || source.owner !== target.owner)
      throw new Error("event upcaster types must be declared by one owner");
    this.upcasters.set(upcaster.fromType, upcaster);
    return () => this.upcasters.delete(upcaster.fromType);
  }

  upcast(event: DomainEvent): DomainEvent {
    let current = event;
    const visited = new Set<string>();
    while (true) {
      const upcaster = this.upcasters.get(current.type);
      if (!upcaster) return current;
      if (visited.has(current.type))
        throw new Error(`event upcaster cycle: ${current.type}`);
      visited.add(current.type);
      current = {
        ...current,
        type: upcaster.toType,
        payload: upcaster.upcast(current.payload),
      };
    }
  }
}
