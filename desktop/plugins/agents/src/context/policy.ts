import type {
  AgentContextPolicyMode,
  AgentContextReference,
} from "@dramaip/contracts/agent-context";

export function contextPolicy(
  candidate: AgentContextReference,
  policies: ReadonlyMap<string, AgentContextPolicyMode>,
  overrides: ReadonlyMap<string, AgentContextPolicyMode>,
): { mode: AgentContextPolicyMode; deniedDependency?: string } {
  const effective = (path: string) => overrides.get(path) ?? policies.get(path);
  const denied = (path: string) => {
    const parts = path.split("/");
    for (let end = parts.length; end > 1; end--) {
      const ancestor = parts.slice(0, end).join("/");
      if (effective(ancestor) === "never") return ancestor;
    }
    return undefined;
  };
  for (const dependency of candidate.policyDependencies ?? []) {
    const path = denied(dependency.fieldPath);
    if (path) return { mode: "never", deniedDependency: path };
  }
  const ownDenial = denied(candidate.fieldPath);
  return {
    mode: ownDenial ? "never" : (effective(candidate.fieldPath) ?? "auto"),
  };
}
