import { z } from "@hono/zod-openapi";

import {
  createNodeMigration,
  createRelationalMigration,
  createRelationalPluginServer,
  type NodeResourceDefinition,
} from "@dramaip/domain-kit";
import { defineDramaPlugin } from "@dramaip/plugin-api";
import { ApiProblem } from "@dramaip/http";

const caseStudyData = z.object({
  source: z.string(),
  summary: z.string(),
  lessons: z.array(z.string()),
  tags: z.array(z.string()),
});
const diagnosticData = z.object({
  targetId: z.string(),
  issues: z.array(
    z.object({
      severity: z.enum(["info", "warning", "error"]),
      code: z.string(),
      message: z.string(),
    }),
  ),
});
const analysisData = z.object({
  targetId: z.string(),
  dimensions: z.record(z.string(), z.number()),
  narrative: z.string(),
});
const complianceData = z.object({
  targetId: z.string(),
  profile: z.string(),
  passed: z.boolean(),
  findings: z.array(z.string()),
});
const qualityData = z.object({
  targetId: z.string(),
  score: z.number().min(0).max(100),
  checks: z.array(
    z.object({ name: z.string(), passed: z.boolean(), detail: z.string() }),
  ),
});

export const creativeQualityResources = [
  { kind: "case-study", path: "case-studies", data: caseStudyData },
  {
    kind: "diagnostic",
    path: "diagnostics",
    data: diagnosticData,
    validateCreate: (data: z.infer<typeof diagnosticData>) => {
      if (!data.issues.length)
        throw new ApiProblem(
          400,
          "DIAGNOSTIC_EMPTY",
          "诊断必须包含至少一个基于项目数据的问题",
        );
    },
  },
  {
    kind: "analysis",
    path: "analyses",
    data: analysisData,
    validateCreate: (data: z.infer<typeof analysisData>) => {
      if (!Object.keys(data.dimensions).length)
        throw new ApiProblem(
          400,
          "ANALYSIS_EMPTY",
          "分析必须包含可解释的维度结果",
        );
    },
  },
  { kind: "compliance-check", path: "compliance-checks", data: complianceData },
  {
    kind: "quality-check",
    path: "quality-checks",
    data: qualityData,
    validateCreate: (data: z.infer<typeof qualityData>) => {
      if (!data.checks.length)
        throw new ApiProblem(
          400,
          "QUALITY_CHECK_EMPTY",
          "质量检查必须包含至少一个检查项",
        );
    },
  },
] satisfies readonly NodeResourceDefinition<any>[];

export const creativeQualityModule = defineDramaPlugin({
  descriptor: {
    id: "creative-quality",
    version: "1.0.0",
    runtime: "both",
    requires: ["foundation", "workspace", "writing", "knowledge", "automation"],
    provides: [
      "creative-quality.cases",
      "creative-quality.diagnostics",
      "creative-quality.compliance",
    ],
    critical: false,
  },
  contracts: {
    node: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("case-study"), data: caseStudyData }),
      z.object({ kind: z.literal("diagnostic"), data: diagnosticData }),
      z.object({ kind: z.literal("analysis"), data: analysisData }),
      z.object({ kind: z.literal("compliance-check"), data: complianceData }),
      z.object({ kind: z.literal("quality-check"), data: qualityData }),
    ]),
  },
  server: createRelationalPluginServer({
    pluginId: "creative-quality",
    routeBase: "/api/v2/creative-quality",
    resources: creativeQualityResources,
  }),
  migrations: [
    createNodeMigration("creative-quality", creativeQualityResources),
    createRelationalMigration("creative-quality", creativeQualityResources),
  ],
});
