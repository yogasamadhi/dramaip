import { provideService } from "@dramaip/plugin-api/internal";
import {
  CreationCheckSchema,
  CREATION_QUALITY_SERVICE,
  type CreationIssue,
} from "@dramaip/contracts/creation";
import type { PluginContext } from "@dramaip/plugin-api/internal";

export function registerCreationQuality(context: PluginContext) {
  context.effect(
    () =>
      provideService(context, CREATION_QUALITY_SERVICE, {
        prompt:
          '审阅候选与冻结的创作目标和来源。核对人物认知、时序、事实、剧情推进、对白、重复和任务约束。仅报告有原文证据的问题，不打综合分。只返回 JSON：{"issues":[{"severity":"error 或 warning 或 suggestion","message":"问题","evidence":"候选中的原文证据","location":"章节/场景/段落","suggestion":"局部修改要求","source":"model"}]}。无问题时 issues 为空数组。',
        collect: (raw: string, rules: CreationIssue[]) => {
          const text =
            raw.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/u)?.[1] ?? raw;
          const result = CreationCheckSchema.parse(JSON.parse(text));
          return [
            ...rules,
            ...result.issues.map((issue) => ({
              ...issue,
              source: "model" as const,
            })),
          ];
        },
      }),
    `service:${CREATION_QUALITY_SERVICE}`,
  );
}
