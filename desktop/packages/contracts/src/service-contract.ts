export interface ServiceContract<TService> {
  readonly id: `${string}.v${number}`;
  readonly owner: string;
  readonly major: number;
  readonly capabilities: readonly string[];
  readonly degradable: boolean;
  readonly __serviceType?: TService;
  toString(): string;
}

export function defineServiceContract<TService>(input: {
  id: `${string}.v${number}`;
  owner: string;
  major: number;
  capabilities?: readonly string[];
  degradable?: boolean;
}): ServiceContract<TService> {
  if (!input.id.endsWith(`.v${input.major}`))
    throw new Error(
      `service contract major mismatch: ${input.id} / v${input.major}`,
    );
  return Object.freeze({
    ...input,
    capabilities: Object.freeze([...(input.capabilities ?? [])]),
    degradable: input.degradable ?? false,
    toString: () => input.id,
  });
}
