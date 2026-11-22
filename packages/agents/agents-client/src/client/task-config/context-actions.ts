/**
 * The context assistant's routing layer over the agents task catalog: the
 * one to three recommended actions of each page, and the preflight that says
 * whether one can run now. Only stable task ids live here; labels,
 * categories and write policy always come from `enginesListTasks`, so a
 * catalog edit cannot create a second definition of a task.
 */

import {
  CONTEXT_ACTIONS,
  contextPage,
  type ContextActionSpec as ActionSpec,
  type ContextPage,
} from "@dramaip/contracts/context-actions";

export { CONTEXT_ACTIONS, contextPage, type ContextPage };

/** One task of the catalog, as `enginesListTasks` answers it. */
export interface TaskDefinition {
  id: string;
  label: string;
  category: string;
  writePolicy?: string;
}

/** An agent engine and its state, as `enginesList` answers it. */
export interface EngineDescriptor {
  kind: string;
  name: string;
  status: string;
}

/** A recommended action joined with its catalog task. */
export type ContextAction = ActionSpec & TaskDefinition;

/**
 * The page's recommended actions found in the catalog, and the task ids it
 * recommends that the catalog lacks.
 * @param page - the page.
 * @param catalog - the installed task catalog.
 */
export function contextActions(
  page: ContextPage,
  catalog: readonly TaskDefinition[],
): { actions: ContextAction[]; missing: string[] } {
  const byId = new Map(catalog.map((task) => [task.id, task]));
  const actions: ContextAction[] = [];
  const missing: string[] = [];
  for (const action of CONTEXT_ACTIONS[page]) {
    const definition = byId.get(action.taskType);
    if (definition) actions.push({ ...action, ...definition });
    else missing.push(action.taskType);
  }
  return { actions, missing };
}

/**
 * Whether a task works on one chapter.
 * @param task - the catalog task.
 */
export function needsChapter(task: TaskDefinition | undefined): boolean {
  return task?.category === "章节写作" || task?.category === "记忆与连续性";
}

/** One fix a preflight asks for, as a copy key and its values. */
export interface PreflightFix {
  key:
    | "fix.project"
    | "fix.chapter"
    | "fix.engine"
    | "fix.engineStart"
    | "fix.model"
    | "fix.cost";
  values?: { name: string };
}

/** Whether a recommended action can run now, and what it is missing. */
export interface Preflight {
  ready: boolean;
  capability: "ready" | "missing" | "unavailable";
  input: "ready" | "project-required" | "chapter-required";
  cost: "not-applicable" | "known-after-preview" | "unknown";
  fixes: PreflightFix[];
}

/**
 * Check one recommended action. Planning a provider action calls no
 * provider, but its later execution must have a quote, so a missing quote
 * asks for one without blocking the planning run.
 * @param input - the action and the chosen project, chapter, engine and model.
 */
export function preflight(input: {
  action: ContextAction;
  projectId?: string;
  chapterId?: string;
  engine?: EngineDescriptor | undefined;
  modelId?: string;
  hasKnownProviderCost?: boolean;
}): Preflight {
  const fixes: PreflightFix[] = [];
  let capability: Preflight["capability"] = "ready";
  let requirements: Preflight["input"] = "ready";
  if (!input.projectId) {
    requirements = "project-required";
    fixes.push({ key: "fix.project" });
  } else if (needsChapter(input.action) && !input.chapterId) {
    requirements = "chapter-required";
    fixes.push({ key: "fix.chapter" });
  }
  if (!input.engine) {
    capability = "missing";
    fixes.push({ key: "fix.engine" });
  } else if (input.engine.status !== "available") {
    capability = "unavailable";
    fixes.push({ key: "fix.engineStart", values: { name: input.engine.name } });
  } else if (!input.modelId?.trim()) {
    capability = "missing";
    fixes.push({ key: "fix.model" });
  }
  const cost =
    input.action.writePolicy !== "provider-action-preview"
      ? "not-applicable"
      : input.hasKnownProviderCost
        ? "known-after-preview"
        : "unknown";
  if (cost === "unknown") fixes.push({ key: "fix.cost" });
  return {
    ready: capability === "ready" && requirements === "ready",
    capability,
    input: requirements,
    cost,
    fixes,
  };
}

/**
 * Check the action table against the catalog: one to three distinct actions
 * a page, each naming a catalog task.
 * @param catalog - the installed task catalog.
 * @throws when a page breaks a rule.
 */
export function assertContextActions(catalog: readonly TaskDefinition[]): void {
  const ids = new Set(catalog.map((task) => task.id));
  for (const [page, actions] of Object.entries(CONTEXT_ACTIONS)) {
    if (actions.length < 1 || actions.length > 3)
      throw new Error(`${page}: one to three actions`);
    const seen = new Set<string>();
    for (const action of actions) {
      if (seen.has(action.actionId))
        throw new Error(`${page}: duplicate ${action.actionId}`);
      seen.add(action.actionId);
      if (!ids.has(action.taskType))
        throw new Error(`${page}: unknown task ${action.taskType}`);
    }
  }
}

/**
 * The first text a task result carries, searched through its common fields
 * a few levels deep.
 * @param value - the result.
 * @returns the text, or `undefined` when it has none.
 */
export function resultText(value: unknown): string | undefined {
  const seen = new Set<unknown>();
  const find = (current: unknown, depth: number): string | undefined => {
    if (typeof current === "string" && current.trim()) return current.trim();
    if (
      !current ||
      typeof current !== "object" ||
      depth > 5 ||
      seen.has(current)
    )
      return undefined;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        const found = find(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    const object = current as Record<string, unknown>;
    for (const key of [
      "summary",
      "suggestedAction",
      "nextSteps",
      "text",
      "content",
      "output",
      "message",
      "result",
      "parts",
    ]) {
      const found = find(object[key], depth + 1);
      if (found) return found;
    }
    for (const nested of Object.values(object)) {
      const found = find(nested, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return find(value, 0);
}
