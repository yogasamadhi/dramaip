import type { Context } from "@deepseek-ai/cordis";
import type { PropsRuntime } from "@dramaip/infra-ui-slots";
import {
  PROJECT_TOOL_KEYS,
  ProjectToolBody,
  type ProjectToolBodyKey,
  type ProjectToolRecord,
} from "../app/project-tools";
import type {} from "./contract.ts";

/** The body of one tool, over the record the page read through the app. */
function toolBody(tool: ProjectToolBodyKey) {
  return function ToolBody({ record }: PropsRuntime<"workspace.tool">) {
    return <ProjectToolBody tool={tool} record={record as ProjectToolRecord} />;
  };
}

/**
 * Register the tool panels the existing app still owns into the project
 * tools page, which declares `workspace.tool` when it mounts: one body per
 * tool. Transitional until the panels move with their domains (P4/P5).
 * @param ctx - Client Context whose Slot registry the page declares into.
 */
export function registerLegacyProjectTools(ctx: Context): void {
  ctx.slots.inject("workspace.tool", () =>
    PROJECT_TOOL_KEYS.map((key) =>
      ctx.slots.register(
        { name: "workspace.tool", key, registrant: "workspace-studio-client" },
        toolBody(key),
      ),
    ),
  );
}
