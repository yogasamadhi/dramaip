import { Service, type Context } from "@deepseek-ai/cordis";

import type {
  CommandContribution,
  UiContribution,
  UiNavigationContribution,
  UiRegistry,
  UiRouteContribution,
  UiSlot,
  UiSlotContribution,
} from "@dramaip/plugin-api";

export class UiRegistryService extends Service implements UiRegistry {
  static provide = "uiRegistry";

  private readonly routeContributions = new Map<string, UiRouteContribution>();
  private readonly navigationContributions = new Map<
    string,
    UiNavigationContribution
  >();
  private readonly slotContributions = new Map<string, UiSlotContribution>();
  private readonly commandContributions = new Map<
    string,
    CommandContribution
  >();

  constructor(ctx: Context) {
    super(ctx, "uiRegistry");
  }

  register(contributions: readonly UiContribution[]): () => Promise<void> {
    for (const contribution of contributions) {
      const registry = this.registry(contribution);
      if (registry.has(contribution.id))
        throw new Error(`duplicate UI contribution: ${contribution.id}`);
    }
    for (const contribution of contributions)
      this.registry(contribution).set(contribution.id, contribution as never);
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      for (const contribution of contributions)
        this.registry(contribution).delete(contribution.id);
    };
    this.ctx.effect(
      () => dispose,
      `ui.contributions:${contributions.map((item) => item.id).join(",")}`,
    );
    return dispose;
  }

  private registry(contribution: UiContribution): Map<string, any> {
    if (contribution.kind === "route") return this.routeContributions;
    if (contribution.kind === "navigation") return this.navigationContributions;
    if (contribution.kind === "slot") return this.slotContributions;
    return this.commandContributions;
  }

  routes(): readonly UiRouteContribution[] {
    return [...this.routeContributions.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }

  navigation(): readonly UiNavigationContribution[] {
    return [...this.navigationContributions.values()].sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    );
  }

  slots(slot: UiSlot): readonly UiSlotContribution[] {
    return [...this.slotContributions.values()]
      .filter((contribution) => contribution.slot === slot)
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id),
      );
  }

  commands(): readonly CommandContribution[] {
    return [...this.commandContributions.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }
}
