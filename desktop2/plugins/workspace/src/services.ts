import { Service, type Context } from "@deepseek-ai/cordis";

import type {
  ProjectArchiveContributor,
  FileCapabilityAccess,
  ResolvedFileCapability,
  SourceImportAdopter,
  WorkspaceExtensionRegistry,
} from "@dramaip/plugin-api";

export type {
  ResolvedFileCapability,
  ProjectArchiveContributor,
  SourceImportAdopter,
  WorkspaceExtensionRegistry,
} from "@dramaip/plugin-api";

export type FileCapabilityResolver = FileCapabilityAccess;

export class FileCapabilityAccessService
  extends Service
  implements FileCapabilityAccess
{
  static provide = "fileCapabilities";

  constructor(
    ctx: Context,
    private readonly resolver: FileCapabilityResolver,
  ) {
    super(ctx, "fileCapabilities");
  }

  resolve(token: string) {
    return this.resolver.resolve(token);
  }
}

export class WorkspaceExtensionRegistryService
  extends Service
  implements WorkspaceExtensionRegistry
{
  static provide = "workspaceExtensions";
  private readonly adopters = new Map<string, SourceImportAdopter>();
  private readonly contributors = new Map<string, ProjectArchiveContributor>();

  constructor(ctx: Context) {
    super(ctx, "workspaceExtensions");
  }

  registerSourceImportAdopter(adopter: SourceImportAdopter) {
    return this.register(this.adopters, adopter.pluginId, adopter);
  }

  registerArchiveContributor(contributor: ProjectArchiveContributor) {
    return this.register(this.contributors, contributor.pluginId, contributor);
  }

  sourceImportAdopters(): readonly SourceImportAdopter[] {
    return [...this.adopters.values()].sort((left, right) =>
      left.pluginId.localeCompare(right.pluginId),
    );
  }

  archiveContributors(): readonly ProjectArchiveContributor[] {
    return [...this.contributors.values()].sort((left, right) =>
      left.pluginId.localeCompare(right.pluginId),
    );
  }

  private register<T>(map: Map<string, T>, id: string, value: T) {
    if (map.has(id)) throw new Error(`duplicate workspace extension: ${id}`);
    map.set(id, value);
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      map.delete(id);
    };
    this.ctx.effect(() => dispose, `workspace-extension:${id}`);
    return dispose;
  }
}
