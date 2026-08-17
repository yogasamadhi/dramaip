import { Service, type Context, type Plugin } from "@deepseek-ai/cordis";
import { z } from "@hono/zod-openapi";

import {
  createNodeMigration,
  createRelationalMigration,
  installRelationalPluginServer,
  type NodeResourceDefinition,
} from "@dramaip/domain-kit";
import { ApiProblem } from "@dramaip/http";
import {
  defineDramaPlugin,
  type ProductionLineageItem,
  type ProductionReadService,
} from "@dramaip/plugin-api";

const pilotData = z.object({
  logline: z.string(),
  durationMinutes: z.number().positive(),
  audience: z.string(),
});
const adaptationData = z.object({
  sourceId: z.string(),
  strategy: z.string(),
  notes: z.string(),
  direction: z.string().optional(),
  targetEpisodeCount: z.number().int().positive().optional(),
});
const episodeData = z.object({
  number: z.number().int().positive(),
  synopsis: z.string(),
  durationMinutes: z.number().positive(),
});
const scriptData = z.object({
  episodeId: z.uuid(),
  content: z.string(),
  format: z.enum(["fountain", "plain", "json"]),
});
const sceneData = z.object({
  scriptId: z.uuid(),
  location: z.string(),
  timeOfDay: z.string(),
  action: z.string(),
  characters: z.array(z.string()),
});
const shotData = z.object({
  sceneId: z.uuid(),
  shotSize: z.string(),
  cameraMovement: z.string(),
  description: z.string(),
  durationSeconds: z.number().nonnegative(),
});
const structureData = z.object({
  ownerType: z.enum(["episode", "script", "scene"]),
  orderedIds: z.array(z.uuid()),
});

function requiresParent(field?: string) {
  return {
    validateCreateInput: (input: {
      parentId: string | null;
      data: Record<string, unknown>;
    }) => {
      if (!input.parentId)
        throw new ApiProblem(
          400,
          "PRODUCTION_PARENT_REQUIRED",
          "制作子项必须绑定真实的上级资料",
        );
      if (field && input.data[field] !== input.parentId)
        throw new ApiProblem(
          409,
          "PRODUCTION_PARENT_MISMATCH",
          "制作子项数据与上级归属不一致",
        );
    },
    validateUpdateInput: (input: {
      parentId: string | null;
      data: Record<string, unknown>;
    }) => {
      if (!input.parentId)
        throw new ApiProblem(
          400,
          "PRODUCTION_PARENT_REQUIRED",
          "制作子项必须绑定真实的上级资料",
        );
      if (field && input.data[field] !== input.parentId)
        throw new ApiProblem(
          409,
          "PRODUCTION_PARENT_MISMATCH",
          "制作子项数据与上级归属不一致",
        );
    },
  };
}

export const productionResources = [
  { kind: "pilot", path: "pilots", data: pilotData },
  { kind: "adaptation", path: "adaptations", data: adaptationData },
  { kind: "episode", path: "episodes", data: episodeData, ...requiresParent() },
  {
    kind: "script",
    path: "scripts",
    data: scriptData,
    ...requiresParent("episodeId"),
  },
  {
    kind: "scene",
    path: "scenes",
    data: sceneData,
    ...requiresParent("scriptId"),
  },
  { kind: "shot", path: "shots", data: shotData, ...requiresParent("sceneId") },
  { kind: "structure-order", path: "structure-orders", data: structureData },
] satisfies readonly NodeResourceDefinition<any>[];

interface ProductionRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  status: string;
  ordinal: number;
  version: number;
  updated_at: string;
}

const lineageKinds = [
  ["adaptation", "production_adaptation"],
  ["episode", "production_episode"],
  ["script", "production_script"],
  ["scene", "production_scene"],
  ["shot", "production_shot"],
] as const;

class ProductionReadServiceImpl
  extends Service
  implements ProductionReadService
{
  static provide = "productionRead";

  constructor(
    ctx: Context,
    private readonly read: Context["uow"],
  ) {
    super(ctx, "productionRead");
  }

  lineage(projectId: string): readonly ProductionLineageItem[] {
    return this.read.execute((tx) =>
      lineageKinds
        .flatMap(([kind, table]) =>
          tx
            .all<ProductionRow>(
              `SELECT id, project_id, parent_id, title, status, ordinal, version, updated_at FROM ${table} WHERE project_id = ? ORDER BY ordinal, created_at`,
              projectId,
            )
            .map((row) => ({
              id: row.id,
              projectId: row.project_id,
              kind,
              parentId: row.parent_id,
              title: row.title,
              status: row.status,
              ordinal: row.ordinal,
              version: row.version,
              updatedAt: row.updated_at,
            })),
        )
        .sort((left, right) => left.ordinal - right.ordinal),
    );
  }

  get(itemId: string): ProductionLineageItem | undefined {
    return this.read.execute((tx) => {
      for (const [kind, table] of lineageKinds) {
        const row = tx.get<ProductionRow>(
          `SELECT id, project_id, parent_id, title, status, ordinal, version, updated_at FROM ${table} WHERE id = ?`,
          itemId,
        );
        if (row)
          return {
            id: row.id,
            projectId: row.project_id,
            kind,
            parentId: row.parent_id,
            title: row.title,
            status: row.status,
            ordinal: row.ordinal,
            version: row.version,
            updatedAt: row.updated_at,
          };
      }
      return undefined;
    });
  }

  assertVersion(itemId: string, expectedVersion: number): void {
    const item = this.get(itemId);
    if (!item)
      throw new ApiProblem(404, "PRODUCTION_ITEM_NOT_FOUND", "制作项不存在");
    if (item.version !== expectedVersion)
      throw new ApiProblem(412, "VERSION_CONFLICT", "制作项版本已变化");
  }
}

const productionServer: Plugin = {
  name: "dramaip-production",
  provide: "productionRead",
  inject: ["http", "uow"],
  apply(ctx) {
    installRelationalPluginServer(ctx, {
      pluginId: "production",
      routeBase: "/api/v2/production",
      resources: productionResources,
    });
    new ProductionReadServiceImpl(ctx, ctx.uow);
  },
};

export const productionModule = defineDramaPlugin({
  descriptor: {
    id: "production",
    version: "1.0.0",
    runtime: "both",
    requires: ["foundation", "workspace", "writing", "knowledge", "automation"],
    provides: [
      "production.episodes",
      "production.scripts",
      "production.shots",
      "productionRead",
    ],
    critical: true,
  },
  contracts: {
    node: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("pilot"), data: pilotData }),
      z.object({ kind: z.literal("adaptation"), data: adaptationData }),
      z.object({ kind: z.literal("episode"), data: episodeData }),
      z.object({ kind: z.literal("script"), data: scriptData }),
      z.object({ kind: z.literal("scene"), data: sceneData }),
      z.object({ kind: z.literal("shot"), data: shotData }),
      z.object({ kind: z.literal("structure-order"), data: structureData }),
    ]),
  },
  server: productionServer,
  migrations: [
    createNodeMigration("production", productionResources),
    createRelationalMigration("production", productionResources),
  ],
});
