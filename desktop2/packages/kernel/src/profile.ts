import { z } from "zod";

import { pluginIdSchema } from "@dramaip/contracts";
import type {
  DramaPluginExports,
  JsonValue,
  PluginProfile,
} from "@dramaip/plugin-api";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const profileSchema = z
  .object({
    name: z.enum(["studio", "safe", "test", "e2e"]),
    plugins: z.array(
      z
        .object({
          id: pluginIdSchema,
          config: jsonValueSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

const forbiddenText = [
  { pattern: /!!js/i, reason: "JavaScript YAML tags are forbidden" },
  { pattern: /\$\{[^}]+\}/, reason: "environment expressions are forbidden" },
  { pattern: /(?:^|["'])\.\.?\//m, reason: "relative paths are forbidden" },
] as const;

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

export function parseProfileText(
  text: string,
  knownPluginIds: ReadonlySet<string>,
): PluginProfile {
  for (const rule of forbiddenText) {
    if (rule.pattern.test(text)) throw new ProfileValidationError(rule.reason);
  }

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (cause) {
    throw new ProfileValidationError(
      `profile must be strict JSON: ${String(cause)}`,
    );
  }

  const result = profileSchema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new ProfileValidationError(detail);
  }

  const seen = new Set<string>();
  for (const entry of result.data.plugins) {
    if (
      entry.id.includes("/") ||
      entry.id.includes(".") ||
      entry.id.startsWith("@")
    ) {
      throw new ProfileValidationError(
        `plugin ${entry.id} is not a builtin id`,
      );
    }
    if (!knownPluginIds.has(entry.id)) {
      throw new ProfileValidationError(`unknown builtin plugin: ${entry.id}`);
    }
    if (seen.has(entry.id))
      throw new ProfileValidationError(`duplicate plugin id: ${entry.id}`);
    seen.add(entry.id);
  }

  return result.data;
}

export function validatePluginGraph(
  modules: ReadonlyMap<string, DramaPluginExports<unknown>>,
  selectedIds: readonly string[],
): readonly string[] {
  const selected = new Set(selectedIds);
  const state = new Map<string, "visiting" | "visited">();
  const ordered: string[] = [];

  const visit = (id: string, trail: readonly string[]): void => {
    const status = state.get(id);
    if (status === "visited") return;
    if (status === "visiting") {
      throw new ProfileValidationError(
        `plugin dependency cycle: ${[...trail, id].join(" -> ")}`,
      );
    }
    const module = modules.get(id);
    if (!module)
      throw new ProfileValidationError(`missing builtin module: ${id}`);
    if (module.descriptor.id !== id)
      throw new ProfileValidationError(
        `builtin key ${id} does not match descriptor id`,
      );

    state.set(id, "visiting");
    for (const dependency of module.descriptor.requires) {
      if (!selected.has(dependency)) {
        throw new ProfileValidationError(
          `plugin ${id} requires unselected plugin ${dependency}`,
        );
      }
      visit(dependency, [...trail, id]);
    }
    state.set(id, "visited");
    ordered.push(id);
  };

  for (const id of selectedIds) visit(id, []);
  return ordered;
}
