export function assertJsonSchemaValue(
  value: unknown,
  schema: Record<string, unknown> | undefined,
  depth = 0,
): void {
  if (!schema) return;
  if (depth > 20)
    throw new Error("Extension JSON Schema exceeded maximum depth");
  const type = schema.type;
  const valid =
    type === undefined ||
    (type === "null" && value === null) ||
    (type === "array" && Array.isArray(value)) ||
    (type === "object" &&
      Boolean(value) &&
      typeof value === "object" &&
      !Array.isArray(value)) ||
    (type === "string" && typeof value === "string") ||
    (type === "number" &&
      typeof value === "number" &&
      Number.isFinite(value)) ||
    (type === "integer" &&
      typeof value === "number" &&
      Number.isInteger(value)) ||
    (type === "boolean" && typeof value === "boolean");
  if (!valid)
    throw new Error(
      `Extension value does not match schema type ${String(type)}`,
    );
  if (
    type === "object" &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const object = value as Record<string, unknown>;
    for (const required of Array.isArray(schema.required)
      ? schema.required
      : [])
      if (typeof required === "string" && !(required in object))
        throw new Error(
          `Extension value is missing required property ${required}`,
        );
    const properties =
      schema.properties &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, Record<string, unknown>>)
        : {};
    if (schema.additionalProperties === false)
      for (const key of Object.keys(object))
        if (!properties[key])
          throw new Error(`Extension value has undeclared property ${key}`);
    for (const [key, child] of Object.entries(object))
      if (properties[key])
        assertJsonSchemaValue(child, properties[key], depth + 1);
  }
  if (
    type === "array" &&
    Array.isArray(value) &&
    schema.items &&
    typeof schema.items === "object"
  )
    for (const child of value)
      assertJsonSchemaValue(
        child,
        schema.items as Record<string, unknown>,
        depth + 1,
      );
}

export function jsonPathValue(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.slice(2).split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current))
      return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
