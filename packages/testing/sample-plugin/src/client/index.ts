/**
 * Client face of the test-only sample plugin: mounts the generated `sample`
 * Remote namespace and contributes one `shell.overlay` Slot entry. Unloading
 * the plugin withdraws both.
 * @module @dramaip/test-sample-plugin/client
 */
import type { Context } from "@deepseek-ai/cordis";
import sampleRemote from "@dramaip/test-sample-plugin/remote";
import type {} from "@dramaip/infra-gateway/client";
import type {} from "@dramaip/infra-ui-layout/client";
import type {} from "@dramaip/infra-ui-renderer/client";
import { SampleBadge } from "./SampleBadge.tsx";

/** Required Client services: the Remote mount face and the Slot registry. */
export const inject = ["remote", "slots"];

/**
 * Mount the `sample` namespace and register the overlay badge.
 * @param ctx - Client root Context.
 * @returns disposer that withdraws the namespace; the Slot entry leaves with the plugin scope.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(sampleRemote);
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "test-sample",
      },
      SampleBadge,
    ),
  );
  return unmount;
}
